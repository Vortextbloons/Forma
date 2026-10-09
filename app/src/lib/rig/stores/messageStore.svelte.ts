







import type {
  HostInteraction,
  RigEvent,
  ThinkingLevel,
} from "../types";

export interface ThinkingEntry {
  id: string;
  content: string;
  complete: boolean;
}

export interface MessageEntry {
  id: string;
  role: "user" | "assistant" | "tool-result";
  content: string;
  model?: string;
  stopReason?: string;
  status: "streaming" | "complete";
  thinking?: ThinkingEntry;
  thinkingLevel?: ThinkingLevel;
  seq: number;
}

export interface InteractionState {
  interaction: HostInteraction;
  status: "pending" | "resolved";
  result?: unknown;
  seq: number;
  toolCallId?: string;
}

interface MessageRow extends MessageEntry {
  sessionId: string;
}

interface InteractionRow extends InteractionState {
  sessionId: string;
}

let messages = $state<MessageRow[]>([]);
let interactions = $state<InteractionRow[]>([]);

function findMessage(sessionId: string, id: string): MessageRow | undefined {
  return messages.find((m) => m.sessionId === sessionId && m.id === id);
}

export function bySession(sessionId: string): MessageEntry[] {
  return messages.filter((m) => m.sessionId === sessionId);
}

export function pendingInteractions(sessionId: string): InteractionState[] {
  return interactions.filter((s) => s.sessionId === sessionId && s.status === "pending");
}


export function allInteractions(sessionId: string): InteractionState[] {
  return interactions.filter((s) => s.sessionId === sessionId);
}

export function findInteractionByToolCall(
  sessionId: string,
  toolCallId: string | undefined,
): InteractionState | undefined {
  if (!toolCallId) return undefined;
  return interactions.find(
    (s) => s.sessionId === sessionId && s.toolCallId === toolCallId,
  );
}


export function addUserMessage(sessionId: string, content: string): void {
  messages.push({
    sessionId,
    id: `user-${Date.now()}`,
    role: "user",
    content,
    status: "complete",
    seq: 0,
  });
}

function attachThinking(sessionId: string, messageId: string | undefined): MessageRow | undefined {
  const target =
    (messageId && findMessage(sessionId, messageId)) ||
    (messageId ? undefined : [...messages].reverse().find((m) => m.sessionId === sessionId));
  if (!target) return undefined;
  if (!target.thinking) {
    target.thinking = { id: "", content: "", complete: false };
  }
  return target;
}

export function handleEvent(event: RigEvent): void {
  const sessionId = event.sessionId;
  switch (event.type) {
    case "message.started": {
      const msg = event.data.message;
      const existing = findMessage(sessionId, msg.id);
      if (existing) {
        existing.content = msg.content;
        existing.status = msg.content ? "complete" : "streaming";
        existing.model = msg.model ?? existing.model;
      } else {
        messages.push({
          sessionId,
          id: msg.id,
          role: msg.role,
          content: msg.content,
          model: msg.model,
          stopReason: msg.stopReason,
          status: msg.content ? "complete" : "streaming",
          seq: event.seq,
        });
      }
      break;
    }
    case "message.delta": {
      const target = findMessage(sessionId, event.data.messageId);
      if (target) {
        target.content += event.data.delta;
        target.status = "streaming";
      }
      break;
    }
    case "message.completed": {
      const target = findMessage(sessionId, event.data.message.id);
      if (target) {
        target.content = event.data.message.content;
        target.model = event.data.message.model ?? target.model;
        target.stopReason = event.data.message.stopReason ?? target.stopReason;
        target.status = "complete";
      }
      break;
    }
    case "thinking.started": {
      const t = attachThinking(sessionId, event.data.messageId);
      if (t) {
        t.thinking = {
          id: event.data.thinkingId,
          content: event.data.content ?? "",
          complete: false,
        };
      }
      break;
    }
    case "thinking.delta": {
      const t = attachThinking(sessionId, undefined);
      if (t?.thinking) {
        t.thinking.content += event.data.delta;
        t.thinking.complete = false;
      }
      break;
    }
    case "thinking.completed": {
      const t = attachThinking(sessionId, undefined);
      if (t?.thinking) {
        t.thinking.content = event.data.content;
        t.thinking.complete = true;
      }
      break;
    }
    case "interaction.requested": {
      if (
        !interactions.some(
          (s) => s.sessionId === sessionId && s.interaction.id === event.data.interaction.id,
        )
      ) {
        interactions.push({
          sessionId,
          interaction: event.data.interaction,
          status: "pending",
          seq: event.seq,
          toolCallId: event.toolCallId,
        });
      }
      break;
    }
    case "interaction.resolved": {
      const state = interactions.find(
        (s) => s.sessionId === sessionId && s.interaction.id === event.data.interactionId,
      );
      if (state) {
        state.status = "resolved";
        state.result = event.data.result;
      }
      break;
    }
    default:
      break;
  }
}

export const messageStore = {
  bySession,
  pendingInteractions,
  allInteractions,
  findInteractionByToolCall,
  addUserMessage,
  handleEvent,
};
