import { callNative, isNative } from "./native";

const FILE_READ_METHOD = "rigdesktop/services.FileService.ReadFile";
const FILE_READ_DIR_METHOD = "rigdesktop/services.FileService.ReadDir";
const FILE_STAT_METHOD = "rigdesktop/services.FileService.Stat";

export interface FileContent {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

export interface FileInfo {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
}

export class FileServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FileServiceError";
    this.code = code;
  }
}

async function nativeAvailable(): Promise<boolean> {
  try {
    return await isNative();
  } catch {
    return false;
  }
}

export async function readFile(rel: string): Promise<FileContent> {
  if (!(await nativeAvailable())) return mockReadFile(rel);
  return callNative<FileContent>(FILE_READ_METHOD, [rel]);
}

export async function readDir(rel: string): Promise<DirEntry[]> {
  if (!(await nativeAvailable())) return mockReadDir(rel);
  return callNative<DirEntry[]>(FILE_READ_DIR_METHOD, [rel]);
}

export async function stat(rel: string): Promise<FileInfo> {
  if (!(await nativeAvailable())) return mockStat(rel);
  return callNative<FileInfo>(FILE_STAT_METHOD, [rel]);
}

export const FILE_SERVICE_METHODS = {
  readFile: FILE_READ_METHOD,
  readDir: FILE_READ_DIR_METHOD,
  stat: FILE_STAT_METHOD,
} as const;

/* ------------------------------ mock fixture ------------------------------
 * Used by `npm run dev` in app/ (browser, mock bridge) so the shell renders
 * without the Go host. Traversal rules mirror fileservice.go.
 */

const MOCK_FIXTURE: Record<string, string> = {
  "README.md":
    "# Mock data folder\n\nThis file comes from the in-browser fixture in\n`app/src/lib/rig/files.ts`. Run the native app for real project files.\n",
  "notes/hello.md":
    "# Hello from the data folder\n\nReplace this fixture by running the desktop host:\nRIG_PROJECT_DIR points the Go FileService at your project root.\n",
};

function normalizeMock(rel: string): string {
  const path = rel.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (path === "." || path === "") return "";
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new FileServiceError(
      "OUTSIDE_PROJECT",
      `path escapes the project data folder: ${rel}`,
    );
  }
  return path;
}

function mockReadFile(rel: string): FileContent {
  const path = normalizeMock(rel);
  const content = MOCK_FIXTURE[path];
  if (content === undefined) {
    if (Object.keys(MOCK_FIXTURE).some((key) => key.startsWith(`${path}/`))) {
      throw new FileServiceError("IS_A_DIRECTORY", `not a file: ${rel}`);
    }
    throw new FileServiceError("NOT_FOUND", `file not found: ${rel}`);
  }
  return { path, content, size: content.length, truncated: false };
}

function mockReadDir(rel: string): DirEntry[] {
  const prefix = normalizeMock(rel);
  const entries = new Map<string, DirEntry>();
  for (const path of Object.keys(MOCK_FIXTURE)) {
    if (prefix && path !== prefix && !path.startsWith(`${prefix}/`)) continue;
    const rest = prefix ? path.slice(prefix.length + 1) : path;
    const parts = rest.split("/");
    const name = parts[0];
    if (!name) continue;
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const isDir = parts.length > 1;
    const existing = entries.get(entryPath);
    if (existing) {
      if (isDir) existing.isDir = true;
    } else {
      entries.set(entryPath, {
        name,
        path: entryPath,
        isDir,
        size: isDir ? 0 : (MOCK_FIXTURE[entryPath]?.length ?? 0),
      });
    }
  }
  if (entries.size === 0) {
    throw new FileServiceError("NOT_FOUND", `directory not found: ${rel}`);
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mockStat(rel: string): FileInfo {
  const path = normalizeMock(rel);
  const content = MOCK_FIXTURE[path];
  if (content !== undefined) {
    return {
      name: path.split("/").pop() ?? path,
      path,
      isDir: false,
      size: content.length,
      modified: "1970-01-01T00:00:00Z",
    };
  }
  const isDir = path === "" || Object.keys(MOCK_FIXTURE).some((key) => key.startsWith(`${path}/`));
  if (isDir) {
    return {
      name: path.split("/").pop() || ".",
      path,
      isDir: true,
      size: 0,
      modified: "1970-01-01T00:00:00Z",
    };
  }
  throw new FileServiceError("NOT_FOUND", `path not found: ${rel}`);
}
