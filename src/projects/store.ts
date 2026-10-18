import { copyFile, cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { RuntimeError } from "rig";
import { atomicWriteFile } from "./atomic.ts";
import { resolveProjectsHome } from "./home.ts";
import {
  DATA_EXTENSIONS,
  DATA_MIME_BY_EXTENSION,
  dataFormatForExtension,
  dataFormatForMime,
  profileDataBytes,
} from "../materials/data.ts";
import {
  PROJECT_FILE,
  newActionId,
  newContextId,
  newPageId,
  newProjectId,
  newSourceId,
  nowIso,
  parseProjectFile,
  projectPreferencesSchema,
  type ActionRecord,
  type ContextItem,
  type ContextRole,
  type DataProfile,
  type ProjectFile,
  type ProjectPreferences,
  type ProjectSettings,
  type SourceRecord,
} from "./schema.ts";

export interface CreateProjectInput {
  dir?: string;
  name: string;
  prompt: string;
  mode: ProjectFile["mode"];
  settings: ProjectSettings;
  preferences?: Pick<Partial<ProjectPreferences>, "model" | "thinkingLevel">;
}

export interface CreatedProject {
  dir: string;
  project: ProjectFile;
}

export interface ProjectListEntry {
  dir: string;
  project: ProjectFile;
}

export const ACCEPTED_CONTEXT_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".pdf",
  ".txt",
  ".md",
  ...DATA_EXTENSIONS,
] as const;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ...DATA_MIME_BY_EXTENSION,
};

export function contextAssetFormat(name: string, mime: string): { extension: string; mime: string } {
  const normalized = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  for (const [extension, knownMime] of Object.entries(MIME_BY_EXTENSION)) {
    if (knownMime === normalized) return { extension, mime: knownMime };
  }
  const extension = extname(name).toLowerCase();
  const knownMime = (ACCEPTED_CONTEXT_EXTENSIONS as readonly string[]).includes(extension)
    ? MIME_BY_EXTENSION[extension]
    : undefined;
  if (knownMime !== undefined) {
    return { extension, mime: knownMime };
  }
  throw new RuntimeError(
    `Unsupported file type "${extension || normalized || name}" (accepted: ${ACCEPTED_CONTEXT_EXTENSIONS.join(", ")})`,
  );
}

interface ProjectCacheEntry {
  mtimeMs: number;
  size: number;
  project: ProjectFile;
}

const PROJECT_CACHE_LIMIT = 16;
const projectCache = new Map<string, ProjectCacheEntry>();

const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  locks.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

export function projectFilePath(dir: string): string {
  return join(resolve(dir), PROJECT_FILE);
}

export async function createProject(input: CreateProjectInput): Promise<CreatedProject> {
  const id = newProjectId();
  const dir = resolve(input.dir ?? join(resolveProjectsHome(), id));
  const file = projectFilePath(dir);
  return withLock(file, async () => {
    if (await exists(file)) {
      throw new RuntimeError(`A project already exists in "${dir}"`, {
        details: { dir },
      });
    }
    const timestamp = nowIso();
    const project: ProjectFile = {
      formatVersion: 1,
      id,
      name: input.name.trim() || "Untitled project",
      prompt: input.prompt,
      mode: input.mode,
      createdAt: timestamp,
      updatedAt: timestamp,
      settings: input.settings,
      settingsRevision: 0,
      artworkRevision: -1,
      outline: null,
      pages: [],
      pageMeta: {},
      context: [],
      sources: [],
      folders: [],
      actions: [],
      conversation: { sessionIds: [] },
      preferences: projectPreferencesSchema.parse({ ...input.preferences }),
    };
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, "pages"), { recursive: true });
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeProjectFile(dir, project);
    return { dir, project };
  });
}

export async function listProjects(
  home = resolveProjectsHome(),
): Promise<{ home: string; projects: ProjectListEntry[] }> {
  const root = resolve(home);
  let names: string[];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return { home: root, projects: [] };
  }
  const projects: ProjectListEntry[] = [];
  for (const name of names) {
    const dir = join(root, name);
    try {
      projects.push({ dir, project: await openProject(dir) });
    } catch {
      continue;
    }
  }
  projects.sort(
    (a, b) =>
      b.project.updatedAt.localeCompare(a.project.updatedAt) ||
      a.project.name.localeCompare(b.project.name),
  );
  return { home: root, projects };
}

