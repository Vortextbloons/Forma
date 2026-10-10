import {
  CancellationError,
  ModelError,
  ProtocolError,
  RuntimeError,
  serializeError,
  createLogger,
  type HostInteraction,
  type RigRuntime,
} from "rig";
import type { RigEventBus } from "rig/events";
import type { SerializedIpcError, SessionInfo, WorkerResult } from "rig/ipc";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { basename, dirname, resolve } from "node:path";
import type { WorkerAgentHost } from "./host.ts";
import type { PendingRunRegistry } from "./runs.ts";
import { createArtworkHandlers } from "./artwork.ts";
import { createExportHandlers } from "./exports.ts";
import { scheduleExtraction, loadExtraction } from "../extraction/index.ts";
import { projectRuns, type FormaEventSink } from "../forma/runtime.ts";
import {
  SEARCH_PROVIDERS,
  clearSearchKey,
  searchCredentialStatus,
  setSearchKey,
  type SearchProviderId,
} from "../settings/credentials.ts";
import {
  contextAssetFormat,
  createProject,
  deleteProject,
  duplicateProject,
  importContextAsset,
  importContextFile,
  importContextNote,
  listProjects,
  openProject,
  removeContextItem,
  renameProject,
  updateContextItem,
  updateProject,
} from "../projects/store.ts";
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
  formaEvents: FormaEventSink;
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

