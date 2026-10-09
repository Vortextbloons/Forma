import {
  CancellationError,
  ProtocolError,
  serializeError,
  createLogger,
  type HostInteraction,
  type RigRuntime,
} from "rig";
import type { RigEventBus } from "rig/events";
import type { SerializedIpcError, SessionInfo, WorkerResult } from "rig/ipc";
import { setTimeout as delay } from "node:timers/promises";
import type { WorkerAgentHost } from "./host.ts";
import type { PendingRunRegistry } from "./runs.ts";
import {
  createProject,
  importContextFile,
  openProject,
  removeContextItem,
  updateContextItem,
  updateProject,
} from "../projects/store.ts";
import { forgetProject, readRecentProjects, rememberProject } from "../projects/recent.ts";
import { repairSessionIndex } from "../projects/sessions.ts";
import {
  CONTEXT_ROLES,
  PLAN_MODES,
  deriveProjectName,
  projectSettingsSchema,
  type ContextRole,
  type ProjectFile,
  type ProjectSettings,
} from "../projects/schema.ts";
import { resultErr, resultOk } from "./results.ts";

export type RuntimeInstance = Awaited<ReturnType<typeof import("rig").createRuntime>>;
export type SessionHandle = NonNullable<ReturnType<RuntimeInstance["sessions"]["get"]>>;
export type RigLogger = ReturnType<typeof createLogger>;

export interface WorkerContext {
  runtime: RuntimeInstance;
  host: WorkerAgentHost;
  bus: RigEventBus;
  logger: RigLogger;
  selectedModel: string;
  runs: PendingRunRegistry;
  getOrCreateSession(sessionId?: string): Promise<SessionHandle>;
  defaultSessionId(): string | undefined;
}

export interface CommandFrame {
  v: 1;
  type: "command";
  id: string;
  name: string;
  params?: Record<string, unknown>;
}

type CommandHandler = (params: Record<string, unknown>) => Promise<WorkerResult>;

export function isCommandFrame(frame: unknown): frame is CommandFrame {
  if (typeof frame !== "object" || frame === null) return false;
  const value = frame as Record<string, unknown>;
  return (
    value.v === 1 &&
    value.type === "command" &&
    typeof value.id === "string" &&
    typeof value.name === "string"
  );
}

