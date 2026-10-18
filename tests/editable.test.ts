import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "rig";
import { RigEventBus } from "rig/events";
import type { WorkerResult } from "rig/ipc";
import { PendingRunRegistry } from "../src/worker/runs.ts";
import { createFormaEventSink } from "../src/forma/events.ts";
import { projectRuns, setFormaEnv } from "../src/forma/runtime.ts";
import { createProject, updateProject } from "../src/projects/store.ts";
import { readPage, writePage } from "../src/projects/pages.ts";
import { defaultSettings } from "../src/projects/schema.ts";
import { buildDispatcher, dispatchCommand, type WorkerContext } from "../src/worker/commands.ts";
import { WorkerAgentHost } from "../src/worker/host.ts";
import { sourceRevision } from "../src/worker/artwork.ts";
import { launchBrowser } from "../src/rendering/browser.ts";
import { document as composeDocument } from "../src/rendering/compose.ts";
import { elementEditScript } from "../src/rendering/editScript.ts";
import type { EditFrameMessage, EditOp } from "../src/rendering/editContract.ts";
import { transform } from "esbuild";
import { compileModule } from "svelte/compiler";

async function setupEditStore() {
  let hooks: { flush(): Promise<void> };
  let savedHtml = PAGE_HTML;
  let frameHtml = PAGE_HTML;
  const frameRev = "frame-one";
  const project = {
    current: { dir: "editable-project", project: { pages: ["page-one"] } },
    selectedPageId: "page-one",
    run: null,
    exporting: false,
    setEditorSaveStatus: () => undefined,
    invalidateComposed: () => undefined,
    setEditorHooks: (value: typeof hooks) => { hooks = value; },
  };
  const context = {
    projectStore: project,
    notificationStore: { push: () => undefined },
    sendCommand: async (name: string, params: { html: string }) => {
      if (name === "artwork.readEditable") return { html: savedHtml, css: "", revision: "saved" };
      savedHtml = params.html;
      return { revision: "updated" };
    },
  };
  const key = `editTest${crypto.randomUUID()}`;
  (globalThis as unknown as Record<string, unknown>)[key] = context;
  const source = await readFile(new URL("../app/src/lib/forma/editStore.svelte.ts", import.meta.url), "utf8");
  const js = (await transform(source, { loader: "ts", format: "esm", target: "esnext" })).code
    .replace(/import \{ sendCommand \} from [^;]+;/, `const { sendCommand } = globalThis[${JSON.stringify(key)}];`)
    .replace(/import \{ notificationStore \} from [^;]+;/, `const { notificationStore } = globalThis[${JSON.stringify(key)}];`)
    .replace(/import \{ projectStore \} from [^;]+;/, `const { projectStore } = globalThis[${JSON.stringify(key)}];`);
  const compiled = compileModule(js, { generate: "server" }).js.code
    .replace(/(['"])svelte\/internal\/server\1/, JSON.stringify(import.meta.resolve("svelte/internal/server")));
  const { editStore } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}#${key}`);
  delete (globalThis as unknown as Record<string, unknown>)[key];
  const message = (body: Record<string, unknown>) => editStore.handleFrameMessage({ pageId: "page-one", rev: frameRev, ...body });
  await editStore.enter();
  editStore.attachFrame((command: { type: string; html: string; seq: number; ops: EditOp[] }) => {
    if (command.type === "forma:edit-init") frameHtml = command.html;
    if (command.type === "forma:edit-apply") {
      for (const op of command.ops) if (op.kind === "text") frameHtml = `<p>${op.value}</p>`;
    }
    if (command.type === "forma:edit-serialize") message({ type: "forma:edit-source", seq: command.seq, html: frameHtml });
  }, "page-one");
  editStore.noteFrameBuilt("page-one", frameRev);
  message({ type: "forma:edit-ready" });
  return { editStore, message, flush: () => hooks.flush(), saved: () => savedHtml, frame: () => frameHtml };
}

describe("editor session persistence", () => {
  it("keeps separate undo steps for consecutive drag gestures", async () => {
    const harness = await setupEditStore();
    for (const x of [10, 20]) harness.message({
      type: "forma:edit-commit",
      before: [{ kind: "move", path: [0], x: x - 10, y: 0 }],
      after: [{ kind: "move", path: [0], x, y: 0 }],
    });
    harness.editStore.undo();
    expect(harness.editStore.canUndo()).toBe(true);
    await harness.editStore.exit();
  });
  it("enters edit mode on the first page load", async () => {
    const harness = await setupEditStore();
    expect(harness.editStore.editMode).toBe(true);
    await harness.editStore.exit();
  });
  it("retains saved changes when a page frame is rebuilt", async () => {
    const harness = await setupEditStore();
    const before = { kind: "text", path: [0], node: 0, value: "Original" };
    const after = { ...before, value: "Edited" };
    harness.message({ type: "forma:edit-commit", before: [before], after: [after] });
    await harness.flush();
    expect(harness.saved()).toBe("<p>Edited</p>");
    harness.message({ type: "forma:edit-ready" });
    expect(harness.frame()).toBe("<p>Edited</p>");
    await harness.editStore.exit();
  });

  it("rolls back autosaved text when editing is cancelled", async () => {
    const harness = await setupEditStore();
    const before = { kind: "text", path: [0], node: 0, value: "Original" };
    harness.message({ type: "forma:edit-text-start", op: before });
    harness.message({ type: "forma:edit-text-input", op: { ...before, value: "Cancelled" } });
    await harness.flush();
    harness.message({ type: "forma:edit-text-end", op: null, cancelled: true });
    await harness.flush();
    expect(harness.saved()).toBe("<p>Original</p>");
    expect(harness.editStore.canUndo()).toBe(false);
    await harness.editStore.exit();
  });
});

interface WorkerHarness {
  dir: string;
  pageId: string;
  send(name: string, params?: Record<string, unknown>): Promise<WorkerResult>;
  close(): Promise<void>;
}

async function setupWorker(html: string, css: string): Promise<WorkerHarness> {
  const root = await mkdtemp(join(tmpdir(), "forma-editable-"));
  const dir = join(root, "Deck");
  await createProject({ dir, name: "Deck", prompt: "A deck", mode: "create", settings: defaultSettings("slides") });
  const { pageId } = await writePage(dir, { index: 1, title: "Cover", html, css, assets: [] });

  const logger = createLogger({ level: "error" });
  const bus = new RigEventBus({ projectId: "test" });
  const host = new WorkerAgentHost({ bus, logger });
  const formaEvents = createFormaEventSink(() => undefined, "test");
  setFormaEnv({ projectDir: dir, events: formaEvents });
  const ctx = {
    runtime: undefined,
    host,
    bus,
    logger,
    selectedModel: "auto",
    runs: new PendingRunRegistry(),
    formaEvents,
    getOrCreateSession: async () => {
      throw new Error("No sessions in editable tests");
    },
    defaultSessionId: () => undefined,
  } as unknown as WorkerContext;
  const dispatcher = buildDispatcher(ctx);
  let seq = 0;
  return {
    dir,
    pageId,
    send: (name, params = {}) => dispatchCommand(dispatcher, { v: 1, type: "command", id: `c${seq++}`, name, params }),
    close: async () => {
      setFormaEnv(undefined);
      await rm(root, { recursive: true, force: true });
    },
  };
}

const PAGE_HTML = `<section class="cover"><h1>Launch plan</h1><p>First paragraph</p></section>`;
const PAGE_CSS = `h1 { color: #101010; } p { color: #333333; }`;

function okData<T>(result: WorkerResult): T {
  if (!result.ok) throw new Error(`Command failed: ${JSON.stringify(result.error)}`);
  return result.data as T;
}

describe("artwork.readEditable / artwork.saveEditable", () => {
  it("returns the original source with a stable revision token", async () => {
    const harness = await setupWorker(PAGE_HTML, PAGE_CSS);
    try {
      const first = okData<{ html: string; css: string; revision: string }>(await harness.send("artwork.readEditable", { dir: harness.dir, pageId: harness.pageId }));
      const second = okData<{ revision: string }>(await harness.send("artwork.readEditable", { dir: harness.dir, pageId: harness.pageId }));
      const stored = await readPage(harness.dir, harness.pageId);
      expect(first.html).toBe(stored.html);
      expect(first.css).toBe(stored.css);
      expect(first.revision).toBe(sourceRevision(stored));
      expect(second.revision).toBe(first.revision);
    } finally {
      await harness.close();
    }
  });

  it("saves edited source, keeps artwork current, and returns the new revision", async () => {
    const harness = await setupWorker(PAGE_HTML, PAGE_CSS);
    try {
      await updateProject(harness.dir, (project) => { project.artworkRevision = project.settingsRevision; });
      const before = okData<{ revision: string }>(await harness.send("artwork.readEditable", { dir: harness.dir, pageId: harness.pageId }));
      const result = await harness.send("artwork.saveEditable", {
        dir: harness.dir,
        pageId: harness.pageId,
        html: `<section class="cover"><h1>Revised title</h1><p>First paragraph</p></section>`,
        css: PAGE_CSS,
        revision: before.revision,
      });
      const data = okData<{
        project: { project: { pageMeta: Record<string, { title: string; assets: string[] }>; artworkRevision: number; settingsRevision: number } };
        revision: string;
      }>(result);
      const savedProject = data.project.project;
      expect(savedProject.pageMeta[harness.pageId]?.title).toBe("Cover");
      expect(savedProject.pageMeta[harness.pageId]?.assets).toEqual([]);
      expect(savedProject.artworkRevision).toBe(savedProject.settingsRevision);
      const saved = await readPage(harness.dir, harness.pageId);
      expect(saved.html).toContain("Revised title");
      expect(data.revision).toBe(sourceRevision(saved));
      expect(data.revision).not.toBe(before.revision);
    } finally {
      await harness.close();
    }
  });

  it("preserves pending design changes when saving manual edits", async () => {
    const harness = await setupWorker(PAGE_HTML, PAGE_CSS);
    try {
      const source = await readPage(harness.dir, harness.pageId);
      const data = okData<{ project: { project: { artworkRevision: number } } }>(await harness.send("artwork.saveEditable", {
        dir: harness.dir, pageId: harness.pageId, html: "<p>Edited</p>", css: PAGE_CSS, revision: sourceRevision(source),
      }));
      expect(data.project.project.artworkRevision).toBe(-1);
    } finally {
      await harness.close();
    }
  });

  it("rejects the second of two simultaneous saves against the same revision", async () => {
    const harness = await setupWorker(PAGE_HTML, PAGE_CSS);
    try {
      const revision = sourceRevision(await readPage(harness.dir, harness.pageId));
      const results = await Promise.all(["First", "Second"].map((text) => harness.send("artwork.saveEditable", {
        dir: harness.dir, pageId: harness.pageId, html: `<p>${text}</p>`, css: PAGE_CSS, revision,
      })));
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      const rejected = results.find((result) => !result.ok);
      expect(rejected && !rejected.ok && rejected.error.details).toMatchObject({ reason: "stale-revision" });
      expect((await readPage(harness.dir, harness.pageId)).html).toContain("First");
    } finally {
      await harness.close();
    }
  });

  it("rejects a save whose revision no longer matches the stored source", async () => {
    const harness = await setupWorker(PAGE_HTML, PAGE_CSS);
    try {
      const result = await harness.send("artwork.saveEditable", {
        dir: harness.dir,
        pageId: harness.pageId,
        html: `<section class="cover"><h1>Stale</h1></section>`,
        css: PAGE_CSS,
        revision: "0".repeat(32),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error.details as { reason?: string })?.reason).toBe("stale-revision");
      const saved = await readPage(harness.dir, harness.pageId);
      expect(saved.html).toContain("Launch plan");
    } finally {
      await harness.close();
    }
  });

  it("rejects saves while an AI run is active", async () => {
    const harness = await setupWorker(PAGE_HTML, PAGE_CSS);
    try {
      projectRuns.set("run-1", { mode: "build", artworkChanged: false });
      const result = await harness.send("artwork.saveEditable", {
        dir: harness.dir,
        pageId: harness.pageId,
        html: PAGE_HTML,
        css: PAGE_CSS,
        revision: sourceRevision({ html: PAGE_HTML, css: PAGE_CSS }),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect((result.error.details as { reason?: string })?.reason).toBe("ai-running");
      const saved = await readPage(harness.dir, harness.pageId);
      expect(saved.html).toContain("Launch plan");
    } finally {
      projectRuns.delete("run-1");
      await harness.close();
    }
  });
});

const EDIT_REV = sourceRevision({ html: PAGE_HTML, css: PAGE_CSS });

async function setupFrame(initHtml: string, renderedHtml = PAGE_HTML) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const composed = composeDocument(renderedHtml, PAGE_CSS, { width: 1280, height: 720, unit: "px" });
  const withScript = composed.replace("</body>", `${elementEditScript("page-one", EDIT_REV, "#d6a85f")}</body>`);
  await page.setContent('<iframe sandbox="allow-scripts" style="width:1280px;height:720px;"></iframe>');
  await page.evaluate((source) => {
    const collector = window as unknown as { messages: unknown[] };
    collector.messages = [];
    window.addEventListener("message", (event) => {
      collector.messages.push(event.data);
    });
    document.querySelector("iframe")!.srcdoc = source;
  }, withScript);
  await page.waitForFunction(() => document.querySelector("iframe")?.contentWindow !== null);
  const iframe = await page.$("iframe");
  const frame = await iframe!.contentFrame();
  await frame!.waitForSelector(".forma-page > *");

  const post = async (message: Record<string, unknown>): Promise<void> => {
    await page.evaluate((message) => document.querySelector("iframe")!.contentWindow!.postMessage(message, "*"), message);
  };
  await post({ type: "forma:edit-init", rev: EDIT_REV, html: initHtml });
  await page.waitForFunction(() => (window as unknown as { messages: unknown[] }).messages.some((message) => (message as { type?: string }).type === "forma:edit-ready"));

  return {
    page,
    frame: frame!,
    messages: async () => (await page.evaluate(() => (window as unknown as { messages: unknown[] }).messages)) as EditFrameMessage[],
    post,
    close: async () => {
      await page.close();
      await browser.close();
    },
  };
}

function lastOfType<T extends EditFrameMessage["type"]>(messages: EditFrameMessage[], type: T): Extract<EditFrameMessage, { type: T }> | undefined {
  return [...messages].reverse().find((message): message is Extract<EditFrameMessage, { type: T }> => message.type === type);
}

function commitOp(message: EditFrameMessage | undefined, kind: EditOp["kind"]): EditOp | undefined {
  if (!message || message.type !== "forma:edit-commit") return undefined;
  return message.after.find((op) => op.kind === kind);
}

async function waitForMessageType(harness: Awaited<ReturnType<typeof setupFrame>>, type: string): Promise<EditFrameMessage[]> {
  await harness.page.waitForFunction(
    (type) => (window as unknown as { messages: unknown[] }).messages.some((message) => (message as { type?: string }).type === type),
    {},
    type,
  );
  return harness.messages();
}

describe("edit iframe interactions", () => {
  it("ignores keyboard edits while generation or export pauses the canvas", async () => {
    const harness = await setupFrame(PAGE_HTML);
    try {
      await harness.frame.click("p");
      await harness.post({ type: "forma:edit-pause", rev: EDIT_REV, paused: true });
      await harness.frame.waitForFunction(() => (document.body.lastElementChild as HTMLElement).style.visibility === "hidden");
      await harness.frame.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
      expect(await harness.frame.evaluate(() => (document.querySelector("p") as HTMLElement).style.translate)).toBe("");
      expect((await harness.messages()).some((message) => message.type === "forma:edit-commit")).toBe(false);
    } finally {
      await harness.close();
    }
  });
  it("selects SVG artwork as one proportional object", async () => {
    const html = '<svg width="200" height="100"><rect width="200" height="100" fill="red" /></svg>';
    const harness = await setupFrame(html, html);
    try {
      await harness.frame.click("rect");
      const selected = lastOfType(await waitForMessageType(harness, "forma:edit-selected"), "forma:edit-selected");
      expect(selected?.info).toMatchObject({ path: [0], kind: "image", resizable: "ratio" });
    } finally {
      await harness.close();
    }
  });

  it("finishes text editing before serializing a page for navigation or export", async () => {
    const harness = await setupFrame(PAGE_HTML);
    try {
      await harness.frame.evaluate(() => {
        document.querySelector("p")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        const span = document.querySelector("[data-forma-text-run]")!;
        span.textContent = "Final wording";
      });
      await harness.post({ type: "forma:edit-serialize", rev: EDIT_REV, seq: 12, finishText: true });
      const messages = await waitForMessageType(harness, "forma:edit-source");
      expect(lastOfType(messages, "forma:edit-source")?.html).toContain("Final wording");
      expect(lastOfType(messages, "forma:edit-text-end")?.cancelled).toBe(false);
      expect(await harness.frame.$("[data-forma-text-run]")).toBeNull();
    } finally {
      await harness.close();
    }
  });

  it("selects elements by structural path and clears on empty-canvas clicks", async () => {
    const harness = await setupFrame(PAGE_HTML);
    try {
      await harness.frame.click("p");
      const messages = await waitForMessageType(harness, "forma:edit-selected");
      const selection = lastOfType(messages, "forma:edit-selected");
      expect(selection?.info.path).toEqual([0, 1]);
      expect(selection?.info.editableText).toBe(true);
      expect(selection?.info.kind).toBe("text");
      expect(selection?.info.align).toBe("left");

      await harness.frame.evaluate(() => {
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 3, clientY: 3 }));
      });
      await waitForMessageType(harness, "forma:edit-cleared");
    } finally {
      await harness.close();
    }
  });

  it("commits one move op per completed drag", async () => {
    const harness = await setupFrame(PAGE_HTML);
    try {
      await harness.frame.click("p");
      await harness.frame.evaluate(() => {
        const rect = document.querySelector("p")!.getBoundingClientRect();
        document.querySelector("p")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: rect.x + 5, clientY: rect.y + 5 }));
        window.dispatchEvent(new PointerEvent("pointermove", { clientX: rect.x + 55, clientY: rect.y + 30 }));
        window.dispatchEvent(new PointerEvent("pointerup", { clientX: rect.x + 55, clientY: rect.y + 30 }));
      });
      const messages = await waitForMessageType(harness, "forma:edit-commit");
      const commit = lastOfType(messages, "forma:edit-commit");
      const move = commitOp(commit, "move");
      expect(commit?.before).toEqual([{ kind: "move", path: [0, 1], x: 0, y: 0 }]);
      expect(move).toEqual({ kind: "move", path: [0, 1], x: 50, y: 25 });
      const translate = await harness.frame.evaluate(() => (document.querySelector("p") as HTMLElement).style.translate);
      expect(translate).toContain("50px");
    } finally {
      await harness.close();
    }
  });

  it("cancels an active drag on Escape and restores the position", async () => {
    const harness = await setupFrame(PAGE_HTML);
    try {
      await harness.frame.click("p");
      await harness.frame.evaluate(() => {
        const rect = document.querySelector("p")!.getBoundingClientRect();
        document.querySelector("p")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: rect.x + 5, clientY: rect.y + 5 }));
        window.dispatchEvent(new PointerEvent("pointermove", { clientX: rect.x + 85, clientY: rect.y + 55 }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        window.dispatchEvent(new PointerEvent("pointerup", { clientX: rect.x + 85, clientY: rect.y + 55 }));
      });
      const messages = await waitForMessageType(harness, "forma:edit-cancelled");
      expect(messages.some((message) => message.type === "forma:edit-commit")).toBe(false);
      const translate = await harness.frame.evaluate(() => (document.querySelector("p") as HTMLElement).style.translate);
      expect(translate === "" || translate.startsWith("0px")).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("commits a resize op from a corner handle", async () => {
    const harness = await setupFrame(PAGE_HTML);
    try {
      await harness.frame.click("p");
      const start = await harness.frame.evaluate(() => {
        const rect = document.querySelector("p")!.getBoundingClientRect();
        document.querySelector("p")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: rect.x + 5, clientY: rect.y + 5 }));
        window.dispatchEvent(new PointerEvent("pointerup", { clientX: rect.x + 5, clientY: rect.y + 5 }));
        return { right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
      await harness.frame.evaluate((start) => {
        const handle = document.querySelector('[data-forma-dir="se"]')!;
        handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: start.right, clientY: start.bottom }));
        window.dispatchEvent(new PointerEvent("pointermove", { clientX: start.right + 40, clientY: start.bottom + 20 }));
        window.dispatchEvent(new PointerEvent("pointerup", { clientX: start.right + 40, clientY: start.bottom + 20 }));
      }, start);
      const messages = await waitForMessageType(harness, "forma:edit-commit");
      const commit = lastOfType(messages, "forma:edit-commit");
      const resize = commitOp(commit, "resize");
      expect(resize).toEqual({ kind: "resize", path: [0, 1], width: start.width + 40, height: start.height + 20 });
      await harness.post({ type: "forma:edit-apply", rev: EDIT_REV, ops: commit!.before });
      await harness.frame.waitForFunction(() => (document.querySelector("p") as HTMLElement).style.width === "");
      expect(await harness.frame.evaluate(() => (document.querySelector("p") as HTMLElement).style.height)).toBe("");
    } finally {
      await harness.close();
    }
  });

  it("edits a single text run on double-click and reports the node index", async () => {
    const harness = await setupFrame(PAGE_HTML);
    try {
      await harness.frame.evaluate(() => {
        const p = document.querySelector("p")!;
        const rect = p.getBoundingClientRect();
        p.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: rect.x + 10, clientY: rect.y + rect.height / 2 }));
      });
      const messages = await waitForMessageType(harness, "forma:edit-text-start");
      const started = lastOfType(messages, "forma:edit-text-start");
      expect(started?.op).toEqual({ kind: "text", path: [0, 1], node: 0, value: "First paragraph" });

      const editable = await harness.frame.evaluate(() => {
        const span = document.querySelector("[data-forma-text-run]") as HTMLElement;
        span.textContent = "Rewritten run";
        span.dispatchEvent(new Event("input", { bubbles: true }));
        return span.isContentEditable;
      });
      expect(editable).toBe(true);

      await harness.frame.evaluate(() => {
        const span = document.querySelector("[data-forma-text-run]")!;
        span.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      const ended = lastOfType(await waitForMessageType(harness, "forma:edit-text-end"), "forma:edit-text-end");
      expect(ended?.cancelled).toBe(false);
      expect(ended?.op).toEqual({ kind: "text", path: [0, 1], node: 0, value: "Rewritten run" });
      const runGone = await harness.frame.evaluate(() => !document.querySelector("[data-forma-text-run]") && document.querySelector("p")!.textContent === "Rewritten run");
      expect(runGone).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("nudges the selection with arrow keys, 1px or 10px with Shift", async () => {
    const harness = await setupFrame(PAGE_HTML);
    try {
      await harness.frame.click("p");
      await harness.frame.evaluate(() => {
        const rect = document.querySelector("p")!.getBoundingClientRect();
        document.querySelector("p")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: rect.x + 5, clientY: rect.y + 5 }));
        window.dispatchEvent(new PointerEvent("pointerup", { clientX: rect.x + 5, clientY: rect.y + 5 }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }));
      });
      await harness.page.waitForFunction(() => (window as unknown as { messages: unknown[] }).messages.filter((message) => (message as { type?: string }).type === "forma:edit-commit").length >= 2);
      const messages = await harness.messages();
      const commits = messages.filter((message) => message.type === "forma:edit-commit");
      expect(commitOp(commits[0], "move")).toEqual({ kind: "move", path: [0, 1], x: -1, y: 0 });
      expect(commitOp(commits[1], "move")).toEqual({ kind: "move", path: [0, 1], x: 9, y: 0 });
    } finally {
      await harness.close();
    }
  });

  it("serializes the detached copy with original asset references and no editor artifacts", async () => {
    const originalHtml = `<section class="cover"><h1>Brand sheet</h1><img src="../assets/logo.png" alt="Logo"><p>Sized text</p></section>`;
    const harness = await setupFrame(originalHtml);
    try {
      await harness.frame.evaluate(() => {
        const section = document.querySelector("section")!;
        section.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 20 }));
        window.dispatchEvent(new PointerEvent("pointermove", { clientX: 60, clientY: 20 }));
        window.dispatchEvent(new PointerEvent("pointerup", { clientX: 60, clientY: 20 }));
      });
      await waitForMessageType(harness, "forma:edit-commit");

      await harness.post({ type: "forma:edit-serialize", rev: EDIT_REV, seq: 7 });
      await harness.page.waitForFunction(() => (window as unknown as { messages: unknown[] }).messages.some((message) => (message as { type?: string; seq?: number }).type === "forma:edit-source" && (message as { seq?: number }).seq === 7));
      const html = (lastOfType(await harness.messages(), "forma:edit-source") as { html: string }).html;
      expect(html).toContain('src="../assets/logo.png"');
      expect(html).not.toContain("data:image/");
      expect(html).not.toContain("data-forma");
      expect(html).toContain("Brand sheet");

      await harness.post({ type: "forma:edit-serialize", rev: EDIT_REV, seq: 8 });
      await harness.page.waitForFunction(() => (window as unknown as { messages: unknown[] }).messages.some((message) => (message as { type?: string; seq?: number }).type === "forma:edit-source" && (message as { seq?: number }).seq === 8));
      const again = lastOfType(await harness.messages(), "forma:edit-source") as { html: string };
      expect(again.html).toBe(html);
    } finally {
      await harness.close();
    }
  });

  it("applies host ops to both the live frame and the detached copy", async () => {
    const harness = await setupFrame(PAGE_HTML);
    try {
      await harness.post({ type: "forma:edit-apply", rev: EDIT_REV, ops: [{ kind: "style", path: [0, 1], styles: { opacity: "0.5" } }] });
      await waitForMessageType(harness, "forma:edit-info");
      const opacity = await harness.frame.evaluate(() => (document.querySelector("p") as HTMLElement).style.opacity);
      expect(opacity).toBe("0.5");

      await harness.post({ type: "forma:edit-serialize", rev: EDIT_REV, seq: 3 });
      await harness.page.waitForFunction(() => (window as unknown as { messages: unknown[] }).messages.some((message) => (message as { type?: string; seq?: number }).type === "forma:edit-source" && (message as { seq?: number }).seq === 3));
      const source = lastOfType(await harness.messages(), "forma:edit-source") as { html: string };
      expect(source.html).toMatch(/opacity:\s*0\.5/);
      expect(source.html).not.toContain("data-forma");
      expect(source.html).toContain("First paragraph");
    } finally {
      await harness.close();
    }
  });
});
