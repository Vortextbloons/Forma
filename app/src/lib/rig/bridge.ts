

















import { Events, getTransport } from "@wailsio/runtime";
import { defaultDesignProfile, designProfileSchema, designStyles } from "../../../../src/projects/design.ts";
import type { DesignTheme } from "../../../../src/projects/themes.ts";
import { asRecord, asString } from "./format";
import type {
  FormaCommand,
  RigEvent,
  RigErrorCode,
  SerializedIpcError,
  WorkerReady,
} from "./types";
import { isRigEvent, isRigErrorCode } from "./types";
import { sessionStore } from "./stores/sessionStore.svelte";
import { messageStore } from "./stores/messageStore.svelte";
import { toolStore } from "./stores/toolStore.svelte";
import { todoStore } from "./stores/todoStore.svelte";
import { subagentStore } from "./stores/subagentStore.svelte";
import { artifactStore } from "./stores/artifactStore.svelte";
import { modelStore } from "./stores/modelStore.svelte";
import { usageStore } from "./stores/usageStore.svelte";
import { providerStore } from "./stores/providerStore.svelte";
import { permissionStore } from "./stores/permissionStore.svelte";
import { notificationStore } from "./stores/notificationStore.svelte";
import { workerStore, markRestarting } from "./stores/workerStore.svelte";

export const COMMAND_TIMEOUT_MS = 60_000;

export interface SendOptions {

  timeoutMs?: number;
}

export interface RigBridge {
  readonly isMock: boolean;
  send(name: FormaCommand, params?: Record<string, unknown>, opts?: SendOptions): Promise<unknown>;
  onEvent(cb: (event: RigEvent) => void): () => void;
  onReady(cb: (info: WorkerReady) => void): () => void;
  onWorkerExit(cb: (info: { code: number; restartable: boolean; restarts: number }) => void): () => void;
  onWorkerError(cb: (info: { message: string; fatal?: boolean }) => void): () => void;
  waitForReady(timeoutMs?: number): Promise<WorkerReady>;
  openProject(dir: string): Promise<void>;
  restartWorker(): Promise<void>;
  stopWorker(): Promise<void>;
  close(): void;
}

export class BridgeError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.details = details;
  }
}







function allEventStores(): Array<{ handleEvent(event: RigEvent): void }> {
  return [
    sessionStore,
    messageStore,
    toolStore,
    todoStore,
    subagentStore,
    artifactStore,
    modelStore,
    usageStore,
    providerStore,
    permissionStore,
    notificationStore,
  ];
}

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  name: string;
}



abstract class BaseBridge implements RigBridge {
  readonly isMock: boolean;
  private readonly eventCbs = new Set<(event: RigEvent) => void>();
  private readonly readyCbs = new Set<(info: WorkerReady) => void>();
  private readonly exitCbs = new Set<(info: { code: number; restartable: boolean; restarts: number }) => void>();
  private readonly errorCbs = new Set<(info: { message: string; fatal?: boolean }) => void>();
  private readonly pending = new Map<string, PendingEntry>();
  private cmdSeq = 0;
  private eventSeq = 0;
  private closed = false;
  private unsubs: Array<() => void> = [];

  protected constructor(isMock: boolean) {
    this.isMock = isMock;
  }

  protected abstract emitCommandFrame(frame: { id: string; name: string; params: Record<string, unknown> }): void;

  protected abstract emitLifecycle(name: "rig:worker-restart" | "rig:worker-stop"): void;

  protected abstract emitOpenProject(dir: string): void;


  start(): void {
    this.unsubs = this.onWire();
  }

  protected abstract onWire(): Array<() => void>;



