import { describe, it, expect } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createLogger, createRuntime } from "rig";
import { defaultRigConfig, resolveRigConfig } from "rig/config";
import { RigEventBus } from "rig/events";
import type { WorkerReady } from "rig/ipc";
import { createSessionsFacade } from "rig/sessions";
import formaAgent from "../src/agent.ts";
import { createFormaEventSink } from "../src/forma/events.ts";
import { setFormaEnv } from "../src/forma/runtime.ts";
import { createProject } from "../src/projects/store.ts";
import { writePage } from "../src/projects/pages.ts";
import { defaultSettings } from "../src/projects/schema.ts";
import {
  buildDispatcher,
  dispatchCommand,
  type RuntimeInstance,
} from "../src/worker/commands.ts";
import { WorkerAgentHost } from "../src/worker/host.ts";
import { PendingRunRegistry } from "../src/worker/runs.ts";

interface WorkerResultOk {
  id: string;
  ok: true;
  data?: unknown;
}

interface WorkerResultErr {
  id: string;
  ok: false;
  error: { code: string; message: string };
}

type WorkerResult = WorkerResultOk | WorkerResultErr;

const WORKER_ENTRY = resolve(import.meta.dirname, "..", "src", "worker", "index.ts");

class WorkerHarness {
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: Promise<WorkerReady>;
  #buffer = "";
  #seq = 0;
  #pending = new Map<string, (result: WorkerResult) => void>();
  #readyResolve!: (ready: WorkerReady) => void;
  #readyReject!: (error: Error) => void;
  readonly stderr: string[] = [];
  readonly readyFrames: WorkerReady[] = [];
  readonly events: Array<{ type: string; data?: unknown }> = [];
  #eventWaiters: Array<{
    type: string;
    resolve: (event: { type: string; data?: unknown }) => void;
  }> = [];

  constructor(projectDir: string, env: Record<string, string> = {}) {
    this.child = spawn(
      process.execPath,
      [WORKER_ENTRY, "--project", projectDir, "--log-level", "info"],
      { cwd: projectDir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } },
    );
    this.ready = new Promise<WorkerReady>((resolveReady, rejectReady) => {
      this.#readyResolve = resolveReady;
      this.#readyReject = rejectReady;
    });
    const timer = setTimeout(
      () => this.#readyReject(new Error(`worker did not become ready; stderr:\n${this.stderr.join("")}`)),
      45_000,
    );
    this.child.stderr.on("data", (chunk) => this.stderr.push(String(chunk)));
    this.child.stdout.on("data", (chunk) => this.#handleChunk(String(chunk), timer));
  }

  #handleChunk(chunk: string, readyTimer: ReturnType<typeof setTimeout>): void {
    this.#buffer += chunk;
    let index: number;
    while ((index = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, index);
      this.#buffer = this.#buffer.slice(index + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.type === "ready") {
        clearTimeout(readyTimer);
        this.readyFrames.push(message as unknown as WorkerReady);
        this.#readyResolve(message as unknown as WorkerReady);
      } else if (message.type === "result") {
        const result = message as unknown as WorkerResult;
        this.#pending.get(result.id)?.(result);
        this.#pending.delete(result.id);
      } else if (message.type === "event") {
        const event = message.event as { type?: unknown; data?: unknown } | undefined;
        if (event && typeof event.type === "string") {
          const record = { type: event.type, data: event.data };
          this.events.push(record);
          for (let i = this.#eventWaiters.length - 1; i >= 0; i -= 1) {
            const waiter = this.#eventWaiters[i]!;
            if (waiter.type === record.type) {
              this.#eventWaiters.splice(i, 1);
              waiter.resolve(record);
            }
          }
        }
      }
    }
  }

  waitForEvent(
    type: string,
    timeoutMs = 30_000,
  ): Promise<{ type: string; data?: unknown }> {
    const existing = this.events.find((event) => event.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolveEvent, rejectEvent) => {
      const waiter = { type, resolve: resolveEvent };
      this.#eventWaiters.push(waiter);
      const timer = setTimeout(() => {
        const index = this.#eventWaiters.indexOf(waiter);
        if (index >= 0) this.#eventWaiters.splice(index, 1);
        rejectEvent(new Error(`timed out waiting for worker event "${type}"`));
      }, timeoutMs);
      timer.unref?.();
    });
  }

  send(name: string, params: Record<string, unknown> = {}): Promise<WorkerResult> {
    const id = `c${++this.#seq}`;
    return new Promise<WorkerResult>((resolveResult) => {
      this.#pending.set(id, resolveResult);
      this.child.stdin.write(`${JSON.stringify({ v: 1, type: "command", id, name, params })}\n`);
    });
  }

  async stop(): Promise<number> {
    const result = await this.send("shutdown");
    expect(result.ok).toBe(true);
    return await new Promise<number>((resolveCode) => {
      this.child.on("close", (code) => resolveCode(code ?? -1));
    });
  }
}

