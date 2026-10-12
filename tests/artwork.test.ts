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
import { createProject, importContextAsset, openProject, setOutline, updateProject } from "../src/projects/store.ts";
import { readPage, writePage } from "../src/projects/pages.ts";
import { defaultSettings, type OutputKind } from "../src/projects/schema.ts";
import { launchBrowser } from "../src/rendering/browser.ts";
import { document as composeDocument } from "../src/rendering/compose.ts";
import { elementSelectionScript } from "../src/rendering/selection.ts";
import formaAgent from "../src/agent.ts";

it("selects the clicked element from a sandboxed preview without changing its source context", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    const html = composeDocument('<section><h1>Heading</h1><p>Give feedback on this</p></section>', "", { width: 1920, height: 1080, unit: "px" }).replace("</body>", `${elementSelectionScript("page-one")}</body>`);
    await page.setContent('<iframe sandbox="allow-scripts"></iframe>');
    await page.evaluate((source) => {
      (window as unknown as { selection: unknown }).selection = null;
      window.addEventListener("message", (event) => { (window as unknown as { selection: unknown }).selection = event.data; });
      document.querySelector("iframe")!.srcdoc = source;
    }, html);
    await page.waitForFunction(() => document.querySelector("iframe")?.contentWindow !== null);
    const iframe = await page.$("iframe");
    const frame = await iframe!.contentFrame();
    await frame!.waitForSelector("p");
    await frame!.click("p");
    await page.waitForFunction(() => (window as unknown as { selection: unknown }).selection !== null);
    const selection = await page.evaluate(() => (window as unknown as { selection: unknown }).selection);
    expect(selection).toMatchObject({ type: "forma:element-selected", pageId: "page-one", selector: ".forma-page > section:nth-child(1) > p:nth-child(2)", html: "<p>Give feedback on this</p>", text: "Give feedback on this" });
    const bounds = await frame!.evaluate(() => {
      const rect = document.querySelector("p")!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    expect((selection as { bounds: unknown }).bounds).toEqual(bounds);
    await page.evaluate(() => document.querySelector("iframe")!.contentWindow!.postMessage({ type: "forma:selection", selector: null }, "*"));
    await frame!.waitForFunction(() => (document.body.lastElementChild as HTMLElement).style.display === "none");
  } finally {
    await page.close();
  }
}, 60_000);

type ResponseSource = FauxResponseStep[] | ((dir: string) => FauxResponseStep[]);
type ModelContext = Parameters<Extract<FauxResponseStep, (...args: never[]) => unknown>>[0];

interface HarnessOptions {
  responses: ResponseSource;
  mode?: "plan" | "create";
  output?: OutputKind;
  slideCount?: number;
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
  if (options.slideCount !== undefined) await updateProject(dir, (project) => { project.settings.slideCount = options.slideCount!; });
  if (options.outline) await setOutline(dir, options.outline);
  if (options.prepare) await options.prepare(dir);