  send(name: FormaCommand, params?: Record<string, unknown>, opts?: SendOptions): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new BridgeError("PROTOCOL_ERROR", "bridge is closed"));
    }
    const id = `c${++this.cmdSeq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timeoutMs = opts?.timeoutMs ?? COMMAND_TIMEOUT_MS;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(
                new BridgeError(
                  "PROTOCOL_ERROR",
                  `command "${name}" (${id}) timed out after ${timeoutMs}ms`,
                ),
              );
            }, timeoutMs)
          : undefined;
      this.pending.set(id, { resolve, reject, timer, name });
      try {
        this.emitCommandFrame({ id, name, params: params ?? {} });
      } catch (err) {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(new BridgeError("PROTOCOL_ERROR", `failed to emit command "${name}": ${String(err)}`));
      }
    });
  }

  onEvent(cb: (event: RigEvent) => void): () => void {
    this.eventCbs.add(cb);
    return () => this.eventCbs.delete(cb);
  }

  onReady(cb: (info: WorkerReady) => void): () => void {
    this.readyCbs.add(cb);
    return () => this.readyCbs.delete(cb);
  }

  onWorkerExit(cb: (info: { code: number; restartable: boolean; restarts: number }) => void): () => void {
    this.exitCbs.add(cb);
    return () => this.exitCbs.delete(cb);
  }

  onWorkerError(cb: (info: { message: string; fatal?: boolean }) => void): () => void {
    this.errorCbs.add(cb);
    return () => this.errorCbs.delete(cb);
  }

  waitForReady(timeoutMs = 30_000): Promise<WorkerReady> {
    return new Promise<WorkerReady>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new BridgeError("TIMEOUT_ERROR", `worker did not become ready within ${timeoutMs}ms`));
      }, timeoutMs);
      const unsubscribe = this.onReady((info) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(info);
      });
    });
  }

  async openProject(dir: string): Promise<void> {
    this.emitOpenProject(dir);
  }

  async restartWorker(): Promise<void> {
    this.emitLifecycle("rig:worker-restart");
    markRestarting();
  }

  async stopWorker(): Promise<void> {
    this.emitLifecycle("rig:worker-stop");
  }

  close(): void {
    this.closed = true;
    for (const unsub of this.unsubs) {
      try {
        unsub();
      } catch {

      }
    }
    this.unsubs = [];
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new BridgeError("PROTOCOL_ERROR", `bridge closed; command "${entry.name}" abandoned`));
    }
    this.pending.clear();
    this.eventCbs.clear();
    this.readyCbs.clear();
    this.exitCbs.clear();
    this.errorCbs.clear();
  }




  protected handleRawEvent(payload: unknown): void {
    const raw = unwrapEvent(payload);
    if (!raw) return;
    this.eventSeq = Math.max(this.eventSeq + 1, raw.seq);
    const event = { ...raw, seq: this.eventSeq };
    for (const store of allEventStores()) {
      try {
        store.handleEvent(event);
      } catch (err) {
        console.error(`[rig] store failed on ${event.type}:`, err);
      }
    }
    for (const cb of this.eventCbs) {
      try {
        cb(event);
      } catch (err) {
        console.error("[rig] event subscriber failed:", err);
      }
    }
  }


  protected handleRawReady(payload: unknown): void {
    const ready = extractReady(payload);
    workerStore.handleReady(payload);
    for (const cb of this.readyCbs) cb(ready);

    void sessionStore.refresh();
    void modelStore.refresh();
    void providerStore.refresh();
  }


  protected handleRawResult(payload: unknown): void {
    const p = asRecord(payload);
    const id = typeof p.id === "string" ? p.id : undefined;
    if (!id) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    if (p.ok === true) {
      entry.resolve(p.data);
    } else {
      const error = asSerializedError(p.error);
      entry.reject(
        new BridgeError(error?.code ?? "RUNTIME_ERROR", error?.message ?? "Command failed", error?.details),
      );
    }
  }


  protected handleRawWorkerExit(payload: unknown): void {
    const p = asRecord(payload);
    const info = {
      code: typeof p.code === "number" ? p.code : -1,
      restartable: p.restartable === true,
      restarts: typeof p.restarts === "number" ? p.restarts : 0,
    };
    workerStore.handleWorkerExit(info);
    for (const cb of this.exitCbs) cb(info);
  }


  protected handleRawWorkerError(payload: unknown): void {
    const p = asRecord(payload);
    const info = {
      message: typeof p.message === "string" ? p.message : "Unknown worker error",
      fatal: p.fatal === true ? true : undefined,
    };
    workerStore.handleWorkerError(info);
    for (const cb of this.errorCbs) cb(info);
  }


  protected handleRawLog(payload: unknown): void {
    workerStore.handleWorkerLog(payload);
  }


  protected settleResult(id: string, ok: boolean, data?: unknown, error?: SerializedIpcError): void {
    this.handleRawResult(ok ? { v: 1, type: "result", id, ok: true, data } : { v: 1, type: "result", id, ok: false, error });
  }
}



class WailsBridge extends BaseBridge {
  constructor() {
    super(false);
  }

  protected onWire(): Array<() => void> {
    return [
      Events.On("rig:event", (ev) => this.handleRawEvent(ev.data)),
      Events.On("rig:ready", (ev) => this.handleRawReady(ev.data)),
      Events.On("rig:result", (ev) => this.handleRawResult(ev.data)),
      Events.On("rig:worker-exit", (ev) => this.handleRawWorkerExit(ev.data)),
      Events.On("rig:worker-error", (ev) => this.handleRawWorkerError(ev.data)),
      Events.On("rig:log", (ev) => this.handleRawLog(ev.data)),
    ];
  }

  protected emitCommandFrame(frame: { id: string; name: string; params: Record<string, unknown> }): void {
    void Events.Emit("rig:command", { v: 1, type: "command", ...frame }).catch(() => undefined);
  }

  protected emitLifecycle(name: "rig:worker-restart" | "rig:worker-stop"): void {
    void Events.Emit(name).catch(() => undefined);
  }

  protected emitOpenProject(dir: string): void {
    void Events.Emit("rig:open-project", { dir }).catch(() => undefined);
  }
}



interface MockSession {
  id: string;
  name: string;
  status: "idle" | "running";
  createdAt: string;
  updatedAt: string;
  model?: string;
}

class MockBridge extends BaseBridge {
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private seq = 0;
  private sessionSeq = 1;
  private sessions: MockSession[] = [];
  private projectDir = "/mock/project";
  private projects: Array<{ dir: string; project: Record<string, unknown> }> = [];
  private themes: DesignTheme[] = [];
  private mockSeq = 0;
  private mockPageSources: Record<string, Record<string, string>> = {};
  private mockSearchDefaults = {
    research: false,
    imageSearch: false,
    researchProvider: "ddgs",
    imageProvider: "ddgs",
  };
  private mockSearch: Record<string, { configured: boolean; masked?: string }> = {
    exa: { configured: false },
    pexels: { configured: false },
  };
  private mockProviders = [
    {
      id: "openai",
      name: "OpenAI",
      configured: false,
      authStatus: "unauthenticated",
      canSetApiKey: true,
      canOAuth: false,
      apiKeyLabel: "OpenAI API key",
    },
    {
      id: "anthropic",
      name: "Anthropic",
      configured: false,
      authStatus: "unauthenticated",
      canSetApiKey: true,
      canOAuth: true,
      oauthLabel: "Sign in with Claude",
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      configured: false,
      authStatus: "unauthenticated",
      canSetApiKey: true,
      canOAuth: true,
      oauthLabel: "Sign in with OpenRouter",
    },
    {
      id: "google",
      name: "Google",
      configured: false,
      authStatus: "unauthenticated",
      canSetApiKey: true,
      canOAuth: true,
      oauthLabel: "Sign in with Google",
    },
  ];

  constructor() {
    super(true);
    this.sessions.push({
      id: "mock-1",
      name: "Demo session",
      status: "idle",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  protected onWire(): Array<() => void> {

    this.later(250, () => this.emitReady());
    this.later(450, () => {
      const session = this.sessions[0]!;
      this.emit("session.created", { name: session.name, isWorktree: false }, { sessionId: session.id });
      this.emit("session.updated", { status: session.status, name: session.name }, { sessionId: session.id });
    });
    return [];
  }

  protected emitCommandFrame(frame: { id: string; name: string; params: Record<string, unknown> }): void {
    void this.handleCommand(frame.id, frame.name, frame.params ?? {});
  }

  protected emitLifecycle(name: "rig:worker-restart" | "rig:worker-stop"): void {
    if (name === "rig:worker-restart") {
      this.later(400, () => this.emitReady());
    }
  }

  protected emitOpenProject(dir: string): void {
    this.projectDir = dir;
    this.later(120, () => this.emitReady());
  }

  close(): void {
    super.close();
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }



  private later(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private emitReady(): void {
    this.handleRawReady({
      v: 1,
      type: "ready",
      pid: 4242,
      rigVersion: "0.2.0-mock",
      nodeVersion: "26.0.0",
      projectId: "mock-project",
      projectDir: this.projectDir,
      agentName: "Forma (mock)",
      capabilities: {
        git: true,
        worktrees: true,
        desktop: false,
        web: true,
        mcp: ["filesystem"],
        subagents: ["code-reviewer", "researcher"],
        models: 2,
        providers: ["mock"],
      },
    });
  }

  private emit(
    type: string,
    data: unknown,
    extra: {
      sessionId?: string;
      runId?: string;
      toolCallId?: string;
      subagentRunId?: string;
      projectId?: string;
    } = {},
  ): void {
    const envelope = {
      version: 1,
      seq: ++this.seq,
      timestamp: new Date().toISOString(),
      projectId: extra.projectId ?? "mock-project",
      sessionId: extra.sessionId ?? "mock-1",
      runId: extra.runId,
      toolCallId: extra.toolCallId,
      subagentRunId: extra.subagentRunId,
    };
    this.handleRawEvent({ ...envelope, type, data } as RigEvent);
  }

  private sessionInfo(session: MockSession) {
    return {
      id: session.id,
      name: session.name,
      status: session.status,
      model: session.model ?? "mock/gemini-2.5-flash",
      thinkingLevel: "medium",
      workspaceMode: "auto",
      workspaceDir: "/mock/project",
      isWorktree: false,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      pendingInteractions: [],
    };
  }

  private mockSettings(output: unknown): Record<string, unknown> {
    return {
      output: output === "poster" ? "poster" : "slides",
      style: "balance",
      density: "balanced",
      slideCount: 8,
      slideSize: { preset: "16:9", width: 1920, height: 1080 },
      posterKind: "digital",
      posterSize: { preset: "1080x1350", width: 1080, height: 1350, unit: "px" },
      orientation: "portrait",
      research: null,
      imageSearch: null,
    };
  }

  private mockProject(dir: string, id: string, overrides: Record<string, unknown>): Record<string, unknown> {
    const now = new Date().toISOString();
    return {
      formatVersion: 1,
      id,
      name: asString(overrides.name ?? "Untitled project"),
      prompt: asString(overrides.prompt ?? ""),
      mode: asString(overrides.mode ?? "plan"),
      createdAt: now,
      updatedAt: now,
      settings: { ...this.mockSettings(asRecord(overrides.settings).output), ...asRecord(overrides.settings) },
      settingsRevision: 0,
      artworkRevision: -1,
      outline: null,
      pages: [],
      pageMeta: {},
      context: [],
      sources: [],
      conversation: { sessionIds: [] },
      preferences: { model: "auto", thinkingLevel: "medium", zoom: "fit", ...asRecord(overrides.preferences) },
    };
  }

  private projectEntry(dir: string): { dir: string; project: Record<string, unknown> } | undefined {
    return this.projects.find((entry) => entry.dir === dir);
  }

  private ensureProject(dir: string, overrides: Record<string, unknown>): Record<string, unknown> {
    const existing = this.projectEntry(dir);
    if (existing) return existing.project;
    const project = this.mockProject(dir, `prj_mock_${++this.mockSeq}`, overrides);
    this.projects.unshift({ dir, project });
    return project;
  }

  private async handleCommand(id: string, name: string, params: Record<string, unknown>): Promise<void> {
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "mock-1";
    switch (name) {
      case "listSessions":
        this.settleResult(id, true, { sessions: this.sessions.map((s) => this.sessionInfo(s)) });
        break;
      case "getSession": {
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) this.settleResult(id, true, { session: this.sessionInfo(session) });
        else this.settleResult(id, false, undefined, { code: "PROTOCOL_ERROR", message: `Unknown session "${sessionId}"` });
        break;
      }
      case "newSession": {
        const session: MockSession = {
          id: `mock-${++this.sessionSeq}`,
          name: typeof params.name === "string" && params.name ? params.name : `Session ${this.sessionSeq}`,
          status: "idle",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.sessions.unshift(session);
        this.settleResult(id, true, { session: this.sessionInfo(session) });
        this.emit("session.created", { name: session.name, isWorktree: false }, { sessionId: session.id });
        break;
      }
      case "resumeSession": {
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) this.settleResult(id, true, { session: this.sessionInfo(session) });
        else this.settleResult(id, false, undefined, { code: "PROTOCOL_ERROR", message: `Unknown session "${sessionId}"` });
        break;
      }
      case "closeSession": {
        const i = this.sessions.findIndex((s) => s.id === sessionId);
        if (i >= 0) this.sessions.splice(i, 1);
        this.settleResult(id, true);
        break;
      }
      case "listModels":
        this.settleResult(id, true, {
          models: [
            { provider: "mock", id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", reasoning: false, contextWindow: 128000 },
            { provider: "mock", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", reasoning: true, contextWindow: 128000 },
          ],
        });
        break;
      case "listAvailableModels":
        this.settleResult(id, true, {
          models: [
            { provider: "mock", id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", reasoning: false, contextWindow: 128000 },
            { provider: "mock", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", reasoning: true, contextWindow: 128000 },
          ],
        });
        break;
      case "selectModel":
        this.settleResult(id, true, {
          model: { provider: "mock", id: asString(params.ref ?? "gemini-2.5-flash"), name: "Mock model" },
        });
        break;
      case "setThinkingLevel":
        this.settleResult(id, true);
        break;
      case "listProviders":
        this.settleResult(id, true, {
          providers: this.mockProviders.map((provider) => ({ ...provider })),
        });
        break;
      case "providerStatus": {
        const provider = this.mockProviders.find(
          (item) => item.id === asString(params.providerId ?? ""),
        );
        if (provider) {
          this.settleResult(id, true, { provider: { ...provider } });
        } else {
          this.settleResult(id, false, undefined, {
            code: "MODEL_ERROR",
            message: `Unknown provider "${asString(params.providerId ?? "")}" (mock)`,
          });
        }
        break;
      }
      case "provider.setApiKey": {
        const provider = this.mockProviders.find(
          (item) => item.id === asString(params.providerId ?? ""),
        );
        const key = asString(params.key ?? "");
        if (!provider || !provider.canSetApiKey) {
          this.settleResult(id, false, undefined, {
            code: "MODEL_ERROR",
            message: `Provider "${asString(params.providerId ?? "")}" does not accept an API key (mock)`,
          });
        } else if (key.length < 8) {
          this.settleResult(id, false, undefined, {
            code: "MODEL_ERROR",
            message: "That API key looks too short",
          });
        } else {
          provider.configured = true;
          provider.authStatus = "authenticated";
          this.settleResult(id, true, { provider: { ...provider } });
        }
        break;
      }
      case "providerLogin": {
        const provider = this.mockProviders.find(
          (item) => item.id === asString(params.providerId ?? ""),
        );
        if (!provider?.canOAuth) {
          this.settleResult(id, false, undefined, {
            code: "MODEL_ERROR",
            message: `Provider "${asString(params.providerId ?? "")}" does not support sign-in (mock)`,
          });
        } else {
          provider.configured = true;
          provider.authStatus = "authenticated";
          this.settleResult(id, true);
        }
        break;
      }
      case "providerLogout": {
        const provider = this.mockProviders.find(
          (item) => item.id === asString(params.providerId ?? ""),
        );
        if (provider) {
          provider.configured = false;
          provider.authStatus = "unauthenticated";
        }
        this.settleResult(id, true);
        break;
      }
      case "resolveInteraction": {
        const interactionId = asString(params.interactionId ?? "");
        const kind = asString(params.kind ?? "");
        const result = params.result;
        if (kind === "approval") {
          const decision = asRecord(result).decision === "deny" ? "deny" : "allow";
          const scope = asRecord(result).scope === "session" ? "session" : "once";
          this.emit("approval.resolved", { requestId: interactionId, decision, scope }, { sessionId });
        } else {
          this.emit("interaction.resolved", { interactionId, kind, result }, { sessionId });
        }
        this.settleResult(id, true);
        break;
      }
      case "worktree": {
        const action = asString(params.action ?? "diff");
        if (action === "diff") {
          this.settleResult(id, true, { diff: "" });
        } else {
          this.settleResult(id, true, { ok: true, action });
        }
        break;
      }
      case "inspect":
        this.settleResult(id, true, {
          inspect: {
            projectId: "mock-project",
            projectDir: "/mock/project",
            rigVersion: "0.2.0-mock",
            config: {},
            agent: { name: "Rig (mock)", tools: ["shell", "read", "edit", "web_search"] },
            capabilities: { mcp: ["filesystem"] },
            models: { available: 2, total: 2, selected: "mock/gemini-2.5-flash" },
            providers: [{ id: "mock", configured: true, authStatus: "ready" }],
            sessions: this.sessions.map((s) => this.sessionInfo(s)),
            worktrees: [],
            envChecks: [{ name: "git", ok: true }],
          },
        });
        break;
      case "abort":
        this.settleResult(id, true);
        break;
      case "shutdown":
        this.settleResult(id, true);
        break;
      case "prompt": {
        const prompt = asString(params.prompt ?? "");
        this.playCannedReply(id, sessionId, prompt);
        break;
      }
      case "project.create": {
        const pid = `prj_mock_${++this.mockSeq}`;
        const dir = typeof params.dir === "string" && params.dir ? params.dir : `/mock/projects/${pid}`;
        const project = this.mockProject(dir, pid, params);
        this.projects.unshift({ dir, project });
        this.projectDir = dir;
        this.settleResult(id, true, { project: { dir, project } });
        break;
      }
      case "project.open": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {
          name: "Mock project",
          prompt: "A mock project for browser development",
          mode: "plan",
          settings: {},
        });
        this.projectDir = dir;
        this.settleResult(id, true, { project: { dir, project } });
        break;
      }
      case "project.list": {
        const projects = [...this.projects].sort((a, b) =>
          String(asRecord(b.project).updatedAt ?? "").localeCompare(String(asRecord(a.project).updatedAt ?? "")),
        );
        this.settleResult(id, true, { home: "/mock/projects", projects });
        break;
      }
      case "project.rename": {
        const dir = asString(params.dir ?? "");
        const project = this.ensureProject(dir, {});
        project.name = asString(params.name ?? "Untitled project");
        project.updatedAt = new Date().toISOString();
        this.settleResult(id, true, { project: { dir, project } });
        break;
      }
      case "project.duplicate": {
        const dir = asString(params.dir ?? "");
        const source = this.projectEntry(dir);
        if (!source) {
          this.settleResult(id, false, undefined, {
            code: "RUNTIME_ERROR",
            message: `No project at "${dir}"`,
          });
          break;
        }
        const pid = `prj_mock_${++this.mockSeq}`;
        const copy = structuredClone(source.project);
        copy.id = pid;
        copy.name =
          typeof params.name === "string" && params.name ? params.name : `${asString(copy.name)} copy`;
        copy.createdAt = new Date().toISOString();
        copy.updatedAt = copy.createdAt;
        copy.conversation = { sessionIds: [] };
        const copyDir = `/mock/projects/${pid}`;
        this.projects.unshift({ dir: copyDir, project: copy });
        this.settleResult(id, true, { project: { dir: copyDir, project: copy } });
        break;
      }
      case "project.delete": {
        const dir = asString(params.dir ?? "");
        this.projects = this.projects.filter((entry) => entry.dir !== dir);
        this.settleResult(id, true, { dir });
        break;
      }
      case "project.updateSettings": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        project.settings = {
          ...asRecord(project.settings),
          ...asRecord(params.settings),
        };
        project.updatedAt = new Date().toISOString();
        this.settleResult(id, true, { project: { dir, project } });
        break;
      }
      case "design.listThemes": {
        this.settleResult(id, true, { themes: this.themes });
        break;
      }
      case "design.saveTheme": {
        const project = this.ensureProject(asString(params.dir ?? this.projectDir), {});
        const settings = asRecord(project.settings);
        const theme: DesignTheme = {
          id: crypto.randomUUID(),
          name: asString(params.name).trim(),
          style: settings.style as DesignTheme["style"],
          density: settings.density as DesignTheme["density"],
          designProfile: designProfileSchema.parse(settings.designProfile ?? defaultDesignProfile()),
          createdAt: new Date().toISOString(),
        };
        this.themes.push(theme);
        this.settleResult(id, true, { theme });
        break;
      }
      case "project.updateBrief": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        if (typeof params.name === "string" && params.name) project.name = params.name;
        if (typeof params.prompt === "string") project.prompt = params.prompt;
        if (params.mode === "plan" || params.mode === "create") project.mode = params.mode;
        project.updatedAt = new Date().toISOString();
        this.settleResult(id, true, { project: { dir, project } });
        break;
      }
      case "project.setConversation": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        project.conversation = {
          sessionIds: Array.isArray(params.sessionIds) ? params.sessionIds : [],
        };
        this.settleResult(id, true, { project: { dir, project } });
        break;
      }
      case "project.updatePreferences": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        project.preferences = asRecord(params.preferences);
        this.settleResult(id, true, { project: { dir, project } });
        break;
      }
      case "context.import": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        const item = {
          id: `ctx_mock_${++this.seq}`,
          name: asString(params.name ?? "Mock asset"),
          role: asString(params.role ?? "optional"),
          asset: "assets/mock-asset",
          mime: "application/octet-stream",
          size: 0,
          createdAt: new Date().toISOString(),
        };
        (project.context as unknown[]).push(item);
        project.updatedAt = new Date().toISOString();
        this.settleResult(id, true, { project: { dir, project }, item });
        break;
      }
      case "context.importAsset": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        const url = asString(params.url);
        const item: Record<string, unknown> = {
          id: `ctx_mock_${++this.seq}`,
          name: asString(params.name ?? url.split("/").pop() ?? "Imported image"),
          role: asString(params.role ?? "optional"),
          asset: "assets/mock-image.png",
          mime: asString(params.mime ?? "image/png"),
          size: asString(params.data).length,
          status: "ready",
          createdAt: new Date().toISOString(),
        };
        (project.context as unknown[]).push(item);
        project.updatedAt = new Date().toISOString();
        this.settleResult(id, true, { project: { dir, project }, item });
        break;
      }
      case "context.remove": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        const context = Array.isArray(project.context) ? project.context : [];
        project.context = context.filter(
          (entry) => asRecord(entry).id !== asString(params.id ?? ""),
        );
        project.updatedAt = new Date().toISOString();
        this.settleResult(id, true, { project: { dir, project } });
        break;
      }
      case "context.update": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        const context = Array.isArray(project.context) ? project.context : [];
        for (const entry of context) {
          const record = asRecord(entry);
          if (record.id === asString(params.id ?? "")) {
            if (typeof params.role === "string") record.role = params.role;
            if (typeof params.name === "string") record.name = params.name;
          }
        }
        project.updatedAt = new Date().toISOString();
        this.settleResult(id, true, { project: { dir, project } });
        break;
      }
      case "context.importNote": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        const text = asString(params.text ?? "");
        const item: Record<string, unknown> = {
          id: `ctx_mock_${++this.seq}`,
          name: asString(params.name ?? "Pasted note"),
          role: asString(params.role ?? "content-source"),
          asset: "assets/mock-note.md",
          mime: "text/markdown",
          size: text.length,
          status: "processing",
          createdAt: new Date().toISOString(),
        };
        (project.context as unknown[]).push(item);
        project.updatedAt = new Date().toISOString();
        this.later(600, () => {
          item.status = "ready";
          const extraction = { kind: "text", pages: 1, chars: text.length };
          item.extraction = extraction;
          this.emit(
            "forma.context.ready",
            { id: item.id, status: "ready", extraction },
            { sessionId, projectId: asString(project.id) },
          );
        });
        this.settleResult(id, true, { project: { dir, project }, item });
        break;
      }
      case "context.getText": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        const item = (Array.isArray(project.context) ? project.context : []).find(
          (entry) => asRecord(entry).id === asString(params.id ?? ""),
        );
        this.settleResult(id, true, {
          item,
          extraction: {
            id: asString(params.id ?? ""),
            name: asRecord(item).name ?? "Note",
            mime: "text/markdown",
            kind: "text",
            pages: [{ page: 1, source: "text", text: "Mock extracted text for browser development." }],
          },
        });
        break;
      }
      case "settings.getSearch":
        this.settleResult(id, true, { credentials: { ...this.mockSearch }, defaults: { ...this.mockSearchDefaults } });
        break;
      case "settings.setSearchDefaults":
        this.mockSearchDefaults = params.defaults as typeof this.mockSearchDefaults;
        this.settleResult(id, true, { defaults: { ...this.mockSearchDefaults } });
        break;
      case "settings.setSearchKey": {
        const provider = asString(params.provider ?? "");
        const key = asString(params.key ?? "");
        this.mockSearch[provider] = {
          configured: true,
          masked: `${key.slice(0, 4)}…${key.slice(-4)}`,
        };
        this.settleResult(id, true, { credentials: { ...this.mockSearch } });
        break;
      }
      case "settings.clearSearchKey": {
        const provider = asString(params.provider ?? "");
        this.mockSearch[provider] = { configured: false };
        this.settleResult(id, true, { credentials: { ...this.mockSearch } });
        break;
      }
      case "diagnostics.get":
        this.settleResult(id, true, {
          worker: { pid: 4242, nodeVersion: "26.0.0", platform: "win32 x64", rigVersion: "0.2.0-mock" },
          ddgs: {
            python: "C:\\forma\\desktop\\bin\\ddgs\\Scripts\\python.exe",
            script: "C:\\forma\\src\\search\\ddgs\\helper.py",
            pythonFound: true,
            scriptFound: true,
          },
        });
        break;
      case "diagnostics.testSearch":
        this.later(700, () =>
          this.settleResult(id, true, { count: 3, first: "Design — overview of systems and practice" }),
        );
        break;
      case "artwork.plan":
      case "artwork.generate":
      case "artwork.refine":
      case "artwork.applyDesign":
        this.playArtwork(id, sessionId, name, params);
        break;
      case "artwork.updateOutline": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        const entries = Array.isArray(params.outline) ? params.outline : [];
        project.outline = entries.map((entry) => {
          const record = asRecord(entry);
          return {
            id: asString(record.id ?? `pg_mock_${++this.seq}`),
            title: asString(record.title ?? "Untitled"),
            points: Array.isArray(record.points) ? record.points : [],
            visualDirection: record.visualDirection,
            assetIds: Array.isArray(record.assetIds) ? record.assetIds : [],
          };
        });
        project.updatedAt = new Date().toISOString();
        this.settleResult(id, true, { project: { dir, project } });
        break;
      }
      case "artwork.reorder": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        const pages = Array.isArray(project.pages) ? [...project.pages] : [];
        const from = pages.indexOf(asString(params.pageId ?? ""));
        const toIndex = typeof params.toIndex === "number" ? params.toIndex : 1;
        if (from >= 0) {
          pages.splice(from, 1);
          pages.splice(Math.min(Math.max(toIndex - 1, 0), pages.length), 0, asString(params.pageId ?? ""));
        }
        project.pages = pages;
        this.settleResult(id, true, { project: { dir, project } });
        break;
      }
      case "artwork.duplicate": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        const pages = Array.isArray(project.pages) ? [...project.pages] : [];
        const from = pages.indexOf(asString(params.pageId ?? ""));
        const copyId = `pg_mock_${++this.seq}`;
        if (from >= 0) pages.splice(from + 1, 0, copyId);
        project.pages = pages;
        const meta = asRecord(asRecord(project.pageMeta)[asString(params.pageId ?? "")]);
        asRecord(project.pageMeta)[copyId] = {
          title: `${asString(meta.title ?? "Slide")} copy`,
          assets: [],
          updatedAt: new Date().toISOString(),
        };
        this.settleResult(id, true, { project: { dir, project }, pageId: copyId });
        break;
      }
      case "artwork.delete": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        project.pages = (Array.isArray(project.pages) ? project.pages : []).filter(
          (pageId) => pageId !== asString(params.pageId ?? ""),
        );
        delete asRecord(project.pageMeta)[asString(params.pageId ?? "")];
        this.settleResult(id, true, { project: { dir, project } });
        break;
      }
      case "artwork.compose": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        const settings = asRecord(project.settings);
        const size = settings.output === "poster" ? asRecord(settings.posterSize) : asRecord(settings.slideSize);
        const width = typeof size.width === "number" ? size.width : 1920;
        const height = typeof size.height === "number" ? size.height : 1080;
        const unit = typeof size.unit === "string" ? size.unit : "px";
        const pageId = asString(params.pageId ?? "");
        const index = (Array.isArray(project.pages) ? project.pages : []).indexOf(pageId);
        const title = asString(asRecord(asRecord(project.pageMeta)[pageId]).title ?? `Slide ${index + 1}`);
        const html = [
          "<!doctype html><html><head><meta charset=\"utf-8\"><style>",
          `html,body{margin:0;width:${width}${unit};height:${height}${unit};background:#fff;font-family:"Segoe UI",sans-serif}`,
          `.forma-page{width:${width}${unit};height:${height}${unit};padding:7%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:3%}`,
          `h1{font-size:${Math.max(28, Math.round(height / 9))}px;margin:0;color:#24343D}`,
          `p{font-size:${Math.max(14, Math.round(height / 26))}px;color:#61717B;margin:0}`,
          settings.designProfile ? designStyles(designProfileSchema.parse(settings.designProfile), { width, height, unit: unit as "px" | "mm" | "in" }) : "",
          settings.designProfile ? "h1{color:var(--forma-accent);font-size:var(--forma-heading-size);font-family:var(--forma-font-heading)}p{color:var(--forma-muted);font-size:var(--forma-body-size);font-family:var(--forma-font-body)}" : "",
          "</style></head><body><div class=\"forma-page\">",
          `<h1>${title.replace(/[<>&]/g, "")}</h1>`,
          `<p>Mock artwork preview · page ${index + 1}</p>`,
          "</div></body></html>",
        ].join("");
        this.settleResult(id, true, { html, missing: [] });
        break;
      }
      case "artwork.readEditable": {
        const dir = asString(params.dir ?? this.projectDir);
        const pageId = asString(params.pageId ?? "");
        const html = this.mockPageSources[dir]?.[pageId] ?? "<p>Mock editable artwork</p>";
        this.settleResult(id, true, { html, css: "", revision: "mock" });
        break;
      }
      case "artwork.saveEditable": {
        const dir = asString(params.dir ?? this.projectDir);
        const pageId = asString(params.pageId ?? "");
        const project = this.ensureProject(dir, {});
        this.mockPageSources[dir] = {
          ...this.mockPageSources[dir],
          [pageId]: asString(params.html ?? ""),
        };
        project.updatedAt = new Date().toISOString();
        this.settleResult(id, true, { project: { dir, project }, revision: "mock" });
        break;
      }
      case "rendering.validate": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        const pages = Array.isArray(project.pages) ? project.pages.length : 0;
        const report = { issues: [], pages, checkedAt: new Date().toISOString() };
        this.emit(
          "forma.validation.ready",
          { issues: [], pages },
          { sessionId, projectId: asString(project.id) },
        );
        this.settleResult(id, true, { report });
        break;
      }
      case "rendering.export": {
        const dir = asString(params.dir ?? this.projectDir);
        const project = this.ensureProject(dir, {});
        const format = asString(params.format ?? "pdf");
        const scope = asString(params.scope ?? "all");
        const destination = asString(params.destination ?? `/mock/exports/export.${format}`);
        const runId = asString(params.runId ?? `exp_mock_${++this.seq}`);
        const total = scope === "all" ? (Array.isArray(project.pages) ? project.pages.length : 0) : 1;
        const extra = { sessionId, projectId: asString(project.id) };
        this.emit("forma.export.progress", { runId, format, phase: "started", completed: 0, total }, extra);
        this.later(700, () => {
          this.emit("forma.export.progress", { runId, format, phase: "page", completed: total, total }, extra);
          this.emit("forma.export.completed", { runId, format, files: [destination] }, extra);
          this.settleResult(id, true, { runId, files: [destination] });
        });
        break;
      }
      case "rendering.cancelExport":
        this.settleResult(id, true);
        break;
      default:
        this.settleResult(id, false, undefined, {
          code: "PROTOCOL_ERROR",
          message: `Unknown command "${name}" (mock)`,
        });
    }
  }



  private playArtwork(id: string, sessionId: string, command: string, params: Record<string, unknown>): void {
    const dir = asString(params.dir ?? this.projectDir);
    const project = this.ensureProject(dir, {});
    const settings = asRecord(project.settings);
    const isPoster = settings.output === "poster";
    const kind =
      command === "artwork.plan"
        ? "outline"
        : command === "artwork.refine"
          ? "refine"
          : command === "artwork.applyDesign"
            ? "design"
            : "artwork";
    const slideCount = typeof settings.slideCount === "number" ? settings.slideCount : 8;
    const existingOutline = Array.isArray(project.outline) ? project.outline : [];
    const count = isPoster ? 1 : existingOutline.length > 0 ? existingOutline.length : slideCount;
    const eventExtra = { sessionId, projectId: asString(project.id) };
    this.emit("forma.run.progress", { kind, phase: "started", total: count }, eventExtra);
    const finish = (): void => {
      project.updatedAt = new Date().toISOString();
      if (kind !== "outline") {
        project.artworkRevision =
          typeof project.settingsRevision === "number" ? project.settingsRevision : 0;
      }
      this.emit("forma.run.settled", { kind, ok: true }, eventExtra);
      this.settleResult(id, true, { project: { dir, project } });
    };
    if (kind === "outline") {
      const entries = Array.from({ length: count }, (_, i) => ({
        id: `pg_mock_${++this.mockSeq}`,
        title: isPoster ? "Poster" : `Slide ${i + 1}`,
        points: ["A key point", "Supporting detail"],
        visualDirection: "Quiet studio layout",
        assetIds: [],
      }));
      project.outline = entries;
      this.later(800, () => {
        this.emit("forma.outline.ready", { outline: entries }, eventExtra);
        finish();
      });
      return;
    }
    const outline = Array.isArray(project.outline) ? project.outline : [];
    const pageIds: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const entry = asRecord(outline[i]);
      const existing = Array.isArray(project.pages) ? project.pages[i] : undefined;
      pageIds.push(asString(entry.id ?? existing ?? `pg_mock_${++this.mockSeq}`));
    }
    project.pages = pageIds;
    const pageMeta = asRecord(project.pageMeta);
    for (const [i, pageId] of pageIds.entries()) {
      const entry = asRecord(outline[i]);
      pageMeta[pageId] = {
        title: asString(entry.title ?? `Slide ${i + 1}`),
        assets: [],
        updatedAt: new Date().toISOString(),
      };
    }
    project.pageMeta = pageMeta;
    let step = 0;
    const tick = (): void => {
      if (step >= pageIds.length) {
        finish();
        return;
      }
      const pageId = pageIds[step]!;
      const entry = asRecord(outline[step]);
      this.emit(
        "forma.page.ready",
        {
          pageId,
          index: step + 1,
          total: pageIds.length,
          title: asString(entry.title ?? `Slide ${step + 1}`),
          assets: [],
        },
        eventExtra,
      );
      step += 1;
      this.later(420, tick);
    };
    this.later(600, tick);
  }

  private playCannedReply(id: string, sessionId: string, prompt: string): void {
    const runId = `run-${Date.now()}`;
    const messageId = `msg-${runId}`;
    this.sessions.forEach((s) => {
      if (s.id === sessionId) {
        s.status = "running";
        s.updatedAt = new Date().toISOString();
      }
    });
    this.emit("session.updated", { status: "running" }, { sessionId });
    this.emit("run.started", { prompt }, { sessionId, runId });
    this.emit("message.started", { message: { id: messageId, role: "assistant", content: "", model: "mock/gemini-2.5-flash" } }, { sessionId, runId });
    const reply = `Mock reply to: ${truncateForMock(prompt)}`;
    const chunks = splitIntoChunks(reply, 14);
    chunks.forEach((chunk, i) => {
      this.later(300 + i * 180, () =>
        this.emit("message.delta", { messageId, delta: chunk }, { sessionId, runId }),
      );
    });
    const end = 300 + chunks.length * 180 + 200;
    this.later(end, () => {
      this.emit("message.completed", { message: { id: messageId, role: "assistant", content: reply, model: "mock/gemini-2.5-flash" } }, { sessionId, runId });
      this.emit("run.completed", { result: { ok: true } }, { sessionId, runId });
      this.sessions.forEach((s) => {
        if (s.id === sessionId) s.status = "idle";
      });
      this.emit("session.updated", { status: "idle" }, { sessionId });
      this.settleResult(id, true, { ok: true });
    });
  }

}