class CommandHarness {
  readonly events: Array<{ type: string; data?: unknown }> = [];
  #eventWaiters: Array<{
    type: string;
    resolve: (event: { type: string; data?: unknown }) => void;
  }> = [];
  #seq = 0;
  #dispatcher!: ReturnType<typeof buildDispatcher>;
  #runtime: RuntimeInstance | undefined;
  #cwd = process.cwd();
  #env: Array<[string, string | undefined]> = [];

  static async open(projectDir: string, env: Record<string, string> = {}): Promise<CommandHarness> {
    const harness = new CommandHarness();
    try {
      for (const [key, value] of Object.entries(env)) {
        harness.#env.push([key, process.env[key]]);
        process.env[key] = value;
      }
      process.chdir(projectDir);
      const logger = createLogger({ level: "error" });
      const bus = new RigEventBus({ projectId: "test" });
      const host = new WorkerAgentHost({ bus, logger });
      const runs = new PendingRunRegistry();
      const config = resolveRigConfig({
        ...defaultRigConfig(),
        workspace: "shared",
        capabilities: { question: true, todo: true },
        logLevel: "error",
      });
      const runtime = await createRuntime({
        cwd: projectDir,
        model: "auto",
        host,
        bus,
        logger,
        config,
        agent: formaAgent,
        modelRefresh: true,
      });
      harness.#runtime = runtime;
      await runtime.attachSessionsFactory((sessionsDeps) =>
        createSessionsFacade(sessionsDeps, { cwd: runtime.projectDir, host }),
      );
      const formaEvents = createFormaEventSink((message) => {
        const event = (message as { event?: { type?: unknown; data?: unknown } }).event;
        if (event && typeof event.type === "string") {
          harness.#push({ type: event.type, data: event.data });
        }
      }, runtime.projectId);
      setFormaEnv({ projectDir: runtime.projectDir, events: formaEvents, host });
      bus.subscribe((event) => runs.settleFromEvent(event));
      harness.#dispatcher = buildDispatcher({
        runtime,
        host,
        bus,
        logger,
        selectedModel: "auto",
        runs,
        formaEvents,
        getOrCreateSession: async (sessionId?: string) => {
          if (sessionId) {
            const existing = runtime.sessions.get(sessionId);
            if (!existing) throw new Error(`Unknown session "${sessionId}"`);
            return existing;
          }
          return runtime.session ?? (await runtime.sessions.create({ name: "Default" }));
        },
        defaultSessionId: () => runtime.session?.id,
      });
      return harness;
    } catch (error) {
      await harness.close();
      throw error;
    }
  }

  #push(record: { type: string; data?: unknown }): void {
    this.events.push(record);
    for (let i = this.#eventWaiters.length - 1; i >= 0; i -= 1) {
      const waiter = this.#eventWaiters[i]!;
      if (waiter.type === record.type) {
        this.#eventWaiters.splice(i, 1);
        waiter.resolve(record);
      }
    }
  }

  waitForEvent(type: string, timeoutMs = 30_000): Promise<{ type: string; data?: unknown }> {
    const existing = this.events.find((event) => event.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolveEvent, rejectEvent) => {
      const waiter = { type, resolve: resolveEvent };
      this.#eventWaiters.push(waiter);
      const timer = setTimeout(() => {
        const index = this.#eventWaiters.indexOf(waiter);
        if (index >= 0) this.#eventWaiters.splice(index, 1);
        rejectEvent(new Error(`timed out waiting for worker event "${type}"`));
      }, timeoutMs);
      timer.unref?.();
    });
  }

  send(name: string, params: Record<string, unknown> = {}): Promise<WorkerResult> {
    const id = `c${++this.#seq}`;
    return dispatchCommand(this.#dispatcher, { v: 1, type: "command", id, name, params });
  }

  async close(): Promise<void> {
    setFormaEnv(undefined);
    await this.#runtime?.close().catch(() => undefined);
    this.#runtime = undefined;
    process.chdir(this.#cwd);
    for (const [key, value] of this.#env) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("forma worker", () => {
  it("cancels pending questions only in the stopped session", async () => {
    const bus = new RigEventBus({ projectId: "questions" });
    const host = new WorkerAgentHost({ bus, logger: createLogger({ level: "error" }) });
    const events: string[] = [];
    bus.subscribe((event) => { if (event.type === "interaction.resolved") events.push(event.data.interactionId); });
    const first = host.requestInteraction({ kind: "question", id: "first", sessionId: "stopped", createdAt: new Date().toISOString(), question: "Which palette?" });
    const second = host.requestInteraction({ kind: "question", id: "second", sessionId: "other", createdAt: new Date().toISOString(), question: "Who is the audience?" });
    const rejected = expect(first).rejects.toThrow("Stopped");
    host.rejectForSession("stopped", new Error("Stopped"));
    await rejected;
    expect(host.hasPendingForSession("stopped")).toBe(false);
    expect(host.hasPendingForSession("other")).toBe(true);
    expect(() => host.resolve("first", "question", "approve")).toThrow(/Unknown interaction/);
    host.resolve("second", "question", "Customers");
    expect(await second).toBe("Customers");
    expect(events).toEqual(["first", "second"]);
  });
  it("boots, handles project commands and shuts down cleanly", async () => {    const root = await mkdtemp(join(tmpdir(), "forma-worker-"));
    const projectDir = join(root, "Deck");
    const harness = new WorkerHarness(root);
    try {
      const ready = await harness.ready;
      expect(ready.agentName).toBe("forma");
      expect(ready.projectDir).toBe(root);

      const created = await harness.send("project.create", {
        dir: projectDir,
        name: "Deck",
        prompt: "A worker integration deck",
        mode: "plan",
        settings: { output: "slides" },
      });
      expect(created.ok).toBe(true);

      const opened = await harness.send("project.open", { dir: projectDir });
      expect(opened.ok).toBe(true);
      const payload = (opened as WorkerResultOk).data as {
        project: { project: { name: string; formatVersion: number } };
      };
      expect(payload.project.project.name).toBe("Deck");
      expect(payload.project.project.formatVersion).toBe(1);

      const onDisk = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8")) as {
        name: string;
      };
      expect(onDisk.name).toBe("Deck");

      const unknown = await harness.send("does.not.exist");
      expect(unknown.ok).toBe(false);
      expect((unknown as WorkerResultErr).error.code).toBe("PROTOCOL_ERROR");

      const missing = await harness.send("project.open", { dir: join(root, "missing") });
      expect(missing.ok).toBe(false);

      expect(await harness.stop()).toBe(0);
    } finally {
      if (harness.child.exitCode === null) harness.child.kill();
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  it("reopens a moved project and resolves its conversation state", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-moved-"));
    const original = join(root, "Original");
    const moved = join(root, "Moved");
    await createProject({
      dir: original,
      name: "Moved deck",
      prompt: "Reopen me somewhere else",
      mode: "plan",
      settings: defaultSettings("slides"),
    });

    const first = await CommandHarness.open(original);
    let sessionId = "";
    try {
      const session = await first.send("newSession", { name: "Project chat" });
      expect(session.ok).toBe(true);
      sessionId = (session as WorkerResultOk).data
        ? ((session as WorkerResultOk).data as { session: { id: string } }).session.id
        : "";
      expect(sessionId).toMatch(/^rig_/);

      const recorded = await first.send("project.setConversation", {
        dir: original,
        sessionIds: [sessionId],
      });
      expect(recorded.ok).toBe(true);
      const index = JSON.parse(await readFile(join(original, ".rig", "state", "sessions.json"), "utf8"));
      const sessionFile = join(original, ".rig", "sessions", basename(index.sessions[sessionId].sessionFile));
      await mkdir(join(original, ".rig", "sessions"), { recursive: true });
      await writeFile(sessionFile, `${JSON.stringify({
        type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd: original,
      })}\n${JSON.stringify({
        type: "message",
        id: "saved-user-message",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: { role: "user", content: [{ type: "text", text: "Remember this conversation" }], timestamp: Date.now() },
      })}\n`);
    } finally {
      await first.close();
    }

    await rename(original, moved);

    const second = await CommandHarness.open(moved);
    try {
      const opened = await second.send("project.open", { dir: moved });
      expect(opened.ok).toBe(true);
      const payload = (opened as WorkerResultOk).data as {
        project: { project: { conversation: { sessionIds: string[] } } };
      };
      expect(payload.project.project.conversation.sessionIds).toEqual([sessionId]);

      const resumed = await second.send("resumeSession", { sessionId });
      expect(resumed.ok).toBe(true);
      const resumedId = (resumed as WorkerResultOk).data
        ? ((resumed as WorkerResultOk).data as { session: { id: string } }).session.id
        : "";
      expect(resumedId).toBe(sessionId);
      expect((resumed as WorkerResultOk).data).toMatchObject({
        messages: [{ role: "user", content: [{ type: "text", text: "Remember this conversation" }] }],
      });
    } finally {
      await second.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  it("handles outline, extraction, compose and validation commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-artwork-ipc-"));
    const projectDir = join(root, "Deck");
    const harness = await CommandHarness.open(root, { FORMA_DATA_DIR: join(root, "data") });
    try {
      const created = await harness.send("project.create", {
        dir: projectDir,
        name: "Deck",
        prompt: "IPC artwork",
        mode: "plan",
        settings: { output: "slides" },
      });
      expect(created.ok).toBe(true);

      const settings = defaultSettings();
      settings.designProfile!.colors.accent = "#ca2468";
      settings.designProfile!.fonts.heading = "Georgia";
      const design = await harness.send("project.updateSettings", { dir: projectDir, settings });
      expect(design.ok, JSON.stringify(design)).toBe(true);
      const saved = await harness.send("design.saveTheme", { dir: projectDir, name: "Studio" });
      expect(saved.ok, JSON.stringify(saved)).toBe(true);
      const library = await harness.send("design.listThemes");
      expect(library.ok, JSON.stringify(library)).toBe(true);
      expect((library as WorkerResultOk).data).toMatchObject({ themes: [{ name: "Studio", designProfile: settings.designProfile }] });
      const customTheme = await harness.send("design.saveTheme", { name: "Custom", settings });
      expect(customTheme.ok, JSON.stringify(customTheme)).toBe(true);
      expect((customTheme as WorkerResultOk).data).toMatchObject({ theme: { name: "Custom", designProfile: settings.designProfile } });

      const updated = await harness.send("artwork.updateOutline", {
        dir: projectDir,
        outline: [
          { title: "One", points: ["a"], assetIds: [] },
          { title: "Two", points: ["b"], assetIds: [] },
        ],
      });
      expect(updated.ok, JSON.stringify(updated)).toBe(true);
      const outline = (updated as WorkerResultOk).data as {
        project: { project: { outline: Array<{ id: string }> } };
      };
      const ids = outline.project.project.outline.map((entry) => entry.id);
      expect(ids).toHaveLength(2);

      const note = await harness.send("context.importNote", {
        dir: projectDir,
        text: "A supplied fact for the deck.",
        role: "content-source",
      });
      expect(note.ok, JSON.stringify(note)).toBe(true);
      const ready = await harness.waitForEvent("forma.context.ready");
      expect(ready.data).toMatchObject({ status: "ready" });

      const dropped = await harness.send("context.importAsset", {
        dir: projectDir,
        name: "dropped.png",
        mime: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        role: "optional",
      });
      expect(dropped.ok, JSON.stringify(dropped)).toBe(true);
      const droppedItem = (dropped as WorkerResultOk).data as { item: { mime: string; status: string } };
      expect(droppedItem.item.mime).toBe("image/png");
      expect(droppedItem.item.status).toBe("ready");

      await writePage(projectDir, {
        index: 1,
        title: "One",
        html: "<div class='t'>hello</div>",
        css: ".t{color:#111}",
      });
      await writePage(projectDir, {
        index: 2,
        title: "Two",
        html: "<div class='u'>world</div>",
        css: "",
      });

      const composed = await harness.send("artwork.compose", {
        dir: projectDir,
        pageId: ids[0],
      });
      expect(composed.ok, JSON.stringify(composed)).toBe(true);
      const composedData = (composed as WorkerResultOk).data as { html: string };
      expect(composedData.html).toContain("hello");
      expect(composedData.html).toContain(".t{color:#111}");
      expect(composedData.html).toContain("--forma-accent: #ca2468");

      const reordered = await harness.send("artwork.reorder", {
        dir: projectDir,
        pageId: ids[0],
        toIndex: 2,
      });
      expect(reordered.ok, JSON.stringify(reordered)).toBe(true);
      const reorderedProject = (reordered as WorkerResultOk).data as {
        project: { project: { pages: string[] } };
      };
      expect(reorderedProject.project.project.pages).toEqual([ids[1], ids[0]]);

      const validation = await harness.send("rendering.validate", { dir: projectDir });
      expect(validation.ok, JSON.stringify(validation)).toBe(true);
      const report = (validation as WorkerResultOk).data as {
        report: { issues: unknown[] };
      };
      expect(Array.isArray(report.report.issues)).toBe(true);

      const noteId = ((note as WorkerResultOk).data as { item: { id: string } }).item.id;
      const text = await harness.send("context.getText", { dir: projectDir, id: noteId });
      expect(text.ok, JSON.stringify(text)).toBe(true);
      const extraction = (text as WorkerResultOk).data as {
        extraction: { pages: Array<{ text: string }> } | null;
      };
      expect(extraction.extraction?.pages[0]?.text).toContain("supplied fact");
    } finally {
      await harness.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("switches workspaces in place and binds sessions to the new project", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-switch-"));
    const a = join(root, "A");
    const b = join(root, "B");
    await createProject({ dir: a, name: "A", prompt: "", mode: "plan", settings: defaultSettings("slides") });
    await createProject({ dir: b, name: "B", prompt: "", mode: "plan", settings: defaultSettings("slides") });
    const harness = new WorkerHarness(root);
    try {
      await harness.ready;

      const switched = await harness.send("workspace.switch", { dir: b });
      expect(switched.ok, JSON.stringify(switched)).toBe(true);
      expect(harness.readyFrames.at(-1)?.projectDir).toBe(b);

      const session = await harness.send("newSession", { name: "B chat" });
      expect(session.ok, JSON.stringify(session)).toBe(true);
      const index = JSON.parse(
        await readFile(join(b, ".rig", "state", "sessions.json"), "utf8"),
      ) as { sessions: Record<string, unknown> };
      expect(Object.keys(index.sessions)).toHaveLength(1);
      expect(existsSync(join(a, ".rig", "state", "sessions.json"))).toBe(false);

      const back = await harness.send("workspace.switch", { dir: a });
      expect(back.ok, JSON.stringify(back)).toBe(true);
      expect(harness.readyFrames.at(-1)?.projectDir).toBe(a);
      const reopened = await harness.send("project.open", { dir: a });
      expect(reopened.ok, JSON.stringify(reopened)).toBe(true);

      const missing = await harness.send("workspace.switch", { dir: join(root, "Nope") });
      expect(missing.ok).toBe(false);
    } finally {
      if (harness.child.exitCode === null) harness.child.kill();
      await new Promise<void>((resolveExit) => {
        if (harness.child.exitCode !== null) return resolveExit();
        harness.child.on("close", () => resolveExit());
      });
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  it("saves and removes API keys through the credential store", async () => {    const root = await mkdtemp(join(tmpdir(), "forma-keys-"));
    const agentDir = join(root, "agent");
    const harness = await CommandHarness.open(root, { PI_CODING_AGENT_DIR: agentDir, FORMA_DATA_DIR: join(root, "data") });
    try {
      const defaults = { research: true, imageSearch: false };
      const savedDefaults = await harness.send("settings.setSearchDefaults", { defaults });
      expect(savedDefaults.ok, JSON.stringify(savedDefaults)).toBe(true);
      const searchSettings = await harness.send("settings.getSearch");
      expect(searchSettings.ok, JSON.stringify(searchSettings)).toBe(true);
      expect((searchSettings as WorkerResultOk).data).toMatchObject({ defaults });
      const invalidDefaults = await harness.send("settings.setSearchDefaults", { defaults: { research: "yes" } });
      expect(invalidDefaults.ok).toBe(false);
      const listed = await harness.send("listProviders");
      expect(listed.ok).toBe(true);
      const providers = (listed as WorkerResultOk).data as {
        providers: Array<{ id: string; canSetApiKey?: boolean }>;
      };
      const openai = providers.providers.find((provider) => provider.id === "openai");
      expect(openai?.canSetApiKey).toBe(true);

      const saved = await harness.send("provider.setApiKey", {
        providerId: "openai",
        key: "sk-test-1234567890",
      });
      expect(saved.ok, JSON.stringify(saved)).toBe(true);

      const authPath = join(agentDir, "auth.json");
      const stored = JSON.parse(await readFile(authPath, "utf8")) as Record<
        string,
        { type: string; key?: string }
      >;
      expect(stored.openai?.type).toBe("api_key");
      expect(stored.openai?.key).toBe("sk-test-1234567890");

      const status = await harness.send("providerStatus", { providerId: "openai" });
      const payload = (status as WorkerResultOk).data as {
        provider: { configured: boolean; authStatus: string };
      };
      expect(payload.provider.configured).toBe(true);
      expect(payload.provider.authStatus).toBe("authenticated");

      const removed = await harness.send("providerLogout", { providerId: "openai" });
      expect(removed.ok).toBe(true);
      const after = JSON.parse(await readFile(authPath, "utf8").catch(() => "{}")) as Record<
        string,
        unknown
      >;
      expect(after.openai).toBeUndefined();
    } finally {
      await harness.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  it("defaults new installations to built-in search with both toggles on", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-defaults-"));
    const harness = await CommandHarness.open(root, {
      PI_CODING_AGENT_DIR: join(root, "agent"),
      FORMA_DATA_DIR: join(root, "data"),
    });
    try {
      const search = await harness.send("settings.getSearch");
      expect(search.ok, JSON.stringify(search)).toBe(true);
      expect((search as WorkerResultOk).data).toMatchObject({
        defaults: {
          research: true,
          imageSearch: true,
          researchProvider: "ddgs",
          imageProvider: "ddgs",
        },
      });
      const stored = JSON.parse(
        await readFile(join(root, "data", "settings", "credentials.json"), "utf8"),
      ) as { defaults?: unknown };
      expect(stored.defaults).toMatchObject({ researchProvider: "ddgs", imageProvider: "ddgs" });
    } finally {
      await harness.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  it("migrates existing keys and saved toggles to provider choices", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-migrate-"));
    await mkdir(join(root, "data", "settings"), { recursive: true });
    await writeFile(
      join(root, "data", "settings", "credentials.json"),
      JSON.stringify({ defaults: { research: true, imageSearch: false } }),
    );
    const harness = await CommandHarness.open(root, {
      PI_CODING_AGENT_DIR: join(root, "agent"),
      FORMA_DATA_DIR: join(root, "data"),
    });
    try {
      const search = await harness.send("settings.getSearch");
      expect(search.ok, JSON.stringify(search)).toBe(true);
      expect((search as WorkerResultOk).data).toMatchObject({
        defaults: {
          research: true,
          imageSearch: false,
          researchProvider: "ddgs",
          imageProvider: "ddgs",
        },
      });
      const stored = JSON.parse(
        await readFile(join(root, "data", "settings", "credentials.json"), "utf8"),
      ) as { defaults?: { researchProvider?: string; imageProvider?: string } };
      expect(stored.defaults).toMatchObject({ researchProvider: "ddgs", imageProvider: "ddgs" });
    } finally {
      await harness.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);

  it("selects configured API providers when migrating keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-migrate-keys-"));
    const harness = await CommandHarness.open(root, {
      PI_CODING_AGENT_DIR: join(root, "agent"),
      FORMA_DATA_DIR: join(root, "data"),
    });
    try {
      const saved = await harness.send("settings.setSearchKey", {
        provider: "exa",
        key: "exa-migrate-key-1234",
      });
      expect(saved.ok, JSON.stringify(saved)).toBe(true);
      const search = await harness.send("settings.getSearch");
      expect(search.ok, JSON.stringify(search)).toBe(true);
      expect((search as WorkerResultOk).data).toMatchObject({
        defaults: {
          research: false,
          imageSearch: false,
          researchProvider: "exa",
          imageProvider: "ddgs",
        },
      });
    } finally {
      await harness.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);
});