export async function renameProject(dir: string, name: string): Promise<ProjectFile> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new RuntimeError("Project name cannot be empty");
  }
  return updateProject(dir, (project) => {
    project.name = trimmed;
  });
}

export async function duplicateProject(
  sourceDir: string,
  name?: string,
): Promise<CreatedProject> {
  const source = await openProject(sourceDir);
  const id = newProjectId();
  const dir = join(resolveProjectsHome(), id);
  const timestamp = nowIso();
  const project: ProjectFile = {
    ...source,
    id,
    name: name?.trim() || `${source.name} copy`,
    createdAt: timestamp,
    updatedAt: timestamp,
    conversation: { sessionIds: [] },
  };
  await mkdir(resolveProjectsHome(), { recursive: true });
  await cp(resolve(sourceDir), dir, {
    recursive: true,
    filter: (path) => basename(path) !== ".rig",
  });
  await writeProjectFile(dir, project);
  return { dir: resolve(dir), project };
}

export async function deleteProject(dir: string): Promise<string> {
  const home = resolve(resolveProjectsHome());
  const target = resolve(dir);
  const inside = relative(home, target);
  if (inside === "" || inside === ".." || inside.startsWith("..") || isAbsolute(inside)) {
    throw new RuntimeError(`Refusing to delete "${target}": not a Forma-managed project`, {
      details: { dir: target },
    });
  }
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  projectCache.delete(projectFilePath(target));
  return target;
}

export async function openProject(dir: string): Promise<ProjectFile> {
  const file = projectFilePath(dir);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new RuntimeError(`No project found in "${resolve(dir)}"`, {
        details: { dir: resolve(dir), reason: "project-not-found" },
      });
    }
    throw error;
  }
  const cached = projectCache.get(file);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
    return structuredClone(cached.project);
  }
  const raw = await readFile(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new RuntimeError(`Project file is not valid JSON: ${String(error)}`, {
      details: { file },
    });
  }
  const project = parseProjectFile(parsed, file);
  if (projectCache.size >= PROJECT_CACHE_LIMIT) {
    const oldest = projectCache.keys().next().value;
    if (oldest !== undefined) projectCache.delete(oldest);
  }
  projectCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, project });
  return structuredClone(project);
}

export async function updateProject(
  dir: string,
  mutate: (project: ProjectFile) => void,
): Promise<ProjectFile> {
  const file = projectFilePath(dir);
  return withLock(file, async () => {
    const project = await openProject(dir);
    mutate(project);
    project.updatedAt = nowIso();
    await writeProjectFile(dir, project);
    return project;
  });
}

export async function importContextFile(
  dir: string,
  sourcePath: string,
  role: ContextRole,
  name?: string,
  folder?: string,
): Promise<{ project: ProjectFile; item: ContextItem }> {
  if (!isAbsolute(sourcePath)) {
    throw new RuntimeError("Context import requires an absolute file path", {
      details: { path: sourcePath },
    });
  }
  const extension = extname(sourcePath).toLowerCase();
  if (!(ACCEPTED_CONTEXT_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new RuntimeError(
      `Unsupported file type "${extension || basename(sourcePath)}" (accepted: ${ACCEPTED_CONTEXT_EXTENSIONS.join(", ")})`,
    );
  }
  const info = await stat(sourcePath).catch(() => undefined);
  if (!info || !info.isFile()) {
    throw new RuntimeError(`Context file not found: ${sourcePath}`, {
      details: { path: sourcePath },
    });
  }
  const id = newContextId();
  const assetName = `${id}${extension}`;
  const assetRel = `assets/${assetName}`;
  const assetAbs = join(resolve(dir), "assets", assetName);
  await mkdir(dirname(assetAbs), { recursive: true });
  await copyFile(sourcePath, assetAbs);
  const mime = MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
  const item: ContextItem = {
    id,
    name: name?.trim() || basename(sourcePath),
    role,
    asset: assetRel,
    mime,
    size: info.size,
    status: needsExtraction(mime) ? "processing" : "ready",
    folder: normalizeFolder(folder ?? ""),
    revision: 1,
    derivedFrom: [],
    stale: false,
    createdAt: nowIso(),
  };
  if (isDataMime(mime)) {
    item.data = await profileDataBytes(await readFile(assetAbs), dataFormatForMime(mime)!);
  }
  let project = await updateProject(dir, (current) => {
    current.context.push(item);
    if (item.folder && !current.folders.includes(item.folder)) current.folders.push(item.folder);
  });
  let saved = item;
  if (isTextMime(mime)) {
    ({ project, item: saved } = await finalizeTextImport(dir, item));
  }
  return { project, item: saved };
}

export async function importContextNote(
  dir: string,
  text: string,
  role: ContextRole,
  name?: string,
  folder?: string,
): Promise<{ project: ProjectFile; item: ContextItem }> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new RuntimeError("A pasted note cannot be empty");
  }
  return importContextAsset(dir, {
    name: name?.trim() || "Pasted note",
    extension: ".md",
    mime: "text/markdown",
    data: `${trimmed}\n`,
    role,
    folder,
  });
}