function unwrapEvent(payload: unknown): RigEvent | null {
  if (payload === null || payload === undefined) return null;
  let value: unknown = payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && value !== null) {
    if (isRigEvent(value)) return value;

    const wrapped = value as { type?: unknown; event?: unknown };
    if (wrapped.type === "event" && wrapped.event !== undefined) {
      return unwrapEvent(wrapped.event);
    }
  }
  return null;
}

function extractReady(payload: unknown): WorkerReady {
  const p = asRecord(payload);
  const caps = asRecord(p.capabilities);
  return {
    v: 1,
    type: "ready",
    projectId: asString(p.projectId),
    projectDir: asString(p.projectDir),
    agentName: typeof p.agentName === "string" ? p.agentName : undefined,
    capabilities: {
      git: caps.git === true,
      worktrees: caps.worktrees === true,
      desktop: caps.desktop === true,
      web: caps.web === true,
      mcp: Array.isArray(caps.mcp) ? caps.mcp.filter((m): m is string => typeof m === "string") : [],
      subagents: Array.isArray(caps.subagents)
        ? caps.subagents.filter((m): m is string => typeof m === "string")
        : [],
      models: typeof caps.models === "number" ? caps.models : 0,
      providers: Array.isArray(caps.providers)
        ? caps.providers.filter((m): m is string => typeof m === "string")
        : [],
    },
  };
}

