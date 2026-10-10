





import { sendCommand } from "../bridge";
import { isThinkingLevel } from "../types";
import type { ModelInfo, ModelRef, RigEvent, ThinkingLevel } from "../types";
import { sessionStore } from "./sessionStore.svelte";

let models = $state<ModelInfo[]>([]);
let available = $state<ModelInfo[]>([]);
let selectedModel = $state<ModelRef>("auto");
let thinkingLevel = $state<ThinkingLevel>("medium");

function parseList(data: unknown): ModelInfo[] {
  const list = (data as { models?: unknown } | null)?.models;
  if (!Array.isArray(list)) return [];
  const out: ModelInfo[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id === "string" && typeof r.provider === "string") {
      out.push({
        provider: r.provider,
        id: r.id,
        name: typeof r.name === "string" ? r.name : undefined,
        reasoning: r.reasoning === true,
        contextWindow: typeof r.contextWindow === "number" ? r.contextWindow : undefined,
      });
    }
  }
  return out;
}

export async function refresh(): Promise<void> {
  try {
    const [all, avail] = await Promise.all([
      sendCommand("listModels"),
      sendCommand("listAvailableModels"),
    ]);
    models.length = 0;
    models.push(...parseList(all));
    available.length = 0;
    available.push(...parseList(avail));
  } catch {

  }
}

export async function select(ref: ModelRef): Promise<void> {
  try {
    const data = await sendCommand("selectModel", {
      ref,
      sessionId: sessionStore.activeSessionId ?? undefined,
    });
    selectedModel = ref;
    const raw = (data as { model?: unknown } | null)?.model;
    if (typeof raw === "object" && raw !== null && (raw as { reasoning?: unknown }).reasoning !== true) {
      await setThinkingLevel("off");
    }
  } catch {

  }
}

export async function setThinkingLevel(level: ThinkingLevel): Promise<void> {
  try {
    await sendCommand("setThinkingLevel", {
      level,
      sessionId: sessionStore.activeSessionId ?? undefined,
    });
    thinkingLevel = level;
  } catch {

    thinkingLevel = level;
  }
}

export function handleEvent(event: RigEvent): void {
  if (event.type !== "session.updated") return;
  if (event.sessionId !== sessionStore.activeSessionId) return;
  if (typeof event.data.model === "string") selectedModel = event.data.model;
  if (isThinkingLevel(event.data.thinkingLevel)) thinkingLevel = event.data.thinkingLevel;
}

export function infoFor(ref: ModelRef): ModelInfo | undefined {
  return available.find((model) => `${model.provider}/${model.id}` === ref)
    ?? models.find((model) => `${model.provider}/${model.id}` === ref);
}

export function selectedInfo(): ModelInfo | undefined {
  if (selectedModel !== "auto") {
    const match = infoFor(selectedModel);
    if (match) return match;
  }
  return available[0] ?? models[0];
}

export const modelStore = {
  get models() {
    return models;
  },
  get available() {
    return available;
  },
  get selectedModel() {
    return selectedModel;
  },
  get thinkingLevel() {
    return thinkingLevel;
  },
  refresh,
  select,
  setThinkingLevel,
  infoFor,
  selectedInfo,
  handleEvent,
};
