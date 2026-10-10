import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { RuntimeError } from "rig";
import { atomicWriteFile } from "./atomic.ts";
import { newPageId, nowIso, type PageMeta, type ProjectFile } from "./schema.ts";
import { openProject, updateProject } from "./store.ts";

export interface PageSource {
  html: string;
  css: string;
}

export function pagesDir(dir: string): string {
  return join(resolve(dir), "pages");
}

export function pageHtmlPath(dir: string, pageId: string): string {
  return join(pagesDir(dir), `${pageId}.html`);
}

export function pageCssPath(dir: string, pageId: string): string {
  return join(pagesDir(dir), `${pageId}.css`);
}

export function assertPageSource(html: string, css: string): void {
  const source = `${html}\n${css}`;
  if (/<script[\s>/]/i.test(source)) {
    throw new RuntimeError("Page artwork must not contain <script> elements");
  }
  if (/javascript:/i.test(source)) {
    throw new RuntimeError("Page artwork must not contain javascript: URLs");
  }
}

export interface WritePageInput {
  pageId?: string;
  index: number;
  title: string;
  html: string;
  css: string;
  assets?: string[];
  evidence?: Record<string, string>;
}

export async function writePage(
  dir: string,
  input: WritePageInput,
): Promise<{ project: ProjectFile; pageId: string }> {
  const project = await openProject(dir);
  assertPageSource(input.html, input.css);
  const assets = normalizeAssets(project, input.assets);
  normalizeAssets(project, Object.keys(input.evidence ?? {}));
  let pageId = input.pageId;
  let index = input.index;
  if (pageId) {
    const existing = project.pages.indexOf(pageId);
    if (existing !== -1) {
      index = existing + 1;
    } else {
      const outlineIndex = (project.outline ?? []).findIndex((entry) => entry.id === pageId);
      if (outlineIndex === -1) {
        throw new RuntimeError(`Unknown page "${pageId}"`, { details: { pageId } });
      }
      index = outlineIndex + 1;
    }
  } else {
    if (!Number.isInteger(index) || index < 1) {
      throw new RuntimeError(`Page index must be a positive integer (got ${input.index})`);
    }
    if (index > project.pages.length + 1) {
      throw new RuntimeError(
        `Page index ${index} is out of order; pages must be submitted sequentially (next: ${project.pages.length + 1})`,
      );
    }
    if (project.outline && index > project.outline.length) {
      throw new RuntimeError(
        `The outline has ${project.outline.length} entries; there is no page ${index}`,
        { details: { outlineLength: project.outline.length } },
      );
    }
    pageId = project.pages[index - 1] ?? project.outline?.[index - 1]?.id ?? newPageId();
  }
  if (index > project.pages.length + 1) {
    throw new RuntimeError(`Pages must be submitted sequentially (next: ${project.pages.length + 1}).`);
  }
  const maximum = project.settings.output === "poster" ? 1 : project.outline?.length ?? project.settings.slideCount;
  if (index > maximum && !project.pages.includes(pageId)) {
    throw new RuntimeError(`This project expects ${maximum} pages; there is no page ${index}.`);
  }
  if (project.pages.includes(pageId)) await savePreviousPage(dir, pageId, project);
  await mkdir(pagesDir(dir), { recursive: true });
  await atomicWriteFile(pageHtmlPath(dir, pageId), ensureTrailingNewline(input.html));
  await atomicWriteFile(pageCssPath(dir, pageId), ensureTrailingNewline(input.css));
  const updated = await updateProject(dir, (current) => {
    current.artworkRevision = -1;
    const position = current.pages.indexOf(pageId!);
    if (position === -1) {
      current.pages.splice(index - 1, 0, pageId!);
    }
    current.pageMeta[pageId!] = {
      title: input.title.trim(),
      assets,
      evidence: input.evidence ?? {},
      updatedAt: nowIso(),
    };
  });
  return { project: updated, pageId };
}

export interface PagePatch {
  title?: string;
  html?: string;
  css?: string;
  assets?: string[];
  evidence?: Record<string, string>;
  htmlEdits?: Array<{ find: string; replace: string }>;
  cssEdits?: Array<{ find: string; replace: string }>;
}

export async function updatePage(
  dir: string,
  pageId: string,
  patch: PagePatch,
): Promise<{ project: ProjectFile; pageId: string }> {
  const project = await openProject(dir);
  if (!project.pages.includes(pageId)) {
    throw new RuntimeError(`Unknown page "${pageId}"`, { details: { pageId } });
  }
  const current = await readPage(dir, pageId);
  const html = editSource(current.html, patch.html, patch.htmlEdits);
  const css = editSource(current.css, patch.css, patch.cssEdits);
  assertPageSource(html, css);
  const assets = patch.assets === undefined ? undefined : normalizeAssets(project, patch.assets);
  normalizeAssets(project, Object.keys(patch.evidence ?? {}));
  await savePreviousPage(dir, pageId, project);
  if (html !== current.html) await atomicWriteFile(pageHtmlPath(dir, pageId), ensureTrailingNewline(html));
  if (css !== current.css) await atomicWriteFile(pageCssPath(dir, pageId), ensureTrailingNewline(css));
  const updated = await updateProject(dir, (current) => {
    current.artworkRevision = -1;
    const meta = current.pageMeta[pageId] ?? { title: "", assets: [] };
    current.pageMeta[pageId] = {
      title: patch.title?.trim() ?? meta.title,
      assets: assets ?? meta.assets,
      evidence: patch.evidence ?? meta.evidence ?? {},
      updatedAt: nowIso(),
    };
  });
  return { project: updated, pageId };
}

