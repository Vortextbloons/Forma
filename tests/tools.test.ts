import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolHarness } from "rig/testing";
import { researchTools } from "../src/tools/research.ts";
import { projectRuns, setFormaEnv } from "../src/forma/runtime.ts";
import { scheduleExtraction } from "../src/extraction/index.ts";
import { writePage, readPage } from "../src/projects/pages.ts";
import { projectTools } from "../src/tools/project.ts";
import { createProject, importContextNote, openProject, updateProject } from "../src/projects/store.ts";
import {
  clearSearchKey,
  credentialsFile,
  getSearchKey,
  searchCredentialStatus,
  setSearchKey,
} from "../src/settings/credentials.ts";
import { defaultSettings, type ProjectSettings } from "../src/projects/schema.ts";

const research = researchTools.find((tool) => tool.name === "research")!;
const findPhotos = researchTools.find((tool) => tool.name === "find_photos")!;
const importPhoto = researchTools.find((tool) => tool.name === "import_photo")!;
const submitOutline = projectTools.find((tool) => tool.name === "submit_outline")!;
const submitPage = projectTools.find((tool) => tool.name === "submit_page")!;

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forma-tools-"));
  process.env.FORMA_DATA_DIR = join(root, "data");
});

afterAll(async () => {
  delete process.env.FORMA_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

async function makeProject(name: string, patch?: Partial<ProjectSettings>): Promise<string> {
  const dir = join(root, name);
  await createProject({
    dir,
    name,
    prompt: "",
    mode: "plan",
    settings: defaultSettings(patch?.output ?? "slides"),
  });
  if (patch) {
    await updateProject(dir, (project) => {
      project.settings = { ...project.settings, ...patch };
    });
  }
  return dir;
}

async function withFetchSpy<T>(run: () => Promise<T>): Promise<{ result: T; calls: number }> {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("network access is not allowed in this test");
  }) as typeof fetch;
  try {
    const result = await run();
    return { result, calls };
  } finally {
    globalThis.fetch = original;
  }
}

describe("search tool gating", () => {
  it("research does not run or fetch while the toggle is off", async () => {
    const dir = await makeProject("research-off");
    const { calls } = await withFetchSpy(async () => {
      const harness = createToolHarness(research, { cwd: dir });
      await expect(harness.run({ query: "facts" })).rejects.toThrow(/turned off/i);
    });
    expect(calls).toBe(0);
  });

  it("research reports a missing key before any request when enabled", async () => {
    const dir = await makeProject("research-on", { research: true });
    const { calls } = await withFetchSpy(async () => {
      const harness = createToolHarness(research, { cwd: dir });
      await expect(harness.run({ query: "facts" })).rejects.toThrow(/API key/i);
    });
    expect(calls).toBe(0);
  });

  it("image search does not run or fetch while the toggle is off", async () => {
    const dir = await makeProject("photos-off");
    const { calls } = await withFetchSpy(async () => {
      const photos = createToolHarness(findPhotos, { cwd: dir });
      await expect(photos.run({ query: "mountains" })).rejects.toThrow(/turned off/i);
      const importer = createToolHarness(importPhoto, { cwd: dir });
      await expect(importer.run({ photoId: "1" })).rejects.toThrow(/turned off/i);
    });
    expect(calls).toBe(0);
  });

  it("stores search keys protected on disk and reports masked status", async () => {
    await setSearchKey("exa", "exa-test-key-1234567890");
    const raw = JSON.parse(await readFile(credentialsFile(), "utf8")) as {
      exa?: { protected?: string };
    };
    expect(raw.exa?.protected).toBeTruthy();
    expect(raw.exa?.protected).not.toContain("exa-test-key");
    expect(await getSearchKey("exa")).toBe("exa-test-key-1234567890");
    const status = await searchCredentialStatus();
    expect(status.exa.configured).toBe(true);
    expect(status.exa.masked).toContain("…");
    await clearSearchKey("exa");
    expect(await getSearchKey("exa")).toBeUndefined();
  }, 60_000);
});