export interface ImportAssetInput {
  name: string;
  extension: string;
  mime: string;
  data: Uint8Array | string;
  role: ContextRole;
  sourceId?: string;
  folder?: string;
  derivedFrom?: string[];
}

export async function importContextAsset(
  dir: string,
  input: ImportAssetInput,
): Promise<{ project: ProjectFile; item: ContextItem }> {
  const id = newContextId();
  const extension = input.extension.startsWith(".") ? input.extension : `.${input.extension}`;
  const assetRel = `assets/${id}${extension}`;
  const bytes =
    typeof input.data === "string" ? Buffer.from(input.data, "utf8") : Buffer.from(input.data);
  await mkdir(join(resolve(dir), "assets"), { recursive: true });
  await atomicWriteFile(join(resolve(dir), assetRel), bytes);
  const item: ContextItem = {
    id,
    name: input.name.trim() || `Asset ${id.slice(-4)}`,
    role: input.role,
    asset: assetRel,
    mime: input.mime,
    size: bytes.byteLength,
    status: needsExtraction(input.mime) ? "processing" : "ready",
    folder: normalizeFolder(input.folder ?? ""),
    revision: 1,
    derivedFrom: [...new Set(input.derivedFrom ?? [])],
    stale: false,
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    createdAt: nowIso(),
  };
  const format = isDataMime(input.mime) ? dataFormatForMime(input.mime) : null;
  if (format) item.data = await profileDataBytes(bytes, format);
  let project = await updateProject(dir, (current) => {
    const known = new Set(current.context.map((entry) => entry.id));
    for (const source of item.derivedFrom) {
      if (!known.has(source)) {
        throw new RuntimeError(`Unknown source material "${source}"`, {
          details: { contextIds: [...known] },
        });
      }
    }
    current.context.push(item);
    if (item.folder && !current.folders.includes(item.folder)) current.folders.push(item.folder);
  });
  let saved = item;
  if (isTextMime(input.mime)) {
    ({ project, item: saved } = await finalizeTextImport(dir, item));
  }
  return { project, item: saved };
}

function isTextMime(mime: string): boolean {
  return mime === "text/plain" || mime === "text/markdown";
}

async function finalizeTextImport(
  dir: string,
  item: ContextItem,
): Promise<{ project: ProjectFile; item: ContextItem }> {
  const { scheduleExtraction } = await import("../extraction/index.ts");
  await scheduleExtraction(dir, item.id);
  const project = await openProject(dir);
  return { project, item: project.context.find((entry) => entry.id === item.id) ?? item };
}

export interface ContextPatch {
  name?: string;
  role?: ContextRole;
  status?: ContextItem["status"];
  extraction?: ContextItem["extraction"];
  error?: string | null;
  sourceId?: string;
  stale?: boolean;
}

