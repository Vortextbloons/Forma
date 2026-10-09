import { copyFile, cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { RuntimeError } from "rig";
import { atomicWriteFile } from "./atomic.ts";
import { resolveProjectsHome } from "./home.ts";
import {
  PROJECT_FILE,
  newContextId,
  newProjectId,
  nowIso,
  parseProjectFile,
  type ContextItem,
  type ContextRole,
  type ProjectFile,
  type ProjectSettings,
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
      outline: null,
      pages: [],
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
        details: { dir: resolve(dir) },
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
  const item: ContextItem = {
    id,
    name: name?.trim() || basename(sourcePath),
    role,
    asset: assetRel,
    mime: MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
    size: info.size,
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
  });
}

export async function removeContextItem(dir: string, id: string): Promise<ProjectFile> {  let removed: ContextItem | undefined;
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
  }
  return project;
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
