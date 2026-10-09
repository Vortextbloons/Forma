





import type { RigEvent, SerializedRigError, SubagentStatus, ThinkingLevel } from "../types";

export interface SubagentEntry {
  runId: string;
  name: string;
  status: SubagentStatus;
  task: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  message?: string;
  recentTools: string[];
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  result?: unknown;
  error?: SerializedRigError;
}

interface SubagentRow extends SubagentEntry {
  sessionId: string;
}

let subagents = $state<SubagentRow[]>([]);

function find(sessionId: string, runId: string): SubagentRow | undefined {
  return subagents.find((s) => s.sessionId === sessionId && s.runId === runId);
}

function lastFor(sessionId: string): SubagentRow | undefined {
  for (let i = subagents.length - 1; i >= 0; i -= 1) {
    if (subagents[i]!.sessionId === sessionId) return subagents[i];
  }
  return undefined;
}

function durationOf(startedAt: string, completedAt: string): number | undefined {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) return end - start;
  return undefined;
}

export function bySession(sessionId: string): SubagentEntry[] {
  return subagents.filter((s) => s.sessionId === sessionId);
}

export function activeFor(sessionId: string): SubagentEntry[] {
  return subagents.filter(
    (s) => s.sessionId === sessionId && (s.status === "running" || s.status === "pending"),
  );
}

export function handleEvent(event: RigEvent): void {
  const sessionId = event.sessionId;
  switch (event.type) {
    case "subagent.started": {
      const runId = event.subagentRunId ?? event.runId ?? `sub-${event.seq}`;
      const data = event.data;
      subagents.push({
        sessionId,
        runId,
        name: data.name,
        status: "running",
        task: data.task,
        model: data.model,
        thinkingLevel: data.thinkingLevel as ThinkingLevel | undefined,
        recentTools: [],
        startedAt: event.timestamp,
      });
      break;
    }
    case "subagent.updated": {
      const runId = event.subagentRunId ?? event.runId;
      const entry = runId ? find(sessionId, runId) : lastFor(sessionId);
      if (!entry) break;
      entry.status = event.data.status;
      entry.message = event.data.message ?? entry.message;
      if (event.data.recentTools) entry.recentTools = event.data.recentTools;
      break;
    }
    case "subagent.completed": {
      const runId = event.subagentRunId ?? event.runId;
      const entry = runId ? find(sessionId, runId) : lastFor(sessionId);
      if (!entry) break;
      entry.status = "completed";
      entry.result = event.data.result;
      entry.completedAt = event.timestamp;
      entry.durationMs = durationOf(entry.startedAt, event.timestamp);
      break;
    }
    case "subagent.failed": {
      const runId = event.subagentRunId ?? event.runId;
      const entry = runId ? find(sessionId, runId) : lastFor(sessionId);
      if (!entry) break;
      entry.status = event.data.error.code === "CANCELLATION_ERROR" ? "cancelled" : "failed";
      entry.error = event.data.error;
      entry.completedAt = event.timestamp;
      entry.durationMs = durationOf(entry.startedAt, event.timestamp);
      break;
    }
    default:
      break;
  }
}

export const subagentStore = {
  bySession,
  activeFor,
  handleEvent,
};