export async function updateContextItem(
  dir: string,
  id: string,
  patch: ContextPatch,
): Promise<ProjectFile> {
  return updateProject(dir, (current) => {
    const item = current.context.find((entry) => entry.id === id);
    if (!item) {
      throw new RuntimeError(`Unknown context item "${id}"`, { details: { id } });
    }
    if (patch.name !== undefined) item.name = patch.name;
    if (patch.role !== undefined) item.role = patch.role;
    if (patch.status !== undefined) item.status = patch.status;
    if (patch.extraction !== undefined) item.extraction = patch.extraction;
    if (patch.error !== undefined) {
      if (patch.error === null) delete item.error;
      else item.error = patch.error;
    }
    if (patch.sourceId !== undefined) item.sourceId = patch.sourceId;
    if (patch.stale !== undefined) item.stale = patch.stale;
  });
}

export interface SourceInput {
  kind: SourceRecord["kind"];
  title: string;
  url?: string;
  provider?: string;
  author?: string;
  authorUrl?: string;
  query?: string;
  licenseStatus?: SourceRecord["licenseStatus"];
}

export async function addSource(
  dir: string,
  input: SourceInput,
): Promise<{ project: ProjectFile; source: SourceRecord }> {
  const source: SourceRecord = {
    id: newSourceId(),
    createdAt: nowIso(),
    ...input,
  };
  const project = await updateProject(dir, (current) => {
    current.sources.push(source);
  });
  return { project, source };
}

export interface OutlineInput {
  id?: string;
  title: string;
  points?: string[];
  visualDirection?: string;
  assetIds?: string[];
}

export async function setOutline(dir: string, entries: OutlineInput[]): Promise<ProjectFile> {
  return updateProject(dir, (current) => {
    const knownAssets = new Set(current.context.map((item) => item.id));
    const used = new Set<string>();
    current.outline = entries.map((entry) => {
      const id = entry.id && !used.has(entry.id) ? entry.id : newPageId();
      used.add(id);
      const assetIds = entry.assetIds ?? [];
      for (const asset of assetIds) {
        if (!knownAssets.has(asset)) {
          throw new RuntimeError(`Unknown asset "${asset}"`, {
            details: { asset, contextIds: [...knownAssets] },
          });
        }
      }
      return {
        id,
        title: entry.title.trim() || "Untitled",
        points: (entry.points ?? [])
          .map((point) => point.trim())
          .filter((point) => point.length > 0),
        visualDirection: entry.visualDirection?.trim() || undefined,
        assetIds: [...new Set(assetIds)],
      };
    });
  });
}

export async function removeContextItem(dir: string, id: string): Promise<ProjectFile> {
  const project = await openProject(dir);
  const target = project.context.find((item) => item.id === id);
  if (!target) {
    throw new RuntimeError(`Unknown context item "${id}"`, { details: { id } });
  }
  const { materialReferences } = await import("./pages.ts");
  const references = await materialReferences(dir, project, id, target.asset);
  if (references.length > 0) {
    throw new RuntimeError(
      `"${target.name}" is still used by ${references.join(", ")}. Remove those results or rebuild those slides without it first.`,
      { details: { id, references } },
    );
  }
  const updated = await updateProject(dir, (current) => {
    const index = current.context.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new RuntimeError(`Unknown context item "${id}"`, { details: { id } });
    }
    const removed = current.context[index]!;
    current.context.splice(index, 1);
    recordAction(current, {
      kind: "remove",
      label: `Removed ${removed.name}`,
      inputs: [id],
    });
  });
  await removeAssetFile(dir, target.asset);
  await rm(extractionPath(dir, id), { force: true }).catch(() => undefined);
  return updated;
}

export function isDataMime(mime: string): boolean {
  return dataFormatForMime(mime) !== null;
}

