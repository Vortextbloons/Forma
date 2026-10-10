





import { sendCommand } from "../bridge";
import { messageStore } from "./messageStore.svelte";
import { isSessionInfo, isThinkingLevel } from "../types";
import type { RigEvent, SessionInfo, SessionStatus, ThinkingLevel } from "../types";

let sessions = $state<SessionInfo[]>([]);
let activeSessionId = $state<string | null>(null);
let busyIds = $state<string[]>([]);

function setBusy(id: string, value: boolean): void {
  const i = busyIds.indexOf(id);
  if (value && i === -1) busyIds.push(id);
  if (!value && i !== -1) busyIds.splice(i, 1);
}

function upsert(info: SessionInfo): void {
  const i = sessions.findIndex((s) => s.id === info.id);
  if (i === -1) {
    sessions.push(info);
  } else {
    sessions[i] = { ...sessions[i]!, ...info };
  }
}

export function byId(id: string): SessionInfo | undefined {
  return sessions.find((s) => s.id === id);
}

export function statusOf(id: string | null): SessionStatus {
  if (!id) return "idle";
  return byId(id)?.status ?? "idle";
}

export function isActive(id: string): boolean {
  return activeSessionId === id;
}

export function isLoading(id: string): boolean {
  return busyIds.includes(id);
}

export function select(id: string): void {
  activeSessionId = id;
}

export async function refresh(): Promise<void> {
  try {
    const data = await sendCommand("listSessions");
    const list = (data as { sessions?: unknown } | null)?.sessions;
    if (Array.isArray(list)) {
      for (const raw of list) {
        if (isSessionInfo(raw)) upsert(raw);
      }
    }
    if (!activeSessionId && sessions.length > 0) {
      activeSessionId = sessions[0]!.id;
    }
  } catch {

  }
}

export async function newSession(name?: string): Promise<SessionInfo | undefined> {
  try {
    const data = await sendCommand("newSession", name ? { name } : undefined);
    const raw = (data as { session?: unknown } | null)?.session;
    if (isSessionInfo(raw)) {
      upsert(raw);
      activeSessionId = raw.id;
      return raw;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function resume(id: string): Promise<boolean> {
  setBusy(id, true);
  try {
    const data = await sendCommand("resumeSession", { sessionId: id });
    const raw = (data as { session?: unknown } | null)?.session;
    if (!isSessionInfo(raw)) return false;
    upsert(raw);
    messageStore.restoreMessages(id, (data as { messages?: unknown }).messages);
    activeSessionId = id;
    return true;
  } catch {
    return false;
  } finally {
    setBusy(id, false);
  }
}

export async function closeSession(id: string): Promise<void> {
  try {
    await sendCommand("closeSession", { sessionId: id });
  } catch {

  }
  const i = sessions.findIndex((s) => s.id === id);
  if (i >= 0) sessions.splice(i, 1);
  if (activeSessionId === id) {
    activeSessionId = sessions[0]?.id ?? null;
  }
}

export function handleEvent(event: RigEvent): void {
  switch (event.type) {
    case "session.created": {
      const existing = byId(event.sessionId);
      if (existing) {
        upsert({ ...existing, name: event.data.name ?? existing.name });
      } else {
        upsert({
          id: event.sessionId,
          name: event.data.name,
          status: "idle",
          model: undefined,
          thinkingLevel: undefined,
          workspaceMode: "auto",
          workspaceDir: event.data.workspaceDir ?? "",
          isWorktree: event.data.isWorktree === true,
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
          pendingInteractions: [],
        });
      }
      if (!activeSessionId) activeSessionId = event.sessionId;
      break;
    }
    case "session.updated": {
      const current = byId(event.sessionId);
      const thinking: ThinkingLevel | undefined = isThinkingLevel(event.data.thinkingLevel)
        ? event.data.thinkingLevel
        : current?.thinkingLevel;
      upsert({
        id: event.sessionId,
        name: event.data.name ?? current?.name,
        status: event.data.status,
        model: event.data.model ?? current?.model,
        thinkingLevel: thinking,
        workspaceMode: current?.workspaceMode ?? "auto",
        workspaceDir: current?.workspaceDir ?? "",
        isWorktree: current?.isWorktree ?? false,
        createdAt: current?.createdAt ?? event.timestamp,
        updatedAt: event.timestamp,
        pendingInteractions: current?.pendingInteractions ?? [],
      });
      break;
    }
    case "session.closed": {
      const current = byId(event.sessionId);
      if (current) upsert({ ...current, status: "idle", updatedAt: event.timestamp });
      break;
    }
    default:
      break;
  }
}

export const sessionStore = {
  get sessions() {
    return sessions;
  },
  get activeSessionId() {
    return activeSessionId;
  },
  byId,
  statusOf,
  isActive,
  isLoading,
  select,
  refresh,
  newSession,
  resume,
  closeSession,
  handleEvent,
};