export function buildDispatcher(ctx: WorkerContext): Record<string, CommandHandler> {
  const { runtime, host } = ctx;
  const ok = (data?: unknown): WorkerResult => resultOk("", data);

  return {
    async prompt(params) {
      const prompt = asString(params.prompt, "prompt");
      const sessionId = asOptionalString(params.sessionId);
      const handle = await ctx.getOrCreateSession(sessionId);
      if (ctx.runs.get(handle.id)) {
        throw new ProtocolError(
          `Session "${handle.id}" already has a running prompt; abort it first`,
        );
      }
      const run = ctx.runs.start(handle.id);
      try {
        await runtime.prompt(prompt, {
          sessionId: handle.id,
          images: asOptionalArray(params.images) as Array<{ data: string; mediaType: string }>,
        });
      } catch (error) {
        run.markAbortedIfAbortError(error);
        if (!run.settled) {
          run.settle(resultErr("", serializeError(error)));
        }
      }
      return await run.result;
    },

    async abort(params) {
      const sessionId = asOptionalString(params.sessionId) ?? ctx.defaultSessionId();
      if (sessionId) {
        const handle = runtime.sessions.get(sessionId);
        if (handle) {
          const run = ctx.runs.get(sessionId);
          run?.markAborted();
          const abortPromise = Promise.resolve(handle.abort()).catch(() => undefined);
          const settled = await Promise.race([
            abortPromise.then(() => true),
            delay(ABORT_GRACE_MS).then(() => false),
          ]);
          if (!settled && run) {
            run.settle(resultErr("", serializeError(new CancellationError())));
          }
        }
      }
      return ok();
    },

    async newSession(params) {
      const handle = await runtime.sessions.create({
        name: asOptionalString(params.name),
        parentSessionId: asOptionalString(params.parentSessionId),
        model: asOptionalString(params.model),
      });
      return ok({ session: toSessionInfo(handle, host) });
    },

    async resumeSession(params) {
      const sessionId = asString(params.sessionId, "sessionId");
      const handle = await runtime.sessions.resume(sessionId);
      return ok({ session: toSessionInfo(handle, host) });
    },

    async closeSession(params) {
      const sessionId = asString(params.sessionId, "sessionId");
      await runtime.sessions.close(sessionId);
      return ok();
    },

    async listSessions() {
      const sessions: SessionInfo[] = runtime.sessions.list().map((snapshot) => {
        const handle = runtime.sessions.get(snapshot.id);
        return handle ? toSessionInfo(handle, host) : snapshotToInfo(snapshot, host);
      });
      return ok({ sessions });
    },

    async getSession(params) {
      const sessionId = asString(params.sessionId, "sessionId");
      const handle = runtime.sessions.get(sessionId);
      if (!handle) {
        throw new ProtocolError(`Unknown session "${sessionId}"`);
      }
      return ok({ session: toSessionInfo(handle, host) });
    },

    async listModels() {
      const models = (await runtime.models.list()).map(toModelPayload);
      return ok({ models });
    },

    async listAvailableModels() {
      const models = (await runtime.models.available()).map(toModelPayload);
      return ok({ models });
    },

    async selectModel(params) {
      const ref = asString(params.ref, "ref");
      const model = await runtime.models.select(ref, asOptionalString(params.sessionId));
      ctx.selectedModel = ref;
      return ok({ model: toModelPayload(model) });
    },

    async setThinkingLevel(params) {
      const level = asString(params.level, "level") as SessionInfo["thinkingLevel"];
      const sessionId = asOptionalString(params.sessionId) ?? ctx.defaultSessionId();
      const handle = sessionId ? runtime.sessions.get(sessionId) : undefined;
      const piSession = handle?.piSession as
        | { setThinkingLevel?: (level: string) => Promise<void> | void }
        | undefined;
      if (!piSession?.setThinkingLevel) {
        throw new ProtocolError(
          `Session "${sessionId ?? "?"}" has no pi session to set the thinking level on`,
        );
      }
      await piSession.setThinkingLevel(level ?? "medium");
      return ok();
    },

    async listProviders() {
      const providers = await runtime.providers.list();
      return ok({ providers: providers.map(toProviderPayload) });
    },

    async providerStatus(params) {
      const providerId = asString(params.providerId, "providerId");
      const provider = await runtime.providers.status(providerId);
      return ok({ provider: toProviderPayload(provider) });
    },

    async providerLogin(params) {
      const providerId = asString(params.providerId, "providerId");
      await runtime.providers.login(providerId);
      return ok();
    },

    async providerLogout(params) {
      const providerId = asString(params.providerId, "providerId");
      await runtime.providers.logout(providerId);
      return ok();
    },

    async resolveInteraction(params) {
      const interactionId = asString(params.interactionId, "interactionId");
      const kind = asString(params.kind, "kind") as HostInteraction["kind"];
      if (kind !== "question" && kind !== "confirmation" && kind !== "approval") {
        throw new ProtocolError(`Invalid interaction kind "${kind}"`);
      }
      host.resolve(interactionId, kind, params.result);
      return ok();
    },

    async "project.create"(params) {
      const dir = asString(params.dir, "dir");
      const mode = asString(params.mode, "mode");
      if (!(PLAN_MODES as readonly string[]).includes(mode)) {
        throw new ProtocolError(`Invalid plan mode "${mode}"`);
      }
      const settings = parseSettings(params.settings);
      const prompt = asOptionalString(params.prompt) ?? "";
      const project = await createProject({
        dir,
        name: asOptionalString(params.name) ?? deriveProjectName(prompt),
        prompt,
        mode: mode as ProjectFile["mode"],
        settings,
      });
      await rememberProject({
        path: dir,
        name: project.name,
        output: project.settings.output,
        updatedAt: project.updatedAt,
      });
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "project.open"(params) {
      const dir = asString(params.dir, "dir");
      await repairSessionIndex(dir);
      const project = await openProject(dir);
      await rememberProject({
        path: dir,
        name: project.name,
        output: project.settings.output,
        updatedAt: project.updatedAt,
      });
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "project.updateSettings"(params) {
      const dir = asString(params.dir, "dir");
      const settings = parseSettings(params.settings);
      const project = await updateProject(dir, (current) => {
        current.settings = settings;
      });
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "project.setConversation"(params) {
      const dir = asString(params.dir, "dir");
      const sessionIds = asStringArray(params.sessionIds, "sessionIds");
      const project = await updateProject(dir, (current) => {
        current.conversation.sessionIds = sessionIds;
      });
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "context.import"(params) {
      const dir = asString(params.dir, "dir");
      const path = asString(params.path, "path");
      const role = asString(params.role, "role") as ContextRole;
      if (!(CONTEXT_ROLES as readonly string[]).includes(role)) {
        throw new ProtocolError(`Invalid context role "${role}"`);
      }
      const { project, item } = await importContextFile(
        dir,
        path,
        role,
        asOptionalString(params.name),
      );
      return ok({ project: toProjectPayload(project, dir), item });
    },

    async "context.remove"(params) {
      const dir = asString(params.dir, "dir");
      const id = asString(params.id, "id");
      const project = await removeContextItem(dir, id);
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "context.update"(params) {
      const dir = asString(params.dir, "dir");
      const id = asString(params.id, "id");
      const role = asOptionalString(params.role);
      if (role !== undefined && !(CONTEXT_ROLES as readonly string[]).includes(role)) {
        throw new ProtocolError(`Invalid context role "${role}"`);
      }
      const name = asOptionalString(params.name);
      const project = await updateContextItem(dir, id, {
        role: role as ContextRole | undefined,
        name,
      });
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "project.recent"() {
      const projects = await readRecentProjects();
      return ok({ projects });
    },

    async "project.forget"(params) {
      const dir = asString(params.dir, "dir");
      await forgetProject(dir);
      return ok();
    },
  };
}

export async function dispatchCommand(
  dispatcher: Record<string, CommandHandler>,
  command: CommandFrame,
): Promise<WorkerResult> {
  const handler = dispatcher[command.name];
  if (!handler) {
    return resultErr(command.id, {
      code: "PROTOCOL_ERROR",
      message: `Unknown command "${command.name}"`,
    });
  }
  try {
    const result = await handler((command.params ?? {}) as Record<string, unknown>);
    return { ...result, id: command.id };
  } catch (error) {
    return resultErr(command.id, serializeError(error));
  }
}

const ABORT_GRACE_MS = 2_000;

function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError(`Missing or invalid parameter "${name}" (expected non-empty string)`);
  }
  return value;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asOptionalArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ProtocolError(`Missing or invalid parameter "${name}" (expected string[])`);
  }
  return value as string[];
}

function parseSettings(value: unknown): ProjectSettings {
  const parsed = projectSettingsSchema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new ProtocolError(
      `Invalid project settings: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

export function toProjectPayload(project: ProjectFile, dir: string) {
  return { dir, project };
}

export function toSessionInfo(handle: SessionHandle, host: WorkerAgentHost): SessionInfo {
  const snapshot = handle.snapshot();
  return {
    id: snapshot.id,
    name: snapshot.name,
    status: snapshot.status,
    model: snapshot.model,
    thinkingLevel: snapshot.thinkingLevel,
    workspaceMode: handle.workspaceMode as SessionInfo["workspaceMode"],
    workspaceDir: handle.workspaceDir,
    isWorktree: handle.isWorktree,
    branch: handle.branch,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    runId: snapshot.runId,
    pendingInteractions: host.pendingForSession(snapshot.id),
  };
}

export function snapshotToInfo(
  snapshot: ReturnType<RigRuntime["sessions"]["list"]>[number],
  host: WorkerAgentHost,
): SessionInfo {
  return {
    id: snapshot.id,
    name: snapshot.name,
    status: snapshot.status,
    model: snapshot.model,
    thinkingLevel: snapshot.thinkingLevel,
    workspaceMode: "shared",
    workspaceDir: "",
    isWorktree: false,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    runId: snapshot.runId,
    pendingInteractions: host.pendingForSession(snapshot.id),
  };
}

function toModelPayload(model: {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
}) {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
  };
}

function toProviderPayload(provider: {
  id: string;
  name?: string;
  configured: boolean;
  authStatus: string;
}) {
  return {
    id: provider.id,
    name: provider.name,
    configured: provider.configured,
    authStatus: provider.authStatus,
  };
}
