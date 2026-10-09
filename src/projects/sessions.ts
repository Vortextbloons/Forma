import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { atomicWriteFile } from "./atomic.ts";

interface SessionIndexEntryLike {
  sessionFile?: unknown;
  [key: string]: unknown;
}

interface SessionIndexLike {
  version?: unknown;
  sessions?: Record<string, SessionIndexEntryLike>;
  [key: string]: unknown;
}

export async function repairSessionIndex(projectDir: string): Promise<boolean> {
  const indexFile = join(projectDir, ".rig", "state", "sessions.json");
  let parsed: SessionIndexLike;
  try {
    parsed = JSON.parse(await readFile(indexFile, "utf8")) as SessionIndexLike;
  } catch {
    return false;
  }
  if (!parsed.sessions || typeof parsed.sessions !== "object") return false;
  let changed = false;
  for (const entry of Object.values(parsed.sessions)) {
    if (!entry || typeof entry.sessionFile !== "string") continue;
    const canonical = join(projectDir, ".rig", "sessions", basename(entry.sessionFile));
    if (entry.sessionFile !== canonical) {
      entry.sessionFile = canonical;
      changed = true;
    }
  }
  if (changed) {
    await atomicWriteFile(indexFile, `${JSON.stringify(parsed, null, 2)}\n`);
  }
  return changed;
}
