import type { RigEvent, Usage } from "../types";

interface SessionUsage {
  sessionId: string;
  usage: Usage;
}

let values = $state<SessionUsage[]>([]);

export function bySession(sessionId: string | null): Usage | undefined {
  if (!sessionId) return undefined;
  return values.find((entry) => entry.sessionId === sessionId)?.usage;
}

export function handleEvent(event: RigEvent): void {
  if (event.type !== "usage.updated" || !event.sessionId) return;
  const index = values.findIndex((entry) => entry.sessionId === event.sessionId);
  const next = { sessionId: event.sessionId, usage: event.data.usage };
  if (index === -1) values.push(next);
  else values[index] = next;
}

export const usageStore = { bySession, handleEvent };