function asSerializedError(value: unknown): SerializedIpcError | undefined {
  const p = asRecord(value);
  if (typeof p.code === "string" && typeof p.message === "string") {
    const code: RigErrorCode = isRigErrorCode(p.code) ? p.code : "RUNTIME_ERROR";
    return { code, message: p.message, details: p.details };
  }
  return undefined;
}

function splitIntoChunks(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}

function truncateForMock(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}



let bridge: RigBridge | null = null;

function detectWails(): boolean {
  try {
    if (getTransport() !== null) return true;
  } catch {

  }
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    chrome?: { webview?: { postMessage?: unknown } };
    webkit?: { messageHandlers?: { external?: { postMessage?: unknown } } };
    wails?: { invoke?: unknown; invokeAsync?: unknown };
    _wails?: { environment?: { OS?: unknown } };
  };
  return (
    typeof w.chrome?.webview?.postMessage === "function" ||
    typeof w.webkit?.messageHandlers?.external?.postMessage === "function" ||
    typeof w.wails?.invoke === "function" ||
    typeof w.wails?.invokeAsync === "function" ||
    typeof w._wails?.environment?.OS === "string"
  );
}

export function getBridge(): RigBridge {
  if (!bridge) {
    const created = detectWails() ? new WailsBridge() : new MockBridge();
    created.start();
    bridge = created;
  }
  return bridge;
}


export function sendCommand(
  name: FormaCommand,
  params?: Record<string, unknown>,
  opts?: SendOptions,
): Promise<unknown> {
  return getBridge().send(name, params, opts);
}

export function openProjectDir(dir: string): Promise<void> {
  return getBridge().openProject(dir);
}

export function waitForReady(timeoutMs?: number): Promise<WorkerReady> {
  return getBridge().waitForReady(timeoutMs);
}

export function restartWorker(): Promise<void> {
  return getBridge().restartWorker();
}
