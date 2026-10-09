import { getBridge, openProjectDir, sendCommand, waitForReady } from "../rig/bridge";
import { notificationStore } from "../rig/stores/notificationStore.svelte";
import { sessionStore } from "../rig/stores/sessionStore.svelte";
import type { SessionStatus } from "../rig/types";
import {
  parseProjectLibrary,
  parseProjectSnapshot,
  type ContextRole,
  type ProjectListEntry,
  type ProjectSettings,
  type ProjectSnapshot,
} from "./types";

export type SaveStatus = "saved" | "saving" | "error";

let current = $state<ProjectSnapshot | null>(null);
let library = $state<ProjectListEntry[]>([]);
let libraryHome = $state("");
let boundDir = $state("");
let saveStatus = $state<SaveStatus>("saved");
let lastError = $state<string | null>(null);

let opening = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSettings: ProjectSettings | null = null;

const GENERATING_STATUSES: SessionStatus[] = ["running", "waiting", "approval"];

function reportError(error: unknown, action: string): void {
  const message = error instanceof Error ? error.message : String(error);
  lastError = message;
  notificationStore.push({ type: "error", message: `${action}: ${message}` });
}

async function stopActiveGeneration(): Promise<void> {
  const sessionId = sessionStore.activeSessionId;
  if (!sessionId || !GENERATING_STATUSES.includes(sessionStore.statusOf(sessionId))) return;
  try {
    await sendCommand("abort", { sessionId }, { timeoutMs: 5_000 });
  } catch {
    lastError = null;
  }
}

export async function loadProjects(): Promise<void> {
  try {
    const parsed = parseProjectLibrary(await sendCommand("project.list"));
    library = parsed.projects;
    libraryHome = parsed.home;
  } catch {
    library = [];
  }
}

export interface CreateProjectInput {
  prompt: string;
  mode: "plan" | "create";
  settings: ProjectSettings;
}

export async function createProject(input: CreateProjectInput): Promise<void> {
  await stopActiveGeneration();
  opening = true;
  saveStatus = "saving";
  try {
    const created = await sendCommand(
      "project.create",
      {
        prompt: input.prompt,
        mode: input.mode,
        settings: input.settings,
      },
      { timeoutMs: 0 },
    );
    const createdSnapshot = parseProjectSnapshot(created);
    await openProjectDir(createdSnapshot.dir);
    await waitForReady(60_000);
    const data = await sendCommand(
      "project.open",
      { dir: createdSnapshot.dir },
      { timeoutMs: 60_000 },
    );
    await attach(parseProjectSnapshot(data));
  } catch (error) {
    saveStatus = "error";
    throw error;
  } finally {
    opening = false;
  }
}

export async function openProject(dir: string): Promise<void> {
  await stopActiveGeneration();
  opening = true;
  saveStatus = "saving";
  try {
    await openProjectDir(dir);
    await waitForReady(60_000);
    const data = await sendCommand("project.open", { dir }, { timeoutMs: 60_000 });
    await attach(parseProjectSnapshot(data));
  } catch (error) {
    saveStatus = "error";
    throw error;
  } finally {
    opening = false;
  }
}

async function attach(snapshot: ProjectSnapshot): Promise<void> {
  current = snapshot;
  boundDir = snapshot.dir;
  saveStatus = "saved";
  lastError = null;
  await loadProjects();
  await ensureConversation();
}

export async function ensureConversation(): Promise<void> {
  if (!current) return;
  const ids = [...current.project.conversation.sessionIds].reverse();
  for (const id of ids) {
    await sessionStore.resume(id);
    if (sessionStore.byId(id)) {
      sessionStore.select(id);
      return;
    }
  }
  const info = await sessionStore.newSession("Project chat");
  if (info) {
    await setConversation([info.id]);
  }
}

async function setConversation(sessionIds: string[]): Promise<void> {
  if (!current) return;
  try {
    const data = await sendCommand("project.setConversation", {
      dir: current.dir,
      sessionIds,
    });
    current = parseProjectSnapshot(data);
  } catch (error) {
    reportError(error, "Could not record the conversation");
  }
}

export function updateSettings(settings: ProjectSettings): void {
  if (!current) return;
  pendingSettings = settings;
  current = { ...current, project: { ...current.project, settings } };
  saveStatus = "saving";
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushSettings();
  }, 350);
}

async function flushSettings(): Promise<void> {
  const settings = pendingSettings;
  if (!settings || !current) return;
  pendingSettings = null;
  try {
    const data = await sendCommand("project.updateSettings", {
      dir: current.dir,
      settings,
    });
    current = parseProjectSnapshot(data);
    saveStatus = "saved";
  } catch (error) {
    saveStatus = "error";
    reportError(error, "Could not save design settings");
  }
}

export async function importContext(paths: string[], role: ContextRole): Promise<number> {
  if (!current || paths.length === 0) return 0;
  let imported = 0;
  saveStatus = "saving";
  for (const path of paths) {
    try {
      const data = await sendCommand(
        "context.import",
        { dir: current.dir, path, role },
        { timeoutMs: 0 },
      );
      current = parseProjectSnapshot(data);
      imported += 1;
    } catch (error) {
      reportError(error, `Could not import "${path}"`);
    }
  }
  saveStatus = imported > 0 ? "saved" : "error";
  return imported;
}

export async function updateContext(
  id: string,
  patch: { name?: string; role?: ContextRole },
): Promise<void> {
  if (!current) return;
  saveStatus = "saving";
  try {
    const data = await sendCommand("context.update", { dir: current.dir, id, ...patch });
    current = parseProjectSnapshot(data);
    saveStatus = "saved";
  } catch (error) {
    saveStatus = "error";
    reportError(error, "Could not update the context item");
  }
}

export async function removeContext(id: string): Promise<void> {
  if (!current) return;
  saveStatus = "saving";
  try {
    const data = await sendCommand("context.remove", { dir: current.dir, id });
    current = parseProjectSnapshot(data);
    saveStatus = "saved";
  } catch (error) {
    saveStatus = "error";
    reportError(error, "Could not remove the context item");
  }
}

export async function renameProject(dir: string, name: string): Promise<void> {
  const data = await sendCommand("project.rename", { dir, name });
  const snapshot = parseProjectSnapshot(data);
  if (current?.dir === dir) current = snapshot;
  await loadProjects();
}

export async function duplicateProject(dir: string): Promise<void> {
  await sendCommand("project.duplicate", { dir });
  await loadProjects();
}

export async function deleteProject(dir: string): Promise<void> {
  if (current?.dir === dir) current = null;
  if (boundDir === dir && libraryHome) {
    await openProjectDir(libraryHome);
    await waitForReady(60_000);
    boundDir = "";
  }
  await sendCommand("project.delete", { dir });
  await loadProjects();
}

export async function closeProject(): Promise<void> {
  await stopActiveGeneration();
  current = null;
  saveStatus = "saved";
  lastError = null;
}

getBridge().onReady(() => {
  if (!opening && current) {
    void ensureConversation();
  }
});

export const projectStore = {
  get current() {
    return current;
  },
  get projects() {
    return library;
  },
  get libraryHome() {
    return libraryHome;
  },
  get saveStatus() {
    return saveStatus;
  },
  get lastError() {
    return lastError;
  },
  loadProjects,
  createProject,
  openProject,
  renameProject,
  duplicateProject,
  deleteProject,
  updateSettings,
  importContext,
  updateContext,
  removeContext,
  closeProject,
  ensureConversation,
};