export type CommandHandler = (params: Record<string, unknown>) => Promise<WorkerResult>;

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
  const { runtime, host, logger } = ctx;
  const ok = (data?: unknown): WorkerResult => resultOk("", data);

  return {
    ...createArtworkHandlers(ctx),
    ...createExportHandlers(ctx),

    async prompt(params) {
      const prompt = asString(params.prompt, "prompt");
      const sessionId = asOptionalString(params.sessionId);
      const handle = await ctx.getOrCreateSession(sessionId);
      if (ctx.runs.get(handle.id) || projectRuns.has(handle.id)) {
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
        const projectRun = projectRuns.get(sessionId);
        if (projectRun) projectRun.aborted = true;
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
      const piSession = handle.piSession as { messages: unknown[] };
      return ok({ session: toSessionInfo(handle, host), messages: piSession.messages });
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
      const models = (await runtime.models.list()).map((model) => toModelPayload(runtime, model));
      return ok({ models });
    },

    async listAvailableModels() {
      const models = (await runtime.models.available()).map((model) => toModelPayload(runtime, model));
      return ok({ models });
    },

    async selectModel(params) {
      const ref = asString(params.ref, "ref");
      const sessionId = asOptionalString(params.sessionId);
      const model = await runtime.models.select(ref, sessionId);
      ctx.selectedModel = ref;
      return ok({
        model: toModelPayload(runtime, model),
        thinkingLevel: sessionId
          ? (runtime.sessions.get(sessionId)?.piSession as { thinkingLevel?: string } | undefined)?.thinkingLevel
          : undefined,
      });
    },

    async setThinkingLevel(params) {
      const level = asString(params.level, "level") as SessionInfo["thinkingLevel"];
      const sessionId = asOptionalString(params.sessionId) ?? ctx.defaultSessionId();
      const handle = sessionId ? runtime.sessions.get(sessionId) : undefined;
      const piSession = handle?.piSession as
        | { setThinkingLevel?: (level: string) => Promise<void> | void; thinkingLevel?: string }
        | undefined;
      if (!piSession?.setThinkingLevel) {
        throw new ProtocolError(
          `Session "${sessionId ?? "?"}" has no pi session to set the thinking level on`,
        );
      }
      await piSession.setThinkingLevel(level ?? "medium");
      return ok({ thinkingLevel: piSession.thinkingLevel });
    },

    async listProviders() {
      const providers = await runtime.providers.list();
      return ok({ providers: providers.map((provider) => toProviderPayload(runtime, provider)) });
    },

    async providerStatus(params) {
      const providerId = asString(params.providerId, "providerId");
      const provider = await runtime.providers.status(providerId);
      return ok({ provider: toProviderPayload(runtime, provider) });
    },

    async providerLogin(params) {
      const providerId = asString(params.providerId, "providerId");
      await loginWithAuthEvents(runtime, host, logger, providerId);
      return ok();
    },

    async "provider.setApiKey"(params) {
      const providerId = asString(params.providerId, "providerId");
      const key = asString(params.key, "key");
      const modelRuntime = piModelRuntime(runtime);
      const provider = modelRuntime.getProvider(providerId);
      if (!provider) {
        throw new ModelError(`Unknown provider "${providerId}"`);
      }
      if (provider.auth.apiKey?.login === undefined) {
        throw new ModelError(
          `Provider "${providerId}" does not accept an API key; use browser sign-in instead`,
          { details: { providerId } },
        );
      }
      try {
        await modelRuntime.login(providerId, "api_key", {
          prompt: async () => key,
          notify: () => undefined,
        });
      } catch (error) {
        throw new ModelError(`Could not save the API key for "${providerId}": ${String(error)}`, {
          cause: error,
          details: { providerId },
        });
      }
      const status = await runtime.providers.status(providerId);
      return ok({ provider: toProviderPayload(runtime, status) });
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
      const mode = asString(params.mode, "mode");
      if (!(PLAN_MODES as readonly string[]).includes(mode)) {
        throw new ProtocolError(`Invalid plan mode "${mode}"`);
      }
      const settings = parseSettings(params.settings);
      const prompt = asOptionalString(params.prompt) ?? "";
      const created = await createProject({
        dir: asOptionalString(params.dir),
        name: asOptionalString(params.name) ?? deriveProjectName(prompt),
        prompt,
        mode: mode as ProjectFile["mode"],
        settings,
      });
      return ok({ project: toProjectPayload(created.project, created.dir) });
    },

    async "project.open"(params) {
      const dir = asString(params.dir, "dir");
      await repairSessionIndex(dir);
      const project = await openProject(dir);
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "project.list"() {
      const { home, projects } = await listProjects();
      return ok({ home, projects });
    },

    async "project.rename"(params) {
      const dir = asString(params.dir, "dir");
      const name = asString(params.name, "name");
      const project = await renameProject(dir, name);
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "project.duplicate"(params) {
      const dir = asString(params.dir, "dir");
      const created = await duplicateProject(dir, asOptionalString(params.name));
      return ok({ project: toProjectPayload(created.project, created.dir) });
    },

    async "project.delete"(params) {
      const dir = asString(params.dir, "dir");
      const target = resolve(dir);
      if (target === resolve(process.cwd())) {
        process.chdir(dirname(target));
      }
      const removed = await deleteProject(dir);
      return ok({ dir: removed });
    },

    async "project.updateSettings"(params) {
      const dir = asString(params.dir, "dir");
      const settings = parseSettings(params.settings);
      const project = await updateProject(dir, (current) => {
        if (JSON.stringify(current.settings) !== JSON.stringify(settings)) {
          current.settingsRevision += 1;
        }
        current.settings = settings;
      });
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "project.updateBrief"(params) {
      const dir = asString(params.dir, "dir");
      const mode = asOptionalString(params.mode);
      if (mode !== undefined && !(PLAN_MODES as readonly string[]).includes(mode)) {
        throw new ProtocolError(`Invalid plan mode "${mode}"`);
      }
      const project = await updateProject(dir, (current) => {
        const name = asOptionalString(params.name);
        const prompt = typeof params.prompt === "string" ? params.prompt : undefined;
        if (name !== undefined) current.name = name;
        if (prompt !== undefined) current.prompt = prompt;
        if (mode !== undefined) current.mode = mode as ProjectFile["mode"];
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
      if (item.status === "processing") {
        void scheduleExtraction(dir, item.id);
      }
      return ok({ project: toProjectPayload(project, dir), item });
    },

    async "context.importAsset"(params) {
      const dir = asString(params.dir, "dir");
      const role = asString(params.role, "role") as ContextRole;
      if (!(CONTEXT_ROLES as readonly string[]).includes(role)) {
        throw new ProtocolError(`Invalid context role "${role}"`);
      }
      const url = asOptionalString(params.url);
      const name = asOptionalString(params.name) ?? "";
      let mime = asOptionalString(params.mime) ?? "";
      let data: Uint8Array;
      let assetName = name;
      if (url !== undefined) {
        const parsed = parseRemoteUrl(url);
        const response = await fetch(parsed, { signal: AbortSignal.timeout(20_000) }).catch(
          (error: unknown) => {
            throw new RuntimeError(
              `Could not download "${url}": ${error instanceof Error ? error.message : String(error)}`,
            );
          },
        );
        if (!response.ok) {
          throw new RuntimeError(`Could not download "${url}" (HTTP ${response.status})`);
        }
        mime = response.headers.get("content-type") ?? "";
        data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength > 25 * 1024 * 1024) {
          throw new RuntimeError(`"${url}" is too large (${data.byteLength} bytes)`);
        }
        if (!assetName) assetName = decodeUriName(basename(parsed.pathname));
      } else {
        data = Buffer.from(asString(params.data, "data"), "base64");
        if (data.byteLength > 25 * 1024 * 1024) {
          throw new RuntimeError(`"${assetName || "Asset"}" is too large (${data.byteLength} bytes)`);
        }
      }
      const format = contextAssetFormat(assetName || url || "", mime);
      const { project, item } = await importContextAsset(dir, {
        name: assetName,
        extension: format.extension,
        mime: format.mime,
        data,
        role,
      });
      if (item.status === "processing") {
        void scheduleExtraction(dir, item.id);
      }
      return ok({ project: toProjectPayload(project, dir), item });
    },

    async "context.importNote"(params) {
      const dir = asString(params.dir, "dir");
      const text = asString(params.text, "text");
      const role = asString(params.role, "role") as ContextRole;
      if (!(CONTEXT_ROLES as readonly string[]).includes(role)) {
        throw new ProtocolError(`Invalid context role "${role}"`);
      }
      const { project, item } = await importContextNote(dir, text, role, asOptionalString(params.name));
      void scheduleExtraction(dir, item.id);
      return ok({ project: toProjectPayload(project, dir), item });
    },

    async "context.getText"(params) {
      const dir = asString(params.dir, "dir");
      const id = asString(params.id, "id");
      const project = await openProject(dir);
      const item = project.context.find((entry) => entry.id === id);
      if (!item) {
        throw new RuntimeError(`Unknown context item "${id}"`, { details: { id } });
      }
      const extraction = await loadExtraction(dir, id);
      return ok({ item, extraction });
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

    async "settings.getSearch"() {
      const credentials = await searchCredentialStatus();
      return ok({ credentials });
    },

    async "settings.setSearchKey"(params) {
      const provider = asSearchProvider(params.provider);
      const key = asString(params.key, "key");
      await setSearchKey(provider, key);
      const credentials = await searchCredentialStatus();
      return ok({ credentials });
    },

    async "settings.clearSearchKey"(params) {
      const provider = asSearchProvider(params.provider);
      await clearSearchKey(provider);
      const credentials = await searchCredentialStatus();
      return ok({ credentials });
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

function parseRemoteUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProtocolError(`Invalid URL "${value}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProtocolError(`Unsupported URL scheme "${parsed.protocol}"`);
  }
  return parsed;
}

function decodeUriName(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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

function asSearchProvider(value: unknown): SearchProviderId {
  if (typeof value !== "string" || !(SEARCH_PROVIDERS as readonly string[]).includes(value)) {
    throw new ProtocolError(
      `Invalid search provider "${String(value)}" (expected ${SEARCH_PROVIDERS.join(" or ")})`,
    );
  }
  return value as SearchProviderId;
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

function toModelPayload(runtime: RuntimeInstance, model: {
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
    thinkingLevelMap: piModelRuntime(runtime).getModel(model.provider, model.id)?.thinkingLevelMap,
    contextWindow: model.contextWindow,
  };
}

interface ProviderAuthDetails {
  apiKey?: { name?: string; login?: unknown };
  oauth?: { name?: string; loginLabel?: string; login?: unknown };
}

interface ProviderDetails {
  auth: ProviderAuthDetails;
}

type AuthPromptFacade =
  | { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string }
  | {
      type: "select";
      message: string;
      options: readonly { id: string; label: string; description?: string }[];
    };

type AuthEventFacade =
  | { type: "info"; message: string }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string }
  | { type: "progress"; message: string };

interface AuthInteractionFacade {
  prompt(prompt: AuthPromptFacade): Promise<string>;
  notify(event: AuthEventFacade): void;
}

interface PiModelRuntimeFacade {
  getModel(providerId: string, modelId: string): {
    thinkingLevelMap?: Partial<Record<NonNullable<SessionInfo["thinkingLevel"]>, string | null>>;
  } | undefined;
  getProvider(id: string): ProviderDetails | undefined;
  login(
    providerId: string,
    type: "api_key" | "oauth",
    interaction: AuthInteractionFacade,
  ): Promise<unknown>;
}

function piModelRuntime(runtime: RuntimeInstance): PiModelRuntimeFacade {
  return (runtime.pi as { modelRuntime: PiModelRuntimeFacade }).modelRuntime;
}

function toProviderPayload(
  runtime: RuntimeInstance,
  provider: {
    id: string;
    name?: string;
    configured: boolean;
    authStatus: string;
  },
) {
  const details = piModelRuntime(runtime).getProvider(provider.id);
  const apiKey = details?.auth.apiKey;
  const oauth = details?.auth.oauth;
  return {
    id: provider.id,
    name: provider.name,
    configured: provider.configured,
    authStatus: provider.authStatus,
    canSetApiKey: apiKey?.login !== undefined,
    canOAuth: oauth !== undefined,
    oauthLabel: oauth?.loginLabel ?? oauth?.name,
    apiKeyLabel: apiKey?.name,
  };
}

async function loginWithAuthEvents(
  runtime: RuntimeInstance,
  host: WorkerAgentHost,
  logger: RigLogger,
  providerId: string,
): Promise<void> {
  const modelRuntime = piModelRuntime(runtime);
  const provider = modelRuntime.getProvider(providerId);
  if (!provider) {
    throw new ModelError(`Unknown provider "${providerId}"`);
  }
  const type = provider.auth.oauth !== undefined ? "oauth" : "api_key";
  let authUrl: string | undefined;
  let info: string | undefined;
  try {
    await modelRuntime.login(providerId, type, {
      prompt: async (prompt) => {
        const interaction = {
          kind: "question" as const,
          id: randomUUID(),
          sessionId: "",
          createdAt: new Date().toISOString(),
          question: prompt.message,
          placeholder: prompt.type === "select" ? undefined : prompt.placeholder,
          options:
            prompt.type === "select"
              ? prompt.options.map((option) => ({
                  label: option.label,
                  value: option.id,
                  description: option.description,
                }))
              : undefined,
          allowCustom: prompt.type !== "select",
          secret: prompt.type === "secret" ? true : undefined,
          authUrl,
          authInfo: info,
        };
        const result = await host.requestInteraction(interaction);
        return Array.isArray(result) ? (result[0] ?? "") : result;
      },
      notify: (event) => {
        switch (event.type) {
          case "auth_url":
            authUrl = event.url;
            break;
          case "device_code":
            info = `Enter code ${event.userCode} at ${event.verificationUri}`;
            break;
          case "info":
          case "progress":
            info = event.message;
            break;
        }
        logger.info(`[auth] ${describeAuthEvent(event)}`);
      },
    });
  } catch (error) {
    throw new ModelError(`Login for provider "${providerId}" failed: ${String(error)}`, {
      cause: error,
      details: { providerId },
    });
  }
}

function describeAuthEvent(event: AuthEventFacade): string {
  switch (event.type) {
    case "info":
      return event.message;
    case "auth_url":
      return `Open ${event.url}${event.instructions ? ` (${event.instructions})` : ""}`;
    case "device_code":
      return `Device code ${event.userCode} at ${event.verificationUri}`;
    case "progress":
      return event.message;
  }
}
