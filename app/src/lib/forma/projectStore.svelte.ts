import { getBridge, openProjectDir, sendCommand, waitForReady } from "../rig/bridge";
import { notificationStore } from "../rig/stores/notificationStore.svelte";
import { sessionStore } from "../rig/stores/sessionStore.svelte";
import {
  parseProjectSnapshot,
  type ContextRole,
  type ProjectSettings,
  type ProjectSnapshot,
  type RecentProject,
} from "./types";

export type SaveStatus = "saved" | "saving" | "error";

let current = $state<ProjectSnapshot | null>(null);
let recent = $state<RecentProject[]>([]);
let saveStatus = $state<SaveStatus>("saved");
let lastError = $state<string | null>(null);

let opening = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSettings: ProjectSettings | null = null;

function reportError(error: unknown, action: string): void {
  const message = error instanceof Error ? error.message : String(error);
  lastError = message;
  notificationStore.push({ type: "error", message: `${action}: ${message}` });
}

export async function loadRecent(): Promise<void> {
  try {
    const data = (await sendCommand("project.recent")) as { projects?: unknown };
    recent = Array.isArray(data?.projects) ? (data.projects as RecentProject[]) : [];
  } catch {
    recent = [];
  }
}

export interface CreateProjectInput {
  dir: string;
  prompt: string;
  mode: "plan" | "create";
  settings: ProjectSettings;
}

export async function createProject(input: CreateProjectInput): Promise<void> {
  opening = true;
  saveStatus = "saving";
  try {
    await sendCommand(
      "project.create",
      {
        dir: input.dir,
        prompt: input.prompt,
        mode: input.mode,
        settings: input.settings,
      },
      { timeoutMs: 0 },
    );
    await openProjectDir(input.dir);
    await waitForReady(60_000);
    const data = await sendCommand("project.open", { dir: input.dir }, { timeoutMs: 60_000 });
    await attach(parseProjectSnapshot(data));
  } catch (error) {
    saveStatus = "error";
    throw error;
  } finally {
    opening = false;
  }
}

export async function openProject(dir: string): Promise<void> {
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
  saveStatus = "saved";
  lastError = null;
  await loadRecent();
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

export async function forgetRecent(dir: string): Promise<void> {
  try {
    await sendCommand("project.forget", { dir });
  } catch {
    // best effort
  }
  await loadRecent();
}

export function closeProject(): void {
  current = null;
  saveStatus = "saved";
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
  get recent() {
    return recent;
  },
  get saveStatus() {
    return saveStatus;
  },
  get lastError() {
    return lastError;
  },
  loadRecent,
  createProject,
  openProject,
  updateSettings,
  importContext,
  updateContext,
  removeContext,
  forgetRecent,
  closeProject,
  ensureConversation,
};
