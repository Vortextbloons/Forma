





import { sendCommand } from "../bridge";
import { isThinkingLevel, THINKING_LEVELS } from "../types";
import type { ModelInfo, ModelRef, RigEvent, SessionStatus, ThinkingLevel } from "../types";
import { sessionStore } from "./sessionStore.svelte";

const RUNNING_STATUSES: SessionStatus[] = ["running", "waiting", "approval"];

const MODEL_DEFAULTS_KEY = "forma:model-defaults:v1";

function loadDefaults(): { model: ModelRef; thinkingLevel: ThinkingLevel } {
  const fallback = { model: "auto" as ModelRef, thinkingLevel: "medium" as ThinkingLevel };
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(MODEL_DEFAULTS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { model?: unknown; thinkingLevel?: unknown };
    return {
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : fallback.model,
      thinkingLevel: isThinkingLevel(parsed.thinkingLevel) ? parsed.thinkingLevel : fallback.thinkingLevel,
    };
  } catch {
    return fallback;
  }
}

function persistDefaults(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(MODEL_DEFAULTS_KEY, JSON.stringify({ model: selectedModel, thinkingLevel }));
  } catch {

  }
}

const defaults = loadDefaults();

let models = $state<ModelInfo[]>([]);
let available = $state<ModelInfo[]>([]);
let selectedModel = $state<ModelRef>(defaults.model);
let thinkingLevel = $state<ThinkingLevel>(defaults.thinkingLevel);
let pendingModel: ModelRef | null = null;

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
        thinkingLevelMap: r.thinkingLevelMap as ModelInfo["thinkingLevelMap"],
        input: Array.isArray(r.input) ? r.input.filter((value): value is string => typeof value === "string") : undefined,
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
  const sessionId = sessionStore.activeSessionId;
  if (sessionId && RUNNING_STATUSES.includes(sessionStore.statusOf(sessionId))) {
    pendingModel = ref;
    selectedModel = ref;
    persistDefaults();
    return;
  }
  pendingModel = null;
  try {
    const data = await sendCommand("selectModel", {
      ref,
      sessionId: sessionStore.activeSessionId ?? undefined,
    });
    selectedModel = ref;
    const result = data as { model: ModelInfo; thinkingLevel?: unknown };
    if (isThinkingLevel(result.thinkingLevel)) {
      thinkingLevel = result.thinkingLevel;
    } else if (!supportedThinkingLevels().includes(thinkingLevel)) {
      const levels = supportedThinkingLevels();
      const index = THINKING_LEVELS.indexOf(thinkingLevel);
      const level = THINKING_LEVELS.slice(index).find((candidate) => levels.includes(candidate))
        ?? [...THINKING_LEVELS.slice(0, index)].reverse().find((candidate) => levels.includes(candidate));
      if (level) await setThinkingLevel(level);
    }
    persistDefaults();
  } catch {

  }
}

export async function setThinkingLevel(level: ThinkingLevel): Promise<void> {
  try {
    const data = await sendCommand("setThinkingLevel", {
      level,
      sessionId: sessionStore.activeSessionId ?? undefined,
    });
    const effectiveLevel = (data as { thinkingLevel?: unknown } | null)?.thinkingLevel;
    thinkingLevel = isThinkingLevel(effectiveLevel) ? effectiveLevel : level;
  } catch {

    thinkingLevel = level;
  }
  persistDefaults();
}

export async function flushPendingModel(): Promise<void> {
  if (pendingModel === null) return;
  const ref = pendingModel;
  pendingModel = null;
  await select(ref);
}

export function handleEvent(event: RigEvent): void {
  if (event.type !== "session.updated") return;
  if (event.sessionId !== sessionStore.activeSessionId) return;
  if (pendingModel === null && typeof event.data.model === "string") selectedModel = event.data.model;
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

export function supportedThinkingLevels(): readonly ThinkingLevel[] {
  const model = selectedInfo();
  if (!model?.reasoning) return ["off"];
  return THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    return (level !== "xhigh" && level !== "max") || mapped !== undefined;
  });
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
  flushPendingModel,
  setThinkingLevel,
  infoFor,
  selectedInfo,
  supportedThinkingLevels,
  handleEvent,
};