function editSource(source: string, replacement: string | undefined, edits: PagePatch["htmlEdits"]): string {
  if (replacement !== undefined && edits !== undefined) {
    throw new RuntimeError("Choose a full replacement or targeted edits for each source, not both.");
  }
  let result = replacement ?? source;
  for (const edit of edits ?? []) {
    const index = result.indexOf(edit.find);
    if (!edit.find || index === -1 || result.indexOf(edit.find, index + 1) !== -1) {
      throw new RuntimeError("Each targeted edit must match exactly once. Read the page and use a unique find string.");
    }
    result = result.slice(0, index) + edit.replace + result.slice(index + edit.find.length);
  }
  return result;
}

async function savePreviousPage(dir: string, pageId: string, project: ProjectFile): Promise<void> {
  const source = await readPage(dir, pageId);
  const historyDir = join(pagesDir(dir), ".history");
  await mkdir(historyDir, { recursive: true });
  await atomicWriteFile(join(historyDir, `${pageId}.json`), JSON.stringify({ ...source, meta: project.pageMeta[pageId] ?? { title: "", assets: [] } }));
}

export async function restorePage(dir: string, pageId: string): Promise<{ project: ProjectFile; pageId: string }> {
  const project = await openProject(dir);
  if (!project.pages.includes(pageId)) throw new RuntimeError(`Unknown page "${pageId}"`);
  const previous = await readFile(join(pagesDir(dir), ".history", `${pageId}.json`), "utf8")
    .catch(() => { throw new RuntimeError(`No previous version is available for page "${pageId}"`); });
  const { html, css, meta } = JSON.parse(previous) as PageSource & { meta: PageMeta };
  return updatePage(dir, pageId, { html, css, title: meta.title, assets: meta.assets, evidence: meta.evidence ?? {} });
}

export async function readPage(dir: string, pageId: string): Promise<PageSource> {
  try {
    const [html, css] = await Promise.all([
      readFile(pageHtmlPath(dir, pageId), "utf8"),
      readFile(pageCssPath(dir, pageId), "utf8").catch(() => ""),
    ]);
    return { html, css };
  } catch (error) {
    throw new RuntimeError(`Could not read page "${pageId}": ${String(error)}`, {
      details: { pageId },
    });
  }
}

export async function movePage(
  dir: string,
  pageId: string,
  toIndex: number,
): Promise<ProjectFile> {
  return updateProject(dir, (current) => {
    const from = current.pages.indexOf(pageId);
    if (from === -1) {
      throw new RuntimeError(`Unknown page "${pageId}"`, { details: { pageId } });
    }
    const target = Math.min(Math.max(Math.trunc(toIndex), 1), current.pages.length);
    if (from + 1 === target) return;
    current.pages.splice(from, 1);
    current.pages.splice(target - 1, 0, pageId);
  });
}

export async function duplicatePage(
  dir: string,
  pageId: string,
): Promise<{ project: ProjectFile; pageId: string }> {
  const project = await openProject(dir);
  const index = project.pages.indexOf(pageId);
  if (index === -1) {
    throw new RuntimeError(`Unknown page "${pageId}"`, { details: { pageId } });
  }
  const source = await readPage(dir, pageId);
  const copyId = newPageId();
  await atomicWriteFile(pageHtmlPath(dir, copyId), ensureTrailingNewline(source.html));
  await atomicWriteFile(pageCssPath(dir, copyId), ensureTrailingNewline(source.css));
  const sourceMeta = project.pageMeta[pageId] ?? { title: "", assets: [] };
  const updated = await updateProject(dir, (current) => {
    current.pages.splice(index + 1, 0, copyId);
    current.pageMeta[copyId] = {
      title: `${sourceMeta.title || "Slide"} copy`,
      assets: [...sourceMeta.assets],
      evidence: sourceMeta.evidence,
      updatedAt: nowIso(),
    };
  });
  return { project: updated, pageId: copyId };
}

export async function deletePage(dir: string, pageId: string): Promise<ProjectFile> {
  const updated = await updateProject(dir, (current) => {
    const index = current.pages.indexOf(pageId);
    if (index === -1) {
      throw new RuntimeError(`Unknown page "${pageId}"`, { details: { pageId } });
    }
    current.pages.splice(index, 1);
    delete current.pageMeta[pageId];
  });
  await Promise.all([
    rm(pageHtmlPath(dir, pageId), { force: true }).catch(() => undefined),
    rm(pageCssPath(dir, pageId), { force: true }).catch(() => undefined),
  ]);
  return updated;
}

export function pageRefs(project: ProjectFile): Array<{ id: string; index: number; title: string }> {
  return project.pages.map((id, index) => ({
    id,
    index,
    title: project.pageMeta[id]?.title ?? project.outline?.[index]?.title ?? "",
  }));
}

function normalizeAssets(project: ProjectFile, assets: string[] | undefined): string[] {
  if (!assets) return [];
  const known = new Set(project.context.map((item) => item.id));
  for (const asset of assets) {
    if (!known.has(asset)) {
      throw new RuntimeError(`Unknown asset "${asset}"`, {
        details: { asset, contextIds: [...known] },
      });
    }
  }
  return [...new Set(assets)];
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
