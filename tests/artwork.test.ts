import { describe, it, expect } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "rig";
import { RigEventBus } from "rig/events";
import type { WorkerResult } from "rig/ipc";
import {
  createTestRuntime,
  fauxAssistantMessage,
  fauxToolCall,
  waitForEvent,
  type FauxResponseStep,
} from "rig/testing";
import { buildDispatcher, dispatchCommand, type WorkerContext } from "../src/worker/commands.ts";
import { WorkerAgentHost } from "../src/worker/host.ts";
import { PendingRunRegistry } from "../src/worker/runs.ts";
import { createFormaEventSink } from "../src/forma/events.ts";
import { setFormaEnv } from "../src/forma/runtime.ts";
import { createProject, openProject, setOutline } from "../src/projects/store.ts";
import { readPage, writePage } from "../src/projects/pages.ts";
import { defaultSettings, type OutputKind } from "../src/projects/schema.ts";

const AGENT_PATH = join(import.meta.dirname, "..", "src", "agent.ts");

type ResponseSource = FauxResponseStep[] | ((dir: string) => FauxResponseStep[]);

interface HarnessOptions {
  responses: ResponseSource;
  mode?: "plan" | "create";
  output?: OutputKind;
  outline?: Array<{ title: string; points: string[] }>;
  prepare?: (dir: string) => Promise<void>;
}

interface Harness {
  dir: string;
  runtime: Awaited<ReturnType<typeof createTestRuntime>>;
  send(name: string, params?: Record<string, unknown>): Promise<WorkerResult>;
  close(): Promise<void>;
}

async function setup(options: HarnessOptions): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "forma-artwork-"));
  const dir = join(root, "Deck");
  await createProject({
    dir,
    name: "Deck",
    prompt: "A deck about the topic",
    mode: options.mode ?? "plan",
    settings: defaultSettings(options.output ?? "slides"),
  });
  if (options.outline) await setOutline(dir, options.outline);
  if (options.prepare) await options.prepare(dir);

  const responses =
    typeof options.responses === "function" ? options.responses(dir) : options.responses;
  const runtime = await createTestRuntime({
    cwd: dir,
    agent: AGENT_PATH,
    responses,
  });
  const logger = createLogger({ level: "error" });
  const bus = new RigEventBus({ projectId: "test" });
  const host = new WorkerAgentHost({ bus, logger });
  const runs = new PendingRunRegistry();
  const formaEvents = createFormaEventSink(() => undefined, "test");
  setFormaEnv({ projectDir: dir, events: formaEvents });
  const unsubscribeRuns = runtime.events.subscribe((event) => runs.settleFromEvent(event));

  const getOrCreateSession = async (sessionId?: string) => {
    if (sessionId) {
      const existing = runtime.sessions.get(sessionId);
      if (!existing) throw new Error(`Unknown session "${sessionId}"`);
      return existing;
    }
    return runtime.session ?? (await runtime.sessions.create({ name: "Test" }));
  };

  const ctx: WorkerContext = {
    runtime,
    host,
    bus,
    logger,
    selectedModel: "auto",
    runs,
    formaEvents,
    getOrCreateSession,
    defaultSessionId: () => runtime.session?.id,
  };
  const dispatcher = buildDispatcher(ctx);
  let seq = 0;
  return {
    dir,
    runtime,
    send: (name, params = {}) =>
      dispatchCommand(dispatcher, { v: 1, type: "command", id: `c${seq++}`, name, params }),
    close: async () => {
      unsubscribeRuns();
      setFormaEnv(undefined);
      await runtime.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    },
  };
}

