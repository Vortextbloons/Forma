import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { atomicWriteFile } from "./atomic.ts";
import { nowIso, type OutputKind } from "./schema.ts";

export interface RecentProject {
  path: string;
  name: string;
  output: OutputKind;
  updatedAt: string;
  openedAt: string;
}

interface RecentFile {
  version: 1;
  projects: RecentProject[];
}

const MAX_RECENT = 20;

export function resolveDataDir(): string {
  const fromEnv = process.env.FORMA_DATA_DIR || process.env.RIG_DATA_DIR;
  if (fromEnv) return fromEnv;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, "Forma");
  }
  return join(homedir(), ".forma");
}

export function recentFilePath(dataDir = resolveDataDir()): string {
  return join(dataDir, "recent.json");
}

export async function readRecentProjects(dataDir = resolveDataDir()): Promise<RecentProject[]> {
  const file = recentFilePath(dataDir);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<RecentFile>;
    if (!Array.isArray(parsed.projects)) return [];
    return parsed.projects.filter(
      (entry): entry is RecentProject =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.path === "string" &&
        typeof entry.name === "string",
    );
  } catch {
    return [];
  }
}

export async function rememberProject(
  entry: Omit<RecentProject, "openedAt">,
  dataDir = resolveDataDir(),
): Promise<void> {
  const projects = await readRecentProjects(dataDir);
  const next = projects.filter((item) => item.path !== entry.path);
  next.unshift({ ...entry, openedAt: nowIso() });
  const file: RecentFile = { version: 1, projects: next.slice(0, MAX_RECENT) };
  await mkdir(dirname(recentFilePath(dataDir)), { recursive: true });
  await atomicWriteFile(recentFilePath(dataDir), `${JSON.stringify(file, null, 2)}\n`);
}

export async function forgetProject(path: string, dataDir = resolveDataDir()): Promise<void> {
  const projects = await readRecentProjects(dataDir);
  const file: RecentFile = {
    version: 1,
    projects: projects.filter((item) => item.path !== path),
  };
  await mkdir(dirname(recentFilePath(dataDir)), { recursive: true });
  await atomicWriteFile(recentFilePath(dataDir), `${JSON.stringify(file, null, 2)}\n`);
}
