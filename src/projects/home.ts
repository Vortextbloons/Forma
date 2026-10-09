import { homedir } from "node:os";
import { join } from "node:path";

export function resolveDataDir(): string {
  const fromEnv = process.env.FORMA_DATA_DIR || process.env.RIG_DATA_DIR;
  if (fromEnv) return fromEnv;
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(localAppData, "Forma");
  }
  return join(homedir(), ".forma");
}

export function resolveProjectsHome(dataDir = resolveDataDir()): string {
  return join(dataDir, "projects");
}