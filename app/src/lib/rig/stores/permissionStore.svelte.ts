





import { sendCommand } from "../bridge";
import type { ApprovalScope, RigEvent } from "../types";

export interface ApprovalRequestEntry {
  requestId: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  reason?: string;
}

let pending = $state<ApprovalRequestEntry[]>([]);

export function bySession(sessionId: string): ApprovalRequestEntry[] {
  return pending.filter((r) => r.sessionId === sessionId);
}

export function countFor(sessionId: string | null): number {
  if (!sessionId) return 0;
  let count = 0;
  for (const r of pending) {
    if (r.sessionId === sessionId) count += 1;
  }
  return count;
}

export async function resolve(
  request: ApprovalRequestEntry,
  decision: "allow" | "deny",
  scope: ApprovalScope,
): Promise<void> {
  const rest = pending.filter((r) => r.requestId !== request.requestId);
  pending.length = 0;
  pending.push(...rest);
  try {
    await sendCommand("resolveInteraction", {
      sessionId: request.sessionId,
      interactionId: request.requestId,
      kind: "approval",
      result: { decision, scope },
    });
  } catch {
    pending.push(request);
  }
}

export function handleEvent(event: RigEvent): void {
  switch (event.type) {
    case "approval.requested": {
      if (pending.some((r) => r.requestId === event.data.requestId)) break;
      pending.push({
        requestId: event.data.requestId,
        sessionId: event.sessionId,
        toolName: event.data.toolName,
        input: event.data.input,
        reason: event.data.reason,
      });
      break;
    }
    case "approval.resolved": {
      const rest = pending.filter((r) => r.requestId !== event.data.requestId);
      pending.length = 0;
      pending.push(...rest);
      break;
    }
    default:
      break;
  }
}

export const permissionStore = {
  bySession,
  countFor,
  resolve,
  handleEvent,
};