  const responses =
    typeof options.responses === "function" ? options.responses(dir) : options.responses;
  const runtime = await createTestRuntime({
    cwd: dir,
    agent: formaAgent,
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
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe("forma artwork pipeline", () => {
  it("reports unchecked artwork when Chromium is unavailable without launching a repair", async () => {
    const harness = await setup({
      slideCount: 1,
      responses: [
        fauxAssistantMessage([fauxToolCall("submit_page", { index: 1, title: "One", html: "<p>One</p>" })]),
        fauxAssistantMessage("Done", { stopReason: "stop" }),
      ],
    });
    const previousPath = process.env.FORMA_CHROME_PATH;
    process.env.FORMA_CHROME_PATH = join(harness.dir, "missing-chromium.exe");
    try {
      const result = await harness.send("artwork.generate", { dir: harness.dir });
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error.details as { reason?: string })?.reason).toBe("artwork-unchecked");
      const project = await openProject(harness.dir);
      expect(project.pages).toHaveLength(1);
      expect(project.artworkRevision).toBe(-1);
    } finally {
      if (previousPath === undefined) delete process.env.FORMA_CHROME_PATH;
      else process.env.FORMA_CHROME_PATH = previousPath;
      await harness.close();
    }
  }, 60_000);

  it("honors cancellation after the model stops and before a completion repair", async () => {
    const harness = await setup({
      slideCount: 2,
      responses: [
        fauxAssistantMessage([fauxToolCall("submit_page", { index: 1, title: "One", html: "<p>One</p>" })]),
        fauxAssistantMessage("Done", { stopReason: "stop" }),
      ],
    });
    const unsubscribe = harness.runtime.events.subscribe((event) => {
      if (event.type === "run.completed") void harness.send("abort", { sessionId: event.sessionId });
    });
    try {
      const result = await harness.send("artwork.generate", { dir: harness.dir });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("CANCELLATION_ERROR");
      expect((await openProject(harness.dir)).artworkRevision).toBe(-1);
    } finally { unsubscribe(); await harness.close(); }
  }, 60_000);

  it("repairs an incomplete deck before marking its artwork current", async () => {
    const harness = await setup({
      outline: [{ title: "One", points: ["One"] }, { title: "Two", points: ["Two"] }],
      responses: [
        fauxAssistantMessage([fauxToolCall("submit_page", { index: 1, title: "One", html: "<p>One</p>" })]),
        fauxAssistantMessage("Done", { stopReason: "stop" }),
        (context: ModelContext) => {
          expect(JSON.stringify(context.messages)).toContain("Expected 2 pages, found 1");
          return fauxAssistantMessage([fauxToolCall("submit_page", { index: 2, title: "Two", html: "<p>Two</p>" })]);
        },
        fauxAssistantMessage("Finished both pages", { stopReason: "stop" }),
      ],
    });
    try {
      const result = await harness.send("artwork.generate", { dir: harness.dir });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const project = await openProject(harness.dir);
      expect(project.pages).toHaveLength(2);
      expect(project.artworkRevision).toBe(project.settingsRevision);
    } finally { await harness.close(); }
  }, 60_000);

  it("keeps an unresolved partial deck without marking it current", async () => {
    const harness = await setup({
      outline: [{ title: "One", points: ["One"] }, { title: "Two", points: ["Two"] }],
      responses: [
        fauxAssistantMessage([fauxToolCall("submit_page", { index: 1, title: "One", html: "<p>One</p>" })]),
        fauxAssistantMessage("Done", { stopReason: "stop" }),
        fauxAssistantMessage("Done again", { stopReason: "stop" }),
      ],
    });
    try {
      const result = await harness.send("artwork.generate", { dir: harness.dir });
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error.details as { reason?: string })?.reason).toBe("artwork-incomplete");
      const project = await openProject(harness.dir);
      expect(project.pages).toHaveLength(1);
      expect(project.artworkRevision).toBe(-1);
    } finally { await harness.close(); }
  }, 60_000);

  it("provides rendered page and contact-sheet images to a vision model", async () => {
    let pageId = "";
    const harness = await setup({
      prepare: async (dir) => {
        ({ pageId } = await writePage(dir, { index: 1, title: "Preview", html: "<p>Rendered preview</p>", css: "p{color:red}" }));
      },
      responses: [
        () => fauxAssistantMessage([fauxToolCall("view_artwork", { pageId })]),
        (context: ModelContext) => {
          const result = context.messages.find((message: { role: string; toolName?: string }) => message.role === "toolResult" && message.toolName === "view_artwork");
          expect(Array.isArray(result?.content) && result.content.some((part: { type: string; mimeType?: string; data?: string }) => part.type === "image" && part.mimeType === "image/png" && part.data!.length > 100)).toBe(true);
          return fauxAssistantMessage([fauxToolCall("view_artwork", {})]);
        },
        (context: ModelContext) => {
          const results = context.messages.filter((message: { role: string; toolName?: string }) => message.role === "toolResult" && message.toolName === "view_artwork");
          expect(results).toHaveLength(2);
          expect(Array.isArray(results[1]?.content) && results[1].content.some((part: { type: string }) => part.type === "image")).toBe(true);
          return fauxAssistantMessage("Reviewed the composition", { stopReason: "stop" });
        },
      ],
    });
    try {
      const handle = await harness.runtime.sessions.create({ name: "Preview chat" });
      const session = handle.piSession as { model: object; agent: { state: { model: object } } };
      session.agent.state.model = { ...session.model, input: ["text", "image"] };
      const result = await harness.send("artwork.refine", { dir: harness.dir, sessionId: handle.id, scope: "page", pageId, mode: "plan", message: "Review this slide visually" });
      expect(result.ok, JSON.stringify(result)).toBe(true);
    } finally { await harness.close(); }
  }, 60_000);

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

