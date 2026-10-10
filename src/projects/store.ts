import { copyFile, cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { RuntimeError } from "rig";
import { atomicWriteFile } from "./atomic.ts";
import { resolveProjectsHome } from "./home.ts";
import {
  PROJECT_FILE,
  newContextId,
  newPageId,
  newProjectId,
  newSourceId,
  nowIso,
  parseProjectFile,
  type ContextItem,
  type ContextRole,
  type ProjectFile,
  type ProjectSettings,
  type SourceRecord,
} from "./schema.ts";

export interface CreateProjectInput {
  dir?: string;
  name: string;
  prompt: string;
  mode: ProjectFile["mode"];
  settings: ProjectSettings;
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
      conversation: { sessionIds: [] },
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
  return target;
}

export async function openProject(dir: string): Promise<ProjectFile> {
  const file = projectFilePath(dir);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new RuntimeError(`No project found in "${resolve(dir)}"`, {
        details: { dir: resolve(dir), reason: "project-not-found" },
      });
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new RuntimeError(`Project file is not valid JSON: ${String(error)}`, {
      details: { file },
    });
  }
  return parseProjectFile(parsed, file);
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
    createdAt: nowIso(),
  };
  const project = await updateProject(dir, (current) => {
    current.context.push(item);
  });
  return { project, item };
}

export async function importContextNote(
  dir: string,
  text: string,
  role: ContextRole,
  name?: string,
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
  });
}

export interface ImportAssetInput {
  name: string;
  extension: string;
  mime: string;
  data: Uint8Array | string;
  role: ContextRole;
  sourceId?: string;
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
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    createdAt: nowIso(),
  };
  const project = await updateProject(dir, (current) => {
    current.context.push(item);
  });
  return { project, item };
}

export interface ContextPatch {
  name?: string;
  role?: ContextRole;
  status?: ContextItem["status"];
  extraction?: ContextItem["extraction"];
  error?: string | null;
  sourceId?: string;
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
  let removed: ContextItem | undefined;
  const project = await updateProject(dir, (current) => {
    const index = current.context.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new RuntimeError(`Unknown context item "${id}"`, { details: { id } });
    }
    removed = current.context[index];
    current.context.splice(index, 1);
  });
  if (removed) {
    await removeAssetFile(dir, removed.asset);
    await rm(extractionPath(dir, id), { force: true }).catch(() => undefined);
  }
  return project;
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
  await atomicWriteFile(projectFilePath(dir), `${JSON.stringify(project, null, 2)}\n`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