export async function replaceContextFile(
  dir: string,
  id: string,
  sourcePath: string,
): Promise<{ project: ProjectFile; item: ContextItem }> {
  if (!isAbsolute(sourcePath)) {
    throw new RuntimeError("Replacing a material requires an absolute file path", {
      details: { path: sourcePath },
    });
  }
  const extension = extname(sourcePath).toLowerCase();
  if (!(ACCEPTED_CONTEXT_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new RuntimeError(
      `Unsupported file type "${extension || basename(sourcePath)}" (accepted: ${ACCEPTED_CONTEXT_EXTENSIONS.join(", ")})`,
    );
  }
  const info = await stat(sourcePath).catch(() => undefined);
  if (!info || !info.isFile()) {
    throw new RuntimeError(`Material file not found: ${sourcePath}`, { details: { path: sourcePath } });
  }
  const project = await openProject(dir);
  const existing = project.context.find((entry) => entry.id === id);
  if (!existing) {
    throw new RuntimeError(`Unknown context item "${id}"`, { details: { id } });
  }
  const revision = existing.revision + 1;
  const mime = MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
  const assetRel = `assets/${id}.v${revision}${extension}`;
  const assetAbs = join(resolve(dir), assetRel);
  await mkdir(dirname(assetAbs), { recursive: true });
  await copyFile(sourcePath, assetAbs);
  const format = isDataMime(mime) ? dataFormatForMime(mime) : null;
  const data: DataProfile | undefined = format
    ? await profileDataBytes(await readFile(assetAbs), format)
    : undefined;
  const updated = await updateProject(dir, (current) => {
    const item = current.context.find((entry) => entry.id === id)!;
    item.asset = assetRel;
    item.mime = mime;
    item.size = info.size;
    item.revision = revision;
    item.status = needsExtraction(mime) ? "processing" : "ready";
    item.stale = false;
    delete item.error;
    delete item.extraction;
    if (data) item.data = data;
    else delete item.data;
    markDependentsStale(current, id);
    recordAction(current, {
      kind: "replace",
      label: `Replaced ${item.name}`,
      inputs: [id],
      outputs: [id],
      detail: `Now version ${revision}. Earlier versions stay in the project assets folder.`,
    });
  });
  return { project: updated, item: updated.context.find((entry) => entry.id === id)! };
}

export interface GeneratedMaterialInput {
  id?: string;
  name: string;
  extension: string;
  mime: string;
  data: Uint8Array | string;
  derivedFrom: string[];
}

export async function saveGeneratedMaterial(
  dir: string,
  input: GeneratedMaterialInput,
): Promise<{ project: ProjectFile; item: ContextItem }> {
  const derivedFrom = [...new Set(input.derivedFrom)];
  if (!input.id) {
    return importContextAsset(dir, {
      name: input.name,
      extension: input.extension,
      mime: input.mime,
      data: input.data,
      role: "optional",
      derivedFrom,
    });
  }
  const extension = input.extension.startsWith(".") ? input.extension : `.${input.extension}`;
  const id = input.id;
  const existingProject = await openProject(dir);
  const existing = existingProject.context.find((entry) => entry.id === id);
  if (!existing) {
    throw new RuntimeError(`Unknown result "${id}"`, { details: { id } });
  }
  if (existing.derivedFrom.length === 0) {
    throw new RuntimeError(`"${existing.name}" is not a generated result; omit resultId to save a new result.`, {
      details: { id },
    });
  }
  if (derivedFrom.length === 0) derivedFrom.push(...existing.derivedFrom);
  const existingExtension = extname(existing.asset).toLowerCase();
  if (existingExtension !== extension.toLowerCase()) {
    throw new RuntimeError(
      `"${existing.name}" is a ${existingExtension} result and cannot be replaced with a ${extension} result.`,
      { details: { id, expected: existingExtension, got: extension } },
    );
  }
  const known = new Set(existingProject.context.map((entry) => entry.id));
  for (const source of derivedFrom) {
    if (!known.has(source)) {
      throw new RuntimeError(`Unknown material "${source}"`, { details: { contextIds: [...known] } });
    }
  }
  const bytes = typeof input.data === "string" ? Buffer.from(input.data, "utf8") : Buffer.from(input.data);
  const revision = existing.revision + 1;
  const assetRel = `assets/${id}.v${revision}${extension}`;
  await mkdir(join(resolve(dir), "assets"), { recursive: true });
  await atomicWriteFile(join(resolve(dir), assetRel), bytes);
  const updated = await updateProject(dir, (current) => {
    const item = current.context.find((entry) => entry.id === id)!;
    item.name = input.name.trim() || item.name;
    item.asset = assetRel;
    item.mime = input.mime;
    item.size = bytes.byteLength;
    item.revision = revision;
    item.derivedFrom = derivedFrom;
    item.status = needsExtraction(input.mime) ? "processing" : "ready";
    delete item.error;
    item.stale = derivedFrom.some((source) => current.context.find((entry) => entry.id === source)?.stale === true);
    markDependentsStale(current, id);
  });
  let project = updated;
  let item = updated.context.find((entry) => entry.id === id)!;
  if (isTextMime(input.mime)) {
    const { scheduleExtraction } = await import("../extraction/index.ts");
    await scheduleExtraction(dir, id);
    project = await openProject(dir);
    item = project.context.find((entry) => entry.id === id) ?? item;
  }
  return { project, item };
}

export async function setContextFolder(
  dir: string,
  id: string,
  folder: string,
): Promise<ProjectFile> {
  const clean = normalizeFolder(folder);
  return updateProject(dir, (current) => {
    const item = current.context.find((entry) => entry.id === id);
    if (!item) {
      throw new RuntimeError(`Unknown context item "${id}"`, { details: { id } });
    }
    item.folder = clean;
    if (clean && !current.folders.includes(clean)) current.folders.push(clean);
  });
}

export async function addFolder(dir: string, name: string): Promise<ProjectFile> {
  const clean = normalizeFolder(name);
  if (!clean) throw new RuntimeError("A folder name cannot be empty");
  return updateProject(dir, (current) => {
    if (!current.folders.includes(clean)) current.folders.push(clean);
    current.folders.sort((a, b) => a.localeCompare(b));
  });
}

export async function removeFolder(dir: string, name: string): Promise<ProjectFile> {
  const clean = normalizeFolder(name);
  return updateProject(dir, (current) => {
    current.folders = current.folders.filter((folder) => folder !== clean);
    for (const item of current.context) {
      if (item.folder === clean) item.folder = "";
    }
  });
}

function normalizeFolder(folder: string): string {
  return folder
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("/");
}

export function recordAction(
  project: ProjectFile,
  action: Pick<ActionRecord, "kind" | "label"> & Partial<ActionRecord>,
): ActionRecord {
  const record: ActionRecord = {
    id: newActionId(),
    createdAt: nowIso(),
    inputs: [],
    outputs: [],
    ...action,
  };
  project.actions.push(record);
  if (project.actions.length > 200) project.actions.splice(0, project.actions.length - 200);
  return record;
}

export function markDependentsStale(project: ProjectFile, changedId: string): void {
  const affected = new Set([changedId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of project.context) {
      if (item.stale && affected.has(item.id)) continue;
      if (item.derivedFrom.some((source) => affected.has(source))) {
        item.stale = true;
        affected.add(item.id);
        grew = true;
      }
    }
  }
  for (const meta of Object.values(project.pageMeta)) {
    if (meta.assets.some((asset) => affected.has(asset))) meta.stale = true;
  }
}

export function extractionPath(dir: string, contextId: string): string {
  return join(resolve(dir), "assets", `${contextId}.text.json`);
}

export function needsExtraction(mime: string): boolean {
  return mime === "application/pdf" || mime === "text/plain" || mime === "text/markdown";
}

async function removeAssetFile(dir: string, assetRel: string): Promise<void> {
  const assetsRoot = resolve(dir, "assets");
  const target = resolve(dir, assetRel);
  const inside = relative(assetsRoot, target);
  if (inside === "" || inside === ".." || inside.startsWith("..") || isAbsolute(inside)) return;
  await rm(target, { force: true }).catch(() => undefined);
}

async function writeProjectFile(dir: string, project: ProjectFile): Promise<void> {
  const file = projectFilePath(dir);
  await atomicWriteFile(file, `${JSON.stringify(project, null, 2)}\n`);
  try {
    const info = await stat(file);
    if (projectCache.size >= PROJECT_CACHE_LIMIT) {
      const oldest = projectCache.keys().next().value;
      if (oldest !== undefined) projectCache.delete(oldest);
    }
    projectCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, project });
  } catch {
    projectCache.delete(file);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