  it("passes selected element feedback to AI and leaves other slides untouched", async () => {
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
        (context: ModelContext) => {
          const prompt = JSON.stringify(context.messages);
          expect(prompt).toContain(".forma-page > div:nth-child(1)");
          expect(prompt).toContain("Apply the user's feedback only to this element");
          return fauxAssistantMessage([fauxToolCall("update_page", { pageId: ids[0]!, html: '<div class="one">one blue</div>' })]);
        },
        fauxAssistantMessage("Updated slide one", { stopReason: "stop" }),
      ],
    });
    try {
      const result = await harness.send("artwork.refine", {
        dir: harness.dir,
        scope: "page",
        pageId: ids[0],
        message: "Make slide one blue",
        element: { selector: ".forma-page > div:nth-child(1)", html: '<div class="one">one</div>', text: "one" },
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

  it.each([
    ["slides", "artwork.generate"],
    ["poster", "artwork.generate"],
    ["slides", "artwork.refine"],
    ["poster", "artwork.refine"],
  ] as const)("builds %s directly from the brief without an outline via %s", async (output, command) => {
    const harness = await setup({
      output,
      slideCount: 1,
      responses: (dir) => [
        fauxAssistantMessage([fauxToolCall("create_page", { index: 1, title: "First page", assets: [] })]),
        async () => {
          const project = await openProject(dir);
          return fauxAssistantMessage([fauxToolCall("write_file", { path: `pages/${project.pages[0]}.html`, content: "<div>Built from the brief</div>" })]);
        },
        async () => {
          const project = await openProject(dir);
          return fauxAssistantMessage([fauxToolCall("write_file", { path: `pages/${project.pages[0]}.css`, content: "div { color: navy; }" })]);
        },
        fauxAssistantMessage("Built", { stopReason: "stop" }),
      ],
    });
    try {
      const result = await harness.send(command, { dir: harness.dir, scope: "project", mode: "build", message: "Build from my brief" });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const project = await openProject(harness.dir);
      expect(project.pages).toHaveLength(1);
      expect(project.artworkRevision).toBe(project.settingsRevision);
      expect((await readPage(harness.dir, project.pages[0]!)).html).toContain("Built from the brief");
    } finally {
      await harness.close();
    }
  }, 60_000);

  it("lets an image-capable model view a reference on demand and removes the tool for a text-only model", async () => {
    let imageId = "";
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
    const harness = await setup({
      prepare: async (dir) => {
        const { item } = await importContextAsset(dir, {
          name: "Reference photo", extension: ".png", mime: "image/png", data: Buffer.from(png, "base64"), role: "optional",
        });
        imageId = item.id;
      },
      responses: [
        (context: ModelContext) => {
          expect(context.tools?.map((tool: { name: string }) => tool.name)).toContain("view_image");
          expect(context.tools?.map((tool: { name: string }) => tool.name)).toContain("view_artwork");
          expect(context.tools?.map((tool: { name: string }) => tool.name)).not.toContain("submit_page");
          return fauxAssistantMessage([fauxToolCall("view_image", { id: imageId })]);
        },
        (context: ModelContext) => {
          const result = context.messages.find((message: { role: string; toolName?: string }) => message.role === "toolResult" && message.toolName === "view_image");
          expect(result?.content).toContainEqual({ type: "image", data: png, mimeType: "image/png" });
          return fauxAssistantMessage("I can see the reference", { stopReason: "stop" });
        },
        (context: ModelContext) => {
          expect(context.tools?.map((tool: { name: string }) => tool.name)).not.toContain("view_image");
          expect(context.tools?.map((tool: { name: string }) => tool.name)).not.toContain("view_artwork");
          return fauxAssistantMessage("I can use the reference information", { stopReason: "stop" });
        },
      ],
    });
    try {
      const handle = await harness.runtime.sessions.create({ name: "Image chat" });
      const session = handle.piSession as { model: object; agent: { state: { model: object } }; getActiveToolNames(): string[] };
      const textModel = session.model;
      session.agent.state.model = { ...textModel, input: ["text", "image"] };
      const viewed = await harness.send("artwork.refine", { dir: harness.dir, sessionId: handle.id, scope: "project", mode: "plan", message: "Look at my reference" });
      expect(viewed.ok, JSON.stringify(viewed)).toBe(true);
      expect(session.getActiveToolNames()).not.toContain("view_image");
      expect(session.getActiveToolNames()).not.toContain("view_artwork");
      session.agent.state.model = textModel;
      const textOnly = await harness.send("artwork.refine", { dir: harness.dir, sessionId: handle.id, scope: "project", mode: "build", message: "What information is available?" });
      expect(textOnly.ok, JSON.stringify(textOnly)).toBe(true);
    } finally {
      await harness.close();
    }
  }, 60_000);

  it("delivers attached chat images to a vision model with priority over project references", async () => {
    const chatPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const referencePng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
    const harness = await setup({
      prepare: async (dir) => {
        for (let index = 0; index < 6; index += 1) {
          await importContextAsset(dir, {
            name: `Reference ${index + 1}`, extension: ".png", mime: "image/png", data: Buffer.from(referencePng, "base64"), role: "optional",
          });
        }
      },
      responses: [
        (context: ModelContext) => {
          expect(context.systemPrompt).toContain("The user attached 1 image");
          const user = context.messages.find((message: { role: string }) => message.role === "user");
          const content = Array.isArray(user?.content) ? user.content : [];
          const images = content.filter((block: { type: string }) => block.type === "image");
          expect(images).toHaveLength(6);
          expect(images[0]).toMatchObject({ data: chatPng, mimeType: "image/png" });
          return fauxAssistantMessage("Using the attached image", { stopReason: "stop" });
        },
      ],
    });
    try {
      const handle = await harness.runtime.sessions.create({ name: "Chat images" });
      const session = handle.piSession as { model: object; agent: { state: { model: object } } };
      session.agent.state.model = { ...session.model, input: ["text", "image"] };
      const result = await harness.send("artwork.refine", {
        dir: harness.dir, sessionId: handle.id, scope: "project", mode: "build", message: "Match this style",
        images: [{ data: chatPng, mediaType: "image/png" }],
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
    } finally { await harness.close(); }
  }, 60_000);

  it("rejects chat images for a text-only model in project and regular chat", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
    const harness = await setup({
      responses: [fauxAssistantMessage("Should not run", { stopReason: "stop" })],
    });
    try {
      const handle = await harness.runtime.sessions.create({ name: "Text only" });
      const refine = await harness.send("artwork.refine", {
        dir: harness.dir, sessionId: handle.id, scope: "project", mode: "build", message: "Use this",
        images: [{ data: png, mediaType: "image/png" }],
      });
      expect(refine.ok).toBe(false);
      if (!refine.ok) expect((refine.error.details as { reason?: string })?.reason).toBe("images-unsupported");
      const prompt = await harness.send("prompt", {
        sessionId: handle.id, prompt: "Look at this",
        images: [{ data: png, mediaType: "image/png" }],
      });
      expect(prompt.ok).toBe(false);
      if (!prompt.ok) expect((prompt.error.details as { reason?: string })?.reason).toBe("images-unsupported");
    } finally { await harness.close(); }
  }, 60_000);

  it("refreshes project context and work mode in the system prompt without marking answers as artwork changes", async () => {
    const harness = await setup({
      responses: [
        (context: ModelContext) => {
          expect(context.systemPrompt).toContain('"title":"Deck"');
          expect(context.systemPrompt).toContain('"overview":"A deck about the topic"');
          expect(context.systemPrompt).toContain("Work mode: plan");
          expect(context.tools?.map((tool: { name: string }) => tool.name)).not.toContain("submit_page");
          expect(context.tools?.map((tool: { name: string }) => tool.name)).not.toContain("update_page");
          expect(context.tools?.map((tool: { name: string }) => tool.name)).not.toContain("create_page");
          expect(context.tools?.map((tool: { name: string }) => tool.name)).not.toContain("write_file");
          expect(context.tools?.map((tool: { name: string }) => tool.name)).not.toContain("edit_file");
          return fauxAssistantMessage("Let's discuss the audience", { stopReason: "stop" });
        },
        (context: ModelContext) => {
          expect(context.systemPrompt).toContain('"title":"Updated title"');
          expect(context.systemPrompt).toContain('"overview":"Updated overview"');
          expect(context.systemPrompt).not.toContain('"title":"Deck"');
          expect(context.systemPrompt).not.toContain('"slideCount"');
          expect(context.systemPrompt).toContain("Work mode: build");
          expect(context.tools?.map((tool: { name: string }) => tool.name)).toContain("submit_page");
          return fauxAssistantMessage("Three slides would work", { stopReason: "stop" });
        },
      ],
    });
    try {
      const session = await harness.runtime.sessions.create({ name: "Project chat" });
      const first = await harness.send("artwork.refine", { dir: harness.dir, sessionId: session.id, scope: "project", mode: "plan", message: "Who is this for?" });
      expect(first.ok, JSON.stringify(first)).toBe(true);
      await updateProject(harness.dir, (project) => {
        project.name = "Updated title";
        project.prompt = "Updated overview";
        project.settings.slideCount = 3;
        project.settingsRevision = 1;
      });
      const second = await harness.send("artwork.refine", { dir: harness.dir, sessionId: session.id, scope: "project", mode: "build", message: "How many slides?" });
      expect(second.ok, JSON.stringify(second)).toBe(true);
      const project = await openProject(harness.dir);
      expect(project.artworkRevision).toBe(-1);
      expect(project.pages).toEqual([]);
    } finally {
      await harness.close();
    }
  }, 60_000);

  it("keeps specialist tools deferred until load_tools activates them", async () => {
    const harness = await setup({
      responses: [
        (context: ModelContext) => {
          const names = context.tools?.map((tool: { name: string }) => tool.name) ?? [];
          expect(names).toContain("load_tools");
          expect(names).toContain("read_project");
          expect(names).not.toContain("research");
          expect(names).not.toContain("read_url");
          expect(names).not.toContain("find_brand_icon");
          return fauxAssistantMessage([fauxToolCall("load_tools", { group: "research" })]);
        },
        (context: ModelContext) => {
          const names = context.tools?.map((tool: { name: string }) => tool.name) ?? [];
          expect(names).toContain("research");
          expect(names).toContain("read_url");
          return fauxAssistantMessage([fauxToolCall("load_tools", { group: "research" })]);
        },
        (context: ModelContext) => {
          const names = context.tools?.map((tool: { name: string }) => tool.name) ?? [];
          expect(names.filter((name: string) => name === "research")).toHaveLength(1);
          return fauxAssistantMessage("Ready", { stopReason: "stop" });
        },
      ],
    });
    try {
      const result = await harness.send("prompt", { prompt: "Load the research tools" });
      expect(result.ok, JSON.stringify(result)).toBe(true);
    } finally {
      await harness.close();
    }
  }, 60_000);

  it("loads tools only for the requesting session", async () => {
    const harness = await setup({
      responses: [
        (context: ModelContext) => {
          expect(context.tools?.map((tool: { name: string }) => tool.name)).not.toContain("find_photos");
          return fauxAssistantMessage([fauxToolCall("load_tools", { group: "photos" })]);
        },
        () => fauxAssistantMessage("Loaded photos", { stopReason: "stop" }),
        (context: ModelContext) => {
          const names = context.tools?.map((tool: { name: string }) => tool.name) ?? [];
          expect(names).toContain("load_tools");
          expect(names).not.toContain("find_photos");
          expect(names).not.toContain("import_photo");
          return fauxAssistantMessage("Unaffected", { stopReason: "stop" });
        },
      ],
    });
    try {
      const loader = await harness.runtime.sessions.create({ name: "Loader" });
      const other = await harness.runtime.sessions.create({ name: "Other" });
      const first = await harness.send("prompt", { sessionId: loader.id, prompt: "Load the photo tools" });
      expect(first.ok, JSON.stringify(first)).toBe(true);
      const second = await harness.send("prompt", { sessionId: other.id, prompt: "Hello" });
      expect(second.ok, JSON.stringify(second)).toBe(true);
    } finally {
      await harness.close();
    }
  }, 60_000);

  it("preserves planning restrictions and view tools when loading groups mid-run", async () => {
    const harness = await setup({
      responses: [
        (context: ModelContext) => {
          const names = context.tools?.map((tool: { name: string }) => tool.name) ?? [];
          expect(names).toContain("view_image");
          expect(names).toContain("view_artwork");
          expect(names).not.toContain("submit_page");
          expect(names).not.toContain("research");
          return fauxAssistantMessage([fauxToolCall("load_tools", { group: "research" })]);
        },
        (context: ModelContext) => {
          const names = context.tools?.map((tool: { name: string }) => tool.name) ?? [];
          expect(names).toContain("research");
          expect(names).toContain("view_image");
          expect(names).toContain("view_artwork");
          expect(names).not.toContain("submit_page");
          return fauxAssistantMessage("Loaded", { stopReason: "stop" });
        },
      ],
    });
    try {
      const handle = await harness.runtime.sessions.create({ name: "Vision chat" });
      const session = handle.piSession as { model: object; agent: { state: { model: object } }; getActiveToolNames(): string[] };
      session.agent.state.model = { ...session.model, input: ["text", "image"] };
      const result = await harness.send("artwork.refine", { dir: harness.dir, sessionId: handle.id, scope: "project", mode: "plan", message: "Load research while planning" });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const active = session.getActiveToolNames();
      expect(active).toContain("research");
      expect(active).toContain("read_url");
      expect(active).toContain("submit_page");
      expect(active).not.toContain("view_image");
    } finally {
      await harness.close();
    }
  }, 60_000);
});