describe("forma artwork pipeline", () => {
  it("planning records the outline without creating artwork", async () => {
    const harness = await setup({
      responses: [
        fauxAssistantMessage([
          fauxToolCall("submit_outline", {
            entries: [
              { title: "Opening", points: ["Welcome"], visualDirection: "Calm", assetIds: [] },
              { title: "Details", points: ["Facts"], assetIds: [] },
            ],
          }),
        ]),
        fauxAssistantMessage("Outline drafted", { stopReason: "stop" }),
      ],
    });
    try {
      const result = await harness.send("artwork.plan", { dir: harness.dir });
      expect(result.ok, JSON.stringify(result)).toBe(true);

      const project = await openProject(harness.dir);
      expect(project.outline?.map((entry) => entry.title)).toEqual(["Opening", "Details"]);
      expect(project.pages).toEqual([]);
      expect(await readdir(join(harness.dir, "pages"))).toEqual([]);
    } finally {
      await harness.close();
    }
  }, 60_000);

  it("generation follows the edited outline order and count", async () => {
    let ids: string[] = [];
    const harness = await setup({
      outline: [
        { title: "Draft one", points: [] },
        { title: "Draft two", points: [] },
      ],
      prepare: async (dir) => {
        const edited = await setOutline(dir, [
          { title: "Second", points: ["b"] },
          { title: "First", points: ["a"] },
          { title: "Closing", points: ["c"] },
        ]);
        ids = edited.outline!.map((entry) => entry.id);
      },
      responses: () => [
        ...ids.map((pageId, index) =>
          fauxAssistantMessage([
            fauxToolCall("submit_page", {
              index: index + 1,
              pageId,
              title: `Page ${index + 1}`,
              html: `<div class="page-${index + 1}">content ${index + 1}</div>`,
              css: `.page-${index + 1}{color:#111}`,
              assets: [],
            }),
          ]),
        ),
        fauxAssistantMessage("Generated", { stopReason: "stop" }),
      ],
    });
    try {
      const result = await harness.send("artwork.generate", { dir: harness.dir });
      expect(result.ok, JSON.stringify(result)).toBe(true);

      const project = await openProject(harness.dir);
      expect(project.pages).toEqual(ids);
      expect(project.pages).toHaveLength(3);
      for (const [index, pageId] of ids.entries()) {
        const source = await readPage(harness.dir, pageId);
        expect(source.html).toContain(`content ${index + 1}`);
      }
    } finally {
      await harness.close();
    }
  }, 90_000);

  it("refining one slide leaves the other slides untouched", async () => {
    let ids: string[] = [];
    const harness = await setup({
      prepare: async (dir) => {
        const project = await setOutline(dir, [
          { title: "One", points: [] },
          { title: "Two", points: [] },
        ]);
        ids = project.outline!.map((entry) => entry.id);
        await writePage(dir, { index: 1, title: "One", html: '<div class="one">one</div>', css: "" });
        await writePage(dir, { index: 2, title: "Two", html: '<div class="two">two</div>', css: "" });
      },
      responses: () => [
        fauxAssistantMessage([
          fauxToolCall("update_page", { pageId: ids[0]!, html: '<div class="one">one blue</div>' }),
        ]),
        fauxAssistantMessage("Updated slide one", { stopReason: "stop" }),
      ],
    });
    try {
      const result = await harness.send("artwork.refine", {
        dir: harness.dir,
        scope: "page",
        pageId: ids[0],
        message: "Make slide one blue",
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);

      const first = await readPage(harness.dir, ids[0]!);
      const second = await readPage(harness.dir, ids[1]!);
      expect(first.html).toContain("one blue");
      expect(second.html).toContain('<div class="two">two</div>');
    } finally {
      await harness.close();
    }
  }, 60_000);

  it("keeps completed pages when the run fails", async () => {
    const harness = await setup({
      mode: "create",
      responses: [
        fauxAssistantMessage([
          fauxToolCall("submit_page", {
            index: 1,
            title: "First",
            html: "<div>first page</div>",
            css: "",
            assets: [],
          }),
        ]),
        fauxAssistantMessage("boom", { stopReason: "error", errorMessage: "provider exploded" }),
      ],
    });
    try {
      const result = await harness.send("artwork.generate", { dir: harness.dir });
      expect(result.ok).toBe(false);

      const project = await openProject(harness.dir);
      expect(project.pages).toHaveLength(1);
      const source = await readPage(harness.dir, project.pages[0]!);
      expect(source.html).toContain("first page");
    } finally {
      await harness.close();
    }
  }, 60_000);

  it("cancelling a run keeps committed pages", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const harness = await setup({
      mode: "create",
      responses: [
        fauxAssistantMessage([
          fauxToolCall("submit_page", {
            index: 1,
            title: "First",
            html: "<div>committed</div>",
            css: "",
            assets: [],
          }),
        ]),
        async () => {
          await gate;
          return fauxAssistantMessage("late response", { stopReason: "stop" });
        },
      ],
    });
    try {
      const generating = harness.send("artwork.generate", { dir: harness.dir });
      const toolEvent = await waitForEvent(
        harness.runtime,
        "tool.completed",
        (event) => event.data.toolName === "submit_page",
        { timeoutMs: 30_000 },
      );
      await harness.send("abort", { sessionId: toolEvent.sessionId });
      const result = await generating;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CANCELLATION_ERROR");
      }

      const project = await openProject(harness.dir);
      expect(project.pages).toHaveLength(1);
      const source = await readPage(harness.dir, project.pages[0]!);
      expect(source.html).toContain("committed");
    } finally {
      release();
      await harness.close();
    }
  }, 90_000);

  it("refuses to generate in plan mode before an outline exists", async () => {
    const harness = await setup({ responses: [] });
    try {
      const result = await harness.send("artwork.generate", { dir: harness.dir });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/outline/i);
      }
      const project = await openProject(harness.dir);
      expect(project.pages).toEqual([]);
    } finally {
      await harness.close();
    }
  }, 30_000);
});