describe("artwork tools", () => {
  it("creates editable source files and preserves targeted edits, metadata, and undo", async () => {
    const dir = await makeProject("source-files");
    const session = { id: "source-files" };
    projectRuns.set(session.id, { mode: "build", artworkChanged: false, changedPageIds: new Set() });
    const run = (name: string, input: unknown) => createToolHarness(projectTools.find((tool) => tool.name === name)!, { cwd: dir, session }).run(input);
    try {
      const page = await run("create_page", { index: 1, title: "One" }) as { pageId: string; files: { html: string; css: string } };
      await run("write_file", { path: page.files.html, content: "<h1>Original</h1>" });
      await run("write_file", { path: page.files.css, content: "h1 { color: red; }" });
      await run("edit_file", { path: page.files.html, edits: [{ find: "Original", replace: "Revised" }] });
      expect(await readFile(join(dir, page.files.html), "utf8")).toBe("<h1>Revised</h1>\n");
      expect((await readPage(dir, page.pageId)).css).toBe("h1 { color: red; }\n");
      expect((await openProject(dir)).pageMeta[page.pageId]?.title).toBe("One");
      expect(projectRuns.get(session.id)?.changedPageIds?.has(page.pageId)).toBe(true);
      await expect(run("edit_file", { path: page.files.html, edits: [{ find: "missing", replace: "bad" }] })).rejects.toThrow(/exactly once/);
      await expect(run("write_file", { path: page.files.html, content: "<script>alert(1)</script>" })).rejects.toThrow(/script/);
      await expect(run("write_file", { path: "project.json", content: "{}" })).rejects.toThrow(/Only registered/);
      await expect(run("write_file", { path: `../${page.files.html}`, content: "bad" })).rejects.toThrow(/Only registered/);
      await expect(run("create_page", { index: 1 })).rejects.toThrow(/already exists/);
      await run("restore_page", { pageId: page.pageId });
      expect((await readPage(dir, page.pageId)).html).toBe("<h1>Original</h1>\n");
    } finally { projectRuns.delete(session.id); }
  });

  it("emits one-based page.ready indexes so live previews keep their order", async () => {
    const dir = await makeProject("event-index");
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    setFormaEnv({ projectDir: dir, events: { emit: (type, data) => { events.push({ type, data }); } } });
    const session = { id: "event-index" };
    projectRuns.set(session.id, { mode: "build", artworkChanged: false, changedPageIds: new Set() });
    try {
      const run = (name: string, input: unknown) => createToolHarness(projectTools.find((tool) => tool.name === name)!, { cwd: dir, session }).run(input);
      const first = await run("create_page", { index: 1, title: "One" }) as { pageId: string; files: { html: string; css: string } };
      await run("create_page", { index: 2, title: "Two" });
      await run("write_file", { path: first.files.html, content: "<h1>One</h1>" });
      const ready = events.filter((event) => event.type === "forma.page.ready").map((event) => event.data.index);
      expect(ready).toEqual([1, 2, 1]);
    } finally {
      projectRuns.delete(session.id);
      setFormaEnv(undefined);
    }
  });

  it("continues truncated text inside the last page without losing characters", async () => {
    const dir = await makeProject("text-continuation");
    const { item } = await importContextNote(dir, "abcdefghij", "content-source", "Long note");
    await scheduleExtraction(dir, item.id);
    const tool = createToolHarness(projectTools.find((tool) => tool.name === "read_context")!, { cwd: dir });
    const first = await tool.run({ id: item.id, maxChars: 4 }) as { truncated: boolean; pages: Array<{ text: string }>; next: { page: number; offset: number } };
    expect(first.truncated).toBe(true);
    expect(first.next).toEqual({ page: 1, offset: 4 });
    const rest = await tool.run({ id: item.id, ...first.next, maxChars: 10 }) as { text: string; truncated: boolean };
    expect(first.pages[0]!.text + rest.text).toBe("abcdefghij");
    expect(rest.truncated).toBe(false);
  });

  it("enforces page scope for updates, submissions, restores, and outline edits", async () => {
    const dir = await makeProject("page-scope");
    const first = await writePage(dir, { index: 1, title: "One", html: "<p>one</p>", css: "" });
    const second = await writePage(dir, { index: 2, title: "Two", html: "<p>two</p>", css: "" });
    const session = { id: "page-scope" };
    projectRuns.set(session.id, { mode: "build", artworkChanged: false, allowedPageIds: [first.pageId] });
    try {
      const run = (name: string, input: unknown) => createToolHarness(projectTools.find((tool) => tool.name === name)!, { cwd: dir, session }).run(input);
      await expect(run("update_page", { pageId: second.pageId, html: "<p>wrong</p>" })).rejects.toThrow(/selected page/);
      await expect(run("submit_page", { index: 2, html: "<p>wrong</p>" })).rejects.toThrow(/selected page/);
      await expect(run("restore_page", { pageId: second.pageId })).rejects.toThrow(/selected page/);
      await expect(run("submit_outline", { entries: [{ title: "Changed" }] })).rejects.toThrow(/cannot change/);
      await expect(run("create_page", { index: 3 })).rejects.toThrow(/selected page/);
      await expect(run("write_file", { path: `pages/${second.pageId}.html`, content: "<p>wrong</p>" })).rejects.toThrow(/selected page/);
      await expect(run("edit_file", { path: `pages/${second.pageId}.css`, edits: [{ find: "two", replace: "wrong" }] })).rejects.toThrow(/selected page/);
      await run("update_page", { pageId: first.pageId, htmlEdits: [{ find: "one", replace: "blue" }] });
      expect((await readPage(dir, first.pageId)).html).toContain("blue");
      expect((await readPage(dir, second.pageId)).html).toContain("two");
    } finally { projectRuns.delete(session.id); }
  });

  it("blocks artwork creation and updates during a Plan run", async () => {
    const dir = await makeProject("plan-guard");
    const page = await writePage(dir, { index: 1, title: "Original", html: "<div>Original artwork</div>", css: "" });
    const session = { id: "plan-guard" };
    projectRuns.set(session.id, { mode: "plan", artworkChanged: false });
    try {
      const submit = createToolHarness(submitPage, { cwd: dir, session });
      const update = createToolHarness(projectTools.find((tool) => tool.name === "update_page")!, { cwd: dir, session });
      await expect(submit.run({ index: 2, html: "<div>New</div>", css: "", assets: [] })).rejects.toThrow(/Switch to Build/);
      await expect(update.run({ pageId: page.pageId, html: "<div>Changed</div>" })).rejects.toThrow(/Switch to Build/);
      const run = (name: string, input: unknown) => createToolHarness(projectTools.find((tool) => tool.name === name)!, { cwd: dir, session }).run(input);
      await expect(run("create_page", { index: 2 })).rejects.toThrow(/Switch to Build/);
      await expect(run("write_file", { path: `pages/${page.pageId}.html`, content: "<p>changed</p>" })).rejects.toThrow(/Switch to Build/);
      await expect(run("edit_file", { path: `pages/${page.pageId}.html`, edits: [{ find: "Original", replace: "changed" }] })).rejects.toThrow(/Switch to Build/);
      expect((await openProject(dir)).pages).toEqual([page.pageId]);
      expect((await readPage(dir, page.pageId)).html).toContain("Original artwork");
    } finally {
      projectRuns.delete(session.id);
    }
  });

  it("posters accept exactly one composition brief", async () => {
    const dir = await makeProject("poster", { output: "poster" });
    const harness = createToolHarness(submitOutline, { cwd: dir });
    await expect(
      harness.run({
        entries: [
          { title: "A", points: [], assetIds: [] },
          { title: "B", points: [], assetIds: [] },
        ],
      }),
    ).rejects.toThrow(/exactly one/i);

    const result = await harness.run({
      entries: [{ title: "Poster brief", points: ["Key message"], assetIds: [] }],
    });
    expect(result).toMatchObject({ ok: true, entries: 1 });
    const project = await openProject(dir);
    expect(project.outline).toHaveLength(1);
  }, 30_000);

  it("submit_page rejects unknown asset assignments", async () => {
    const dir = await makeProject("assets");
    const harness = createToolHarness(submitPage, { cwd: dir });
    await expect(
      harness.run({
        index: 1,
        title: "One",
        html: "<div>one</div>",
        css: "",
        assets: ["ctx_nope"],
      }),
    ).rejects.toThrow(/Unknown asset/i);
    const project = await openProject(dir);
    expect(project.pages).toEqual([]);
  }, 30_000);
});
