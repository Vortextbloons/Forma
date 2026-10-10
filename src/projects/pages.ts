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
}

export async function writePage(
  dir: string,
  input: WritePageInput,
): Promise<{ project: ProjectFile; pageId: string }> {
  const project = await openProject(dir);
  assertPageSource(input.html, input.css);
  const assets = normalizeAssets(project, input.assets);
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
  await mkdir(pagesDir(dir), { recursive: true });
  await atomicWriteFile(pageHtmlPath(dir, pageId), ensureTrailingNewline(input.html));
  await atomicWriteFile(pageCssPath(dir, pageId), ensureTrailingNewline(input.css));
  const updated = await updateProject(dir, (current) => {
    const position = current.pages.indexOf(pageId!);
    if (position === -1) {
      current.pages.splice(index - 1, 0, pageId!);
    }
    current.pageMeta[pageId!] = {
      title: input.title.trim(),
      assets,
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
  if (patch.html !== undefined || patch.css !== undefined) {
    const current = await readPage(dir, pageId);
    const html = patch.html ?? current.html;
    const css = patch.css ?? current.css;
    assertPageSource(html, css);
    if (patch.html !== undefined) {
      await atomicWriteFile(pageHtmlPath(dir, pageId), ensureTrailingNewline(patch.html));
    }
    if (patch.css !== undefined) {
      await atomicWriteFile(pageCssPath(dir, pageId), ensureTrailingNewline(patch.css));
    }
  }
  const assets = patch.assets === undefined ? undefined : normalizeAssets(project, patch.assets);
  const updated = await updateProject(dir, (current) => {
    const meta = current.pageMeta[pageId] ?? { title: "", assets: [] };
    current.pageMeta[pageId] = {
      title: patch.title?.trim() ?? meta.title,
      assets: assets ?? meta.assets,
      updatedAt: nowIso(),
    };
  });
  return { project: updated, pageId };
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
