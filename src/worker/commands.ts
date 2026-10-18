import { searchDefaultsSchema } from "../settings/search.ts";
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
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { basename, dirname, join, resolve } from "node:path";
import { resolveDdgsCommand, searchDdgsText } from "../search/ddgs.ts";
import type { WorkerAgentHost } from "./host.ts";
import type { PendingRunRegistry } from "./runs.ts";
import { createArtworkHandlers } from "./artwork.ts";
import { createExportHandlers } from "./exports.ts";
import { scheduleExtraction, loadExtraction } from "../extraction/index.ts";
import { projectRuns, type FormaEventSink } from "../forma/runtime.ts";
import { IMAGES_UNSUPPORTED, normalizePromptImages } from "../forma/visuals.ts";
import { prepareSessionTools } from "../tools/lazy.ts";
import {
  SEARCH_PROVIDERS,
  clearSearchKey,
  getSearchDefaults,
  setSearchDefaults,
  searchCredentialStatus,
  setSearchKey,
  type SearchProviderId,
} from "../settings/credentials.ts";
import {
  addFolder,
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
  removeFolder,
  renameProject,
  replaceContextFile,
  setContextFolder,
  updateContextItem,
  updateProject,
} from "../projects/store.ts";
import { materialPreview } from "../materials/preview.ts";
import { pythonRuntime } from "../materials/python.ts";
import { repairSessionIndex } from "../projects/sessions.ts";
import { listThemes, saveTheme } from "../projects/themes.ts";
import {
  CONTEXT_ROLES,
  PLAN_MODES,
  THINKING_LEVELS,
  deriveProjectName,
  projectPreferencesSchema,
  projectSettingsSchema,
  type ContextRole,
  type ProjectFile,
  type ProjectPreferences,
  type ProjectSettings,
} from "../projects/schema.ts";
import { resultErr, resultOk } from "./results.ts";
import { asOptionalString, asString } from "./params.ts";

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
  const { host, logger } = ctx;
  const ok = (data?: unknown): WorkerResult => resultOk("", data);

  return {
    ...createArtworkHandlers(ctx),
    ...createExportHandlers(ctx),

    async "design.listThemes"() {
      return ok({ themes: await listThemes() });
    },

    async "design.saveTheme"(params) {
      const settings = params.settings === undefined
        ? (await openProject(asString(params.dir, "dir"))).settings
        : parseSettings(params.settings);
      const theme = await saveTheme(asString(params.name, "name"), settings);
      return ok({ theme });
    },

    async prompt(params) {
      const prompt = asString(params.prompt, "prompt");
      const sessionId = asOptionalString(params.sessionId);
      const handle = await ctx.getOrCreateSession(sessionId);
      prepareSessionTools(handle);
      if (ctx.runs.get(handle.id) || projectRuns.has(handle.id)) {
        throw new ProtocolError(
          `Session "${handle.id}" already has a running prompt; abort it first`,
        );
      }
      const images = await normalizePromptImages(params.images);
      if (
        images.length > 0 &&
        (handle.piSession as { model?: { input: string[] } }).model?.input.includes("image") !== true
      ) {
        throw new ModelError(IMAGES_UNSUPPORTED, { details: { reason: "images-unsupported" } });
      }
      const run = ctx.runs.start(handle.id);
      try {
        await ctx.runtime.prompt(prompt, {
          sessionId: handle.id,
          ...(images.length > 0 ? { images } : {}),
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
        ctx.host.rejectForSession(sessionId, new CancellationError());
        const handle = ctx.runtime.sessions.get(sessionId);
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
      const handle = await ctx.runtime.sessions.create({
        name: asOptionalString(params.name),
        parentSessionId: asOptionalString(params.parentSessionId),
        model: asOptionalString(params.model),
      });
      return ok({ session: toSessionInfo(handle, host) });
    },

    async resumeSession(params) {
      const sessionId = asString(params.sessionId, "sessionId");
      const handle = await ctx.runtime.sessions.resume(sessionId);
      const piSession = handle.piSession as { messages: unknown[] };
      return ok({ session: toSessionInfo(handle, host), messages: piSession.messages });
    },

    async closeSession(params) {
      const sessionId = asString(params.sessionId, "sessionId");
      await ctx.runtime.sessions.close(sessionId);
      return ok();
    },

    async listSessions() {
      const sessions: SessionInfo[] = ctx.runtime.sessions.list().map((snapshot) => {
        const handle = ctx.runtime.sessions.get(snapshot.id);
        return handle ? toSessionInfo(handle, host) : snapshotToInfo(snapshot, host);
      });
      return ok({ sessions });
    },

    async getSession(params) {
      const sessionId = asString(params.sessionId, "sessionId");
      const handle = ctx.runtime.sessions.get(sessionId);
      if (!handle) {
        throw new ProtocolError(`Unknown session "${sessionId}"`);
      }
      return ok({ session: toSessionInfo(handle, host) });
    },

    async listModels() {
      const models = (await ctx.runtime.models.list()).map((model) => toModelPayload(ctx.runtime, model));
      return ok({ models });
    },

    async listAvailableModels() {
      const models = (await ctx.runtime.models.available()).map((model) => toModelPayload(ctx.runtime, model));
      return ok({ models });
    },

    async selectModel(params) {
      const ref = asString(params.ref, "ref");
      const sessionId = asOptionalString(params.sessionId);
      const model = await ctx.runtime.models.select(ref, sessionId);
      ctx.selectedModel = ref;
      return ok({
        model: toModelPayload(ctx.runtime, model),
        thinkingLevel: sessionId
          ? (ctx.runtime.sessions.get(sessionId)?.piSession as { thinkingLevel?: string } | undefined)?.thinkingLevel
          : undefined,
      });
    },

    async setThinkingLevel(params) {
      const level = asString(params.level, "level") as SessionInfo["thinkingLevel"];
      const sessionId = asOptionalString(params.sessionId) ?? ctx.defaultSessionId();
      const handle = sessionId ? ctx.runtime.sessions.get(sessionId) : undefined;
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
      const providers = await ctx.runtime.providers.list();
      return ok({ providers: providers.map((provider) => toProviderPayload(ctx.runtime, provider)) });
    },

    async providerStatus(params) {
      const providerId = asString(params.providerId, "providerId");
      const provider = await ctx.runtime.providers.status(providerId);
      return ok({ provider: toProviderPayload(ctx.runtime, provider) });
    },

    async providerLogin(params) {
      const providerId = asString(params.providerId, "providerId");
      await loginWithAuthEvents(ctx.runtime, host, logger, providerId);
      return ok();
    },

    async "provider.setApiKey"(params) {
      const providerId = asString(params.providerId, "providerId");
      const key = asString(params.key, "key");
      const modelRuntime = piModelRuntime(ctx.runtime);
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
      const status = await ctx.runtime.providers.status(providerId);
      return ok({ provider: toProviderPayload(ctx.runtime, status) });
    },

    async providerLogout(params) {
      const providerId = asString(params.providerId, "providerId");
      await ctx.runtime.providers.logout(providerId);
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
        preferences: parseModelPreferences(params.preferences),
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

    async "project.updatePreferences"(params) {
      const dir = asString(params.dir, "dir");
      const preferences = projectPreferencesSchema.parse(params.preferences ?? {});
      const project = await updateProject(dir, (current) => {
        current.preferences = preferences;
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
        asOptionalString(params.folder),
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
        folder: asOptionalString(params.folder),
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
      const { project, item } = await importContextNote(
        dir,
        text,
        role,
        asOptionalString(params.name),
        asOptionalString(params.folder),
      );
      if (item.status === "processing") {
        void scheduleExtraction(dir, item.id);
      }
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
        stale: typeof params.stale === "boolean" ? params.stale : undefined,
      });
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "context.replace"(params) {
      const dir = asString(params.dir, "dir");
      const id = asString(params.id, "id");
      const path = asString(params.path, "path");
      const { project, item } = await replaceContextFile(dir, id, path);
      if (item.status === "processing") {
        void scheduleExtraction(dir, item.id);
      }
      return ok({ project: toProjectPayload(project, dir), item });
    },

    async "context.move"(params) {
      const dir = asString(params.dir, "dir");
      const id = asString(params.id, "id");
      const project = await setContextFolder(dir, id, asOptionalString(params.folder) ?? "");
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "materials.addFolder"(params) {
      const dir = asString(params.dir, "dir");
      const project = await addFolder(dir, asString(params.name, "name"));
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "materials.removeFolder"(params) {
      const dir = asString(params.dir, "dir");
      const project = await removeFolder(dir, asString(params.name, "name"));
      return ok({ project: toProjectPayload(project, dir) });
    },

    async "materials.preview"(params) {
      const dir = asString(params.dir, "dir");
      const id = asString(params.id, "id");
      const project = await openProject(dir);
      const item = project.context.find((entry) => entry.id === id);
      if (!item) {
        throw new RuntimeError(`Unknown context item "${id}"`, { details: { id } });
      }
      return ok({ preview: await materialPreview(dir, item) });
    },

    async "settings.getSearch"() {
      const credentials = await searchCredentialStatus();
      return ok({ credentials, defaults: await getSearchDefaults() });
    },

    async "settings.setSearchDefaults"(params) {
      const parsed = searchDefaultsSchema.safeParse(params.defaults);
      if (!parsed.success) throw new ProtocolError("Invalid search defaults");
      await setSearchDefaults(parsed.data);
      return ok({ defaults: parsed.data });
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

    async "diagnostics.get"() {
      const ddgs = resolveDdgsCommand();
      const python = await pythonRuntime();
      return ok({
        worker: {
          pid: process.pid,
          nodeVersion: process.version,
          platform: `${process.platform} ${process.arch}`,
          rigVersion: await readRigVersion(),
        },
        ddgs: {
          python: ddgs.python,
          script: ddgs.script,
          pythonFound: existsSync(ddgs.python),
          scriptFound: existsSync(ddgs.script),
        },
        python: {
          runtime: "pyodide",
          version: python.version,
          root: python.root,
          found: python.found,
        },
      });
    },

    async "diagnostics.testSearch"() {
      const results = await searchDdgsText("design", 3);
      return ok({ count: results.length, first: results[0]?.title });
    },
  };
}

export async function readRigVersion(): Promise<string> {
  try {
    const require = createRequire(import.meta.url);
    const path = require.resolve("rig/package.json");
    const pkg = JSON.parse(await readFile(path, "utf8")) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch {}
  return "0.2.0";
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

function parseModelPreferences(
  value: unknown,
): Pick<Partial<ProjectPreferences>, "model" | "thinkingLevel"> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const preferences: Pick<Partial<ProjectPreferences>, "model" | "thinkingLevel"> = {};
  if (typeof record.model === "string" && record.model.length > 0) {
    preferences.model = record.model;
  }
  if (
    typeof record.thinkingLevel === "string" &&
    (THINKING_LEVELS as readonly string[]).includes(record.thinkingLevel)
  ) {
    preferences.thinkingLevel = record.thinkingLevel as ProjectPreferences["thinkingLevel"];
  }
  return Object.keys(preferences).length > 0 ? preferences : undefined;
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
    ...snapshotToInfo(snapshot, host),
    workspaceMode: handle.workspaceMode as SessionInfo["workspaceMode"],
    workspaceDir: handle.workspaceDir,
    isWorktree: handle.isWorktree,
    branch: handle.branch,
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
  const details = piModelRuntime(runtime).getModel(model.provider, model.id);
  return {
    provider: model.provider,
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    thinkingLevelMap: details?.thinkingLevelMap,
    input: details?.input,
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
    input?: Array<"text" | "image">;
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
