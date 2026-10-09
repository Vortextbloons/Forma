




import type { RigEvent } from "../types";
import { formatClock } from "../format";

export interface Notification {
  id: number;
  sessionId?: string;
  type: "info" | "success" | "warning" | "error";
  message: string;
  timestamp: string;
}

const MAX_NOTIFICATIONS = 60;

let items = $state<Notification[]>([]);

let seq = 0;

export function push(input: Omit<Notification, "id" | "timestamp">): void {
  const now = new Date().toISOString();
  const last = items[0];
  if (last && last.message === input.message && now.slice(0, 5) === last.timestamp.slice(0, 5)) {
    last.timestamp = now;
    return;
  }
  items.unshift({ ...input, id: ++seq, timestamp: now });
  if (items.length > MAX_NOTIFICATIONS) items.length = MAX_NOTIFICATIONS;
}

export function dismiss(id: number): void {
  const i = items.findIndex((n) => n.id === id);
  if (i >= 0) items.splice(i, 1);
}

export function clearAll(): void {
  items.length = 0;
}

export function handleEvent(event: RigEvent): void {
  switch (event.type) {
    case "session.updated": {
      const { status } = event.data;
      const name = event.data.name;
      const label = name ? `Session "${name}"` : "Session";
      if (status === "completed") push({ type: "success", sessionId: event.sessionId, message: `${label} completed` });
      else if (status === "failed") push({ type: "error", sessionId: event.sessionId, message: `${label} failed` });
      else if (status === "waiting") push({ type: "info", sessionId: event.sessionId, message: `${label} is waiting for your input` });
      else if (status === "approval") push({ type: "warning", sessionId: event.sessionId, message: `${label} needs an approval` });
      break;
    }
    case "interaction.requested": {
      const kind = event.data.interaction.kind;
      const what =
        kind === "question"
          ? "Question"
          : kind === "confirmation"
            ? "Confirmation requested"
            : "Approval needed";
      push({ type: "warning", sessionId: event.sessionId, message: `${what} - your input is needed` });
      break;
    }
    case "run.failed": {
      push({
        type: "error",
        sessionId: event.sessionId,
        message: `Run failed: ${event.data.error.message}`,
      });
      break;
    }
    case "runtime.error": {
      push({
        type: event.data.fatal ? "error" : "warning",
        sessionId: event.sessionId,
        message: event.data.error.message,
      });
      break;
    }
    default:
      break;
  }
}

export const notificationStore = {
  get items() {
    return items;
  },
  push,
  dismiss,
  clearAll,
  handleEvent,
};
