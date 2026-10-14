









import type {
  WorkerHello,
  WorkerReady,
  WorkerEventMessage,
  WorkerResult,
  WorkerResultOk,
  WorkerResultErr,
  WorkerErrorMessage,
  WorkerToHost,
  HostCommand,
  HostToWorker,
  CommandName,
  SerializedIpcError,
  SessionInfo,
  InspectResult,
  InspectParams,
  PromptParams,
  NewSessionParams,
  ResolveInteractionParams,
  WorktreeActionParams,
} from "rig/ipc";

export { COMMAND_NAMES } from "rig/ipc";

export const FORMA_COMMAND_NAMES = [
  "project.create",
  "project.open",
  "project.list",
  "project.rename",
  "project.duplicate",
  "project.delete",
  "project.updateSettings",
  "design.listThemes",
  "design.saveTheme",
  "project.updateBrief",
  "project.setConversation",
  "project.updatePreferences",
  "context.import",
  "context.importAsset",
  "context.importNote",
  "context.getText",
  "context.remove",
  "context.update",
  "provider.setApiKey",
  "settings.getSearch",
  "settings.setSearchDefaults",
  "settings.setSearchKey",
  "settings.clearSearchKey",
  "diagnostics.get",
  "diagnostics.testSearch",
  "artwork.plan",
  "artwork.generate",
  "artwork.refine",
  "artwork.applyDesign",
  "artwork.updateOutline",
  "artwork.reorder",
  "artwork.duplicate",
  "artwork.delete",
  "artwork.compose",
  "rendering.validate",
  "rendering.export",
  "rendering.cancelExport",
] as const;

export type FormaCommandName = (typeof FORMA_COMMAND_NAMES)[number];

export type FormaCommand = CommandName | FormaCommandName;

export type {
  WorkerHello,
  WorkerReady,
  WorkerEventMessage,
  WorkerResult,
  WorkerResultOk,
  WorkerResultErr,
  WorkerErrorMessage,
  WorkerToHost,
  HostCommand,
  HostToWorker,
  CommandName,
  SerializedIpcError,
  SessionInfo,
  InspectResult,
  InspectParams,
  PromptParams,
  NewSessionParams,
  ResolveInteractionParams,
  WorktreeActionParams,
} from "rig/ipc";

import type { RigEvent, RigEventType, EventOfType } from "rig/events";

export type { RigEvent, RigEventType, EventOfType } from "rig/events";



export type RigMessage = EventOfType<"message.started">["data"]["message"];

export type HostInteraction = EventOfType<"interaction.requested">["data"]["interaction"];
export type QuestionInteraction = Extract<HostInteraction, { kind: "question" }>;
export type ConfirmationInteraction = Extract<HostInteraction, { kind: "confirmation" }>;
export type ApprovalInteraction = Extract<HostInteraction, { kind: "approval" }>;
export type QuestionOption = NonNullable<QuestionInteraction["options"]>[number];

export type Artifact = EventOfType<"artifact.emitted">["data"]["artifact"];
export type TodoItem = EventOfType<"todo.updated">["data"]["todos"][number];
export type Usage = EventOfType<"usage.updated">["data"]["usage"];
export type SerializedRigError = EventOfType<"run.failed">["data"]["error"];



export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type SessionStatus =
  | "idle"
  | "running"
  | "waiting"
  | "approval"
  | "completed"
  | "failed";

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type ToolStatus = "running" | "completed" | "failed" | "cancelled";

export type TodoStatus = "pending" | "in_progress" | "completed";

export type SubagentStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type ApprovalScope = "once" | "session";

export type ApprovalDecision = "allow" | "ask" | "deny";

export type WorkspaceMode = "auto" | "shared" | "git-worktree" | "none";


export type ModelRef = string;

export type RigErrorCode =
  | "MODEL_ERROR"
  | "TOOL_ERROR"
  | "PERMISSION_ERROR"
  | "TIMEOUT_ERROR"
  | "CANCELLATION_ERROR"
  | "MCP_ERROR"
  | "SUBAGENT_ERROR"
  | "WORKSPACE_ERROR"
  | "INTERACTION_ERROR"
  | "CONFIG_ERROR"
  | "OUTPUT_VALIDATION_ERROR"
  | "PROTOCOL_ERROR"
  | "RUNTIME_ERROR";


export interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
  input?: string[];
  contextWindow?: number;
}


export interface ProviderInfo {
  id: string;
  name?: string;
  configured: boolean;
  authStatus: string;
  canSetApiKey?: boolean;
  canOAuth?: boolean;
  oauthLabel?: string;
  apiKeyLabel?: string;
}

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

export function isSessionStatus(value: unknown): value is SessionStatus {
  return (
    typeof value === "string" &&
    (["idle", "running", "waiting", "approval", "completed", "failed"] as string[]).includes(value)
  );
}

export function isRigErrorCode(value: unknown): value is RigErrorCode {
  return (
    typeof value === "string" &&
    (["MODEL_ERROR", "TOOL_ERROR", "PERMISSION_ERROR", "TIMEOUT_ERROR", "CANCELLATION_ERROR", "MCP_ERROR", "SUBAGENT_ERROR", "WORKSPACE_ERROR", "INTERACTION_ERROR", "CONFIG_ERROR", "OUTPUT_VALIDATION_ERROR", "PROTOCOL_ERROR", "RUNTIME_ERROR"] as string[]).includes(value)
  );
}


export function isRigEvent(value: unknown): value is RigEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as {
    version?: unknown;
    type?: unknown;
    seq?: unknown;
    sessionId?: unknown;
    timestamp?: unknown;
  };
  return (
    v.version === 1 &&
    typeof v.type === "string" &&
    typeof v.seq === "number" &&
    typeof v.sessionId === "string" &&
    typeof v.timestamp === "string"
  );
}

export interface FormaDomainEvent {
  version: 1;
  seq: number;
  timestamp: string;
  projectId: string;
  sessionId: string;
  type: string;
  data: Record<string, unknown>;
}

export function isFormaDomainEvent(value: unknown): value is FormaDomainEvent {
  return isRigEvent(value) && (value as { type: string }).type.startsWith("forma.");
}

export function isSessionInfo(value: unknown): value is SessionInfo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<SessionInfo>;
  return (
    typeof v.id === "string" &&
    isSessionStatus(v.status) &&
    typeof v.workspaceMode === "string" &&
    typeof v.workspaceDir === "string" &&
    typeof v.isWorktree === "boolean" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string"
  );
}
