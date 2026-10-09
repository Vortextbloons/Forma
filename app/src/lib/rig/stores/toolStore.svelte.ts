






import type { RigEvent, SerializedRigError, ToolStatus } from "../types";

export interface ToolProgress {
  message?: string;
  current?: number;
  total?: number;
}

export interface ToolCallEntry {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  status: ToolStatus;
  progress?: ToolProgress;
  output?: unknown;
  error?: SerializedRigError;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  seq: number;
}

interface ToolCallRow extends ToolCallEntry {
  sessionId: string;
}

let tools = $state<ToolCallRow[]>([]);

function find(sessionId: string, toolCallId: string): ToolCallRow | undefined {
  return tools.find((t) => t.sessionId === sessionId && t.toolCallId === toolCallId);
}

function durationOf(startedAt: string, completedAt: string): number | undefined {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) return end - start;
  return undefined;
}

export function bySession(sessionId: string): ToolCallEntry[] {
  return tools.filter((t) => t.sessionId === sessionId);
}

export function get(sessionId: string, toolCallId: string): ToolCallEntry | undefined {
  return find(sessionId, toolCallId);
}

export function activeCount(sessionId: string): number {
  let count = 0;
  for (const t of tools) {
    if (t.sessionId === sessionId && t.status === "running") count += 1;
  }
  return count;
}

export function handleEvent(event: RigEvent): void {
  const sessionId = event.sessionId;
  switch (event.type) {
    case "tool.started": {
      const toolCallId = event.toolCallId ?? `tool-${event.seq}`;
      tools.push({
        sessionId,
        toolCallId,
        toolName: event.data.toolName,
        input: event.data.input,
        status: "running",
        startedAt: event.timestamp,
        seq: event.seq,
      });
      break;
    }
    case "tool.progress": {
      const entry = event.toolCallId ? find(sessionId, event.toolCallId) : tools.at(-1);
      if (!entry) break;
      entry.progress = {
        message: event.data.message,
        current: event.data.current,
        total: event.data.total,
      };
      break;
    }
    case "tool.completed": {
      const entry = event.toolCallId ? find(sessionId, event.toolCallId) : tools.at(-1);
      if (!entry) break;
      entry.output = event.data.output;
      entry.status = "completed";
      entry.completedAt = event.timestamp;
      entry.durationMs = durationOf(entry.startedAt, event.timestamp);
      break;
    }
    case "tool.failed": {
      const entry = event.toolCallId ? find(sessionId, event.toolCallId) : tools.at(-1);
      if (!entry) break;
      entry.error = event.data.error;
      entry.status = event.data.error.code === "CANCELLATION_ERROR" ? "cancelled" : "failed";
      entry.completedAt = event.timestamp;
      entry.durationMs = durationOf(entry.startedAt, event.timestamp);
      break;
    }
    default:
      break;
  }
}

export const toolStore = {
  bySession,
  get,
  activeCount,
  handleEvent,
};
