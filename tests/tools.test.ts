import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolHarness, TestAgentHost } from "rig/testing";
import { designTools, type DesignProposal } from "../src/tools/design.ts";
import { defaultDesignProfile } from "../src/projects/design.ts";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { researchTools } from "../src/tools/research.ts";
import { brandTools } from "../src/tools/brand.ts";
import { loadToolsTool, loadedGroupTools, prepareSessionTools, TOOL_GROUPS } from "../src/tools/lazy.ts";
import { chartTools } from "../src/tools/chart.ts";
import { diagramTools } from "../src/tools/diagram.ts";
import { iconTools } from "../src/tools/icons.ts";
import { mathTools } from "../src/tools/math.ts";
import { projectRuns, setFormaEnv } from "../src/forma/runtime.ts";
import { scheduleExtraction } from "../src/extraction/index.ts";
import { writePage, readPage } from "../src/projects/pages.ts";
import { composePage } from "../src/rendering/compose.ts";
import { renderArtworkPreview } from "../src/rendering/validate.ts";
import { runExport } from "../src/rendering/export.ts";
import { projectTools } from "../src/tools/project.ts";
import { createProject, importContextNote, openProject, updateProject } from "../src/projects/store.ts";
import {
  clearSearchKey,
  credentialsFile,
  getSearchKey,
  getSearchDefaults,
  searchCredentialStatus,
  setSearchKey,
  setSearchDefaults,
} from "../src/settings/credentials.ts";
import { defaultSettings, type ProjectSettings } from "../src/projects/schema.ts";

const research = researchTools.find((tool) => tool.name === "research")!;
const findPhotos = researchTools.find((tool) => tool.name === "find_photos")!;
const importPhoto = researchTools.find((tool) => tool.name === "import_photo")!;
const findBrandIcon = brandTools.find((tool) => tool.name === "find_brand_icon")!;
const importBrandIcon = brandTools.find((tool) => tool.name === "import_brand_icon")!;
const createChart = chartTools.find((tool) => tool.name === "create_chart")!;
const createDiagram = diagramTools.find((tool) => tool.name === "create_diagram")!;
const findIcon = iconTools.find((tool) => tool.name === "find_icon")!;
const importIcon = iconTools.find((tool) => tool.name === "import_icon")!;
const renderMath = mathTools.find((tool) => tool.name === "render_math")!;
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

async function withMockFetch<T>(handler: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

async function withDdgsEnv<T>(
  env: { python: string; helper?: string },
  run: () => Promise<T>,
): Promise<T> {
  const previousPython = process.env.FORMA_DDGS_PYTHON;
  const previousHelper = process.env.FORMA_DDGS_HELPER;
  process.env.FORMA_DDGS_PYTHON = env.python;
  if (env.helper) process.env.FORMA_DDGS_HELPER = env.helper;
  try {
    return await run();
  } finally {
    if (previousPython === undefined) delete process.env.FORMA_DDGS_PYTHON;
    else process.env.FORMA_DDGS_PYTHON = previousPython;
    if (previousHelper === undefined) delete process.env.FORMA_DDGS_HELPER;
    else process.env.FORMA_DDGS_HELPER = previousHelper;
  }
}

async function withDdgsFixture<T>(response: unknown, run: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(root, "ddgs-fixture-"));
  const script = join(dir, "helper.mjs");
  await writeFile(
    script,
    [
      'let input = "";',
      'process.stdin.on("data", (chunk) => (input += chunk));',
      'process.stdin.on("end", () => {',
      `  process.stdout.write(JSON.stringify(${JSON.stringify(response)}) + "\\n");`,
      "});",
    ].join("\n"),
  );
  return withDdgsEnv({ python: process.execPath, helper: script }, run);
}

function encodeDdgsPhoto(photo: Record<string, unknown>): string {
  return `ddgs:${Buffer.from(JSON.stringify(photo), "utf8").toString("base64url")}`;
}

const OFF_DEFAULTS = {
  research: false,
  imageSearch: false,
  researchProvider: "exa",
  imageProvider: "pexels",
} as const;

const DDGS_DEFAULTS = {
  research: true,
  imageSearch: true,
  researchProvider: "ddgs",
  imageProvider: "ddgs",
} as const;

describe("design approval and questions", () => {
  const propose = designTools.find((tool) => tool.name === "propose_design")!;
  const question = designTools.find((tool) => tool.name === "ask_question")!;
  const proposal: DesignProposal = { name: "Orchid", rationale: "A vivid accent for the brief", profile: { ...defaultDesignProfile(), colors: { ...defaultDesignProfile().colors, accent: "#8032a8", coral: "#ef7866", mint: "#a0e8c4" }, fonts: { heading: "Rockwell", body: "Cambria", utility: "Consolas" }, headingSize: 320 } };

  it("leaves the active design untouched through feedback and rejection, then applies approved tokens to every page", async () => {
    const dir = await makeProject("design-approval", { designApproved: false });
    const { pageId } = await writePage(dir, { index: 1, title: "One", assets: [], html: '<h1 class="forma-accent">One</h1>', css: "" });
    const second = await writePage(dir, { index: 2, title: "Two", assets: [], html: '<h1 class="forma-accent">Two</h1>', css: "" });
    const before = await openProject(dir);
    const sources = await Promise.all([pageId, second.pageId].map((id) => readPage(dir, id)));
    const host = new TestAgentHost();
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    setFormaEnv({ projectDir: dir, host, events: { emit: (type, data) => events.push({ type, data }) } });
    try {
      host.nextQuestionAnswer(async (interaction) => {
        expect((interaction as typeof interaction & { designProposal: DesignProposal }).designProposal).toEqual(proposal);
        expect((await openProject(dir)).settings).toEqual(before.settings);
        return "Use a warmer accent";
      });
      const harness = createToolHarness(propose, { cwd: dir });
      expect(await harness.run(proposal)).toMatchObject({ approved: false, feedback: "Use a warmer accent" });
      host.nextQuestionAnswer("reject");
      expect(await harness.run(proposal)).toMatchObject({ approved: false });
      expect((await openProject(dir)).settings).toEqual(before.settings);
      expect(events).toEqual([]);
      host.nextQuestionAnswer(["approve"]);
      expect(await harness.run(proposal)).toMatchObject({ approved: true });
      const approved = await openProject(dir);
      expect(approved.settings).toMatchObject({ designApproved: true, designName: "Orchid", designProfile: proposal.profile });
      expect(approved.settingsRevision).toBe(before.settingsRevision + 1);
      expect(events).toMatchObject([{ type: "forma.design.changed" }]);
      for (const [index, id] of [pageId, second.pageId].entries()) {
        const composed = await composePage(dir, id, { width: 1920, height: 1080, unit: "px" });
        expect(composed.html).toContain("--forma-accent: #8032a8");
        expect(composed.html).toContain("--forma-color-coral: #ef7866");
        expect(composed.html).toContain("--forma-color-mint: #a0e8c4");
        expect(composed.html).toContain('--forma-font-heading: "Rockwell"');
        expect(composed.html).toContain('--forma-font-utility: "Consolas", monospace');
        expect(composed.html).toContain("--forma-heading-size: 320px");
        expect(await readPage(dir, id)).toEqual(sources[index]);
      }
    } finally {
      setFormaEnv(undefined);
    }
  });

  it("offers custom answers and AI choice and returns the user's answer", async () => {
    const dir = await makeProject("design-question");
    const host = new TestAgentHost().nextQuestionAnswer("Our board").nextQuestionAnswer(["Let AI decide"]);
    setFormaEnv({ projectDir: dir, host, events: { emit() {} } });
    try {
      const harness = createToolHarness(question, { cwd: dir });
      expect(await harness.run({ question: "Who is the audience?", options: [{ label: "Customers" }] })).toEqual({ answer: "Our board" });
      expect(host.interactions[0]).toMatchObject({ allowCustom: true, options: [{ label: "Customers", value: "Customers" }, { label: "Let AI decide", value: "Let AI decide" }] });
      expect(await harness.run({ question: "Which tone?" })).toEqual({ answer: ["Let AI decide"] });
    } finally {
      setFormaEnv(undefined);
    }
  });

  it("rejects CSS injection in free-form fonts and additional color names", async () => {
    const dir = await makeProject("design-css-input");
    const harness = createToolHarness(propose, { cwd: dir });
    await expect(harness.run({ ...proposal, profile: { ...proposal.profile, fonts: { ...proposal.profile.fonts, heading: 'Impact"; color:red;' } } })).rejects.toThrow();
    await expect(harness.run({ ...proposal, profile: { ...proposal.profile, colors: { ...proposal.profile.colors, "coral; color:red": "#ef7866" } } })).rejects.toThrow();
    expect((await openProject(dir)).settings.designName).toBe("Custom");
  });

  it("blocks artwork until the design is approved and cannot apply a proposal after cancellation", async () => {
    const dir = await makeProject("design-stopped", { designApproved: false });
    await expect(createToolHarness(submitPage, { cwd: dir }).run({ index: 1, html: "<h1>Wait</h1>" })).rejects.toThrow(/approval/i);
    const before = await openProject(dir);
    const controller = new AbortController();
    const host = new TestAgentHost().nextQuestionAnswer(() => { controller.abort(); return "approve"; });
    setFormaEnv({ projectDir: dir, host, events: { emit() {} } });
    try {
      await expect(createToolHarness(propose, { cwd: dir, signal: controller.signal }).run(proposal)).rejects.toThrow();
      expect((await openProject(dir)).settings).toEqual(before.settings);
    } finally {
      setFormaEnv(undefined);
    }
  });
});

describe("search tool gating", () => {
  it("inherits persisted global defaults while preserving per-project overrides", async () => {
    const inherited = await makeProject("search-inherited");
    const disabled = await makeProject("search-disabled", { research: false, imageSearch: false });
    const enabled = await makeProject("search-enabled", { research: true, imageSearch: true });
    const run = (dir: string, tool: typeof research, input: unknown) => createToolHarness(tool, { cwd: dir }).run(input);
    const readSettings = async (dir: string) => (await run(dir, projectTools.find((tool) => tool.name === "read_project")!, {})) as { settings: { research: boolean; imageSearch: boolean } };
    const apiDefaults = { ...OFF_DEFAULTS, research: true, imageSearch: true };
    try {
      await setSearchDefaults(apiDefaults);
      expect(await getSearchDefaults()).toEqual(apiDefaults);
      expect((await readSettings(inherited)).settings).toMatchObject({ research: true, imageSearch: true });
      const { calls } = await withFetchSpy(async () => {
        await expect(run(inherited, research, { query: "facts" })).rejects.toThrow(/API key/i);
        await expect(run(inherited, findPhotos, { query: "mountains" })).rejects.toThrow(/API key/i);
        await expect(run(disabled, research, { query: "facts" })).rejects.toThrow(/turned off/i);
        await expect(run(disabled, findPhotos, { query: "mountains" })).rejects.toThrow(/turned off/i);
        await expect(run(disabled, importPhoto, { photoId: "1" })).rejects.toThrow(/turned off/i);
        await setSearchDefaults(OFF_DEFAULTS);
        await expect(run(inherited, research, { query: "facts" })).rejects.toThrow(/turned off/i);
        await expect(run(inherited, findPhotos, { query: "mountains" })).rejects.toThrow(/turned off/i);
        await expect(run(enabled, research, { query: "facts" })).rejects.toThrow(/API key/i);
        await expect(run(enabled, findPhotos, { query: "mountains" })).rejects.toThrow(/API key/i);
      });
      expect(calls).toBe(0);
      expect((await openProject(disabled)).settings).toMatchObject({ research: false, imageSearch: false });
      expect((await openProject(inherited)).settings).toMatchObject({ research: null, imageSearch: null });
    } finally {
      await setSearchDefaults(OFF_DEFAULTS);
    }
  });

  it("research does not run or fetch while the toggle is off", async () => {
    await setSearchDefaults(OFF_DEFAULTS);
    const dir = await makeProject("research-off");
    const { calls } = await withFetchSpy(async () => {
      const harness = createToolHarness(research, { cwd: dir });
      await expect(harness.run({ query: "facts" })).rejects.toThrow(/turned off/i);
    });
    expect(calls).toBe(0);
  });

  it("research reports a missing key before any request when enabled", async () => {
    await setSearchDefaults({ ...OFF_DEFAULTS, research: true });
    const dir = await makeProject("research-on", { research: true });
    const { calls } = await withFetchSpy(async () => {
      const harness = createToolHarness(research, { cwd: dir });
      await expect(harness.run({ query: "facts" })).rejects.toThrow(/API key/i);
    });
    expect(calls).toBe(0);
  });

  it("image search does not run or fetch while the toggle is off", async () => {
    await setSearchDefaults(OFF_DEFAULTS);
    const dir = await makeProject("photos-off");
    const { calls } = await withFetchSpy(async () => {
      const photos = createToolHarness(findPhotos, { cwd: dir });
      await expect(photos.run({ query: "mountains" })).rejects.toThrow(/turned off/i);
      const importer = createToolHarness(importPhoto, { cwd: dir });
      await expect(importer.run({ photoId: "1" })).rejects.toThrow(/turned off/i);
    });
    expect(calls).toBe(0);
  });

  it("keeps image search permissions authoritative over design guidelines", async () => {
    const guidelines = defaultSettings().designGuidelines;
    const photoHeavy = await makeProject("guidelines-photo-heavy", { imageSearch: false, designGuidelines: { ...guidelines, photoHeavy: true } });
    const suppliedOnly = await makeProject("guidelines-supplied-only", { imageSearch: true, designGuidelines: { ...guidelines, onlySuppliedImages: true } });
    const readProject = projectTools.find((tool) => tool.name === "read_project")!;
    const { calls } = await withFetchSpy(async () => {
      await expect(createToolHarness(findPhotos, { cwd: photoHeavy }).run({ query: "mountains" })).rejects.toThrow(/turned off/i);
      await expect(createToolHarness(findPhotos, { cwd: suppliedOnly }).run({ query: "mountains" })).rejects.toThrow(/supplied images/i);
      await expect(createToolHarness(importPhoto, { cwd: suppliedOnly }).run({ photoId: "1" })).rejects.toThrow(/supplied images/i);
    });
    expect(calls).toBe(0);
    const exposed = (await createToolHarness(readProject, { cwd: suppliedOnly }).run({})) as {
      settings: { designGuidelines: { onlySuppliedImages: boolean } };
    };
    expect(exposed.settings.designGuidelines.onlySuppliedImages).toBe(true);
  });

  it("stores search keys protected on disk and reports masked status", async () => {
    await setSearchDefaults({ research: true, imageSearch: false, researchProvider: "exa", imageProvider: "pexels" });
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
    expect(await getSearchDefaults()).toEqual({ research: true, imageSearch: false, researchProvider: "exa", imageProvider: "pexels" });
    await setSearchDefaults(OFF_DEFAULTS);
  }, 60_000);
});

describe("built-in search", () => {
  it("routes research to the bundled runtime", async () => {
    await setSearchDefaults(DDGS_DEFAULTS);
    const dir = await makeProject("ddgs-research", { research: true });
    const missing = join(root, "missing-python.exe");
    const { calls } = await withFetchSpy(async () => {
      await withDdgsEnv({ python: missing }, async () => {
        await expect(createToolHarness(research, { cwd: dir }).run({ query: "facts" })).rejects.toThrow(
          /FORMA_DDGS_PYTHON|Built-in search runtime/,
        );
      });
    });
    expect(calls).toBe(0);
  });

  it("routes image search to the bundled runtime", async () => {
    await setSearchDefaults(DDGS_DEFAULTS);
    const dir = await makeProject("ddgs-photos-route", { imageSearch: true });
    const missing = join(root, "missing-python.exe");
    const { calls } = await withFetchSpy(async () => {
      await withDdgsEnv({ python: missing }, async () => {
        await expect(createToolHarness(findPhotos, { cwd: dir }).run({ query: "photos" })).rejects.toThrow(
          /FORMA_DDGS_PYTHON|Built-in search runtime/,
        );
      });
    });
    expect(calls).toBe(0);
  });

  it("normalizes built-in results and records sources", async () => {
    await setSearchDefaults(DDGS_DEFAULTS);
    const dir = await makeProject("ddgs-results", { research: true });
    await withDdgsFixture(
      { ok: true, results: [{ title: "Facts", url: "https://example.com/facts", snippet: "Body" }] },
      async () => {
        const result = (await createToolHarness(research, { cwd: dir }).run({ query: "facts", maxResults: 3 })) as {
          results: Array<{ title: string; url: string; snippet: string }>;
        };
        expect(result.results).toEqual([
          { title: "Facts", url: "https://example.com/facts", snippet: "Body" },
        ]);
      },
    );
    const project = await openProject(dir);
    expect(project.sources).toHaveLength(1);
    expect(project.sources[0]).toMatchObject({
      kind: "research",
      provider: "ddgs",
      url: "https://example.com/facts",
      query: "facts",
    });
  });

  it("returns built-in photos with orientation filtering", async () => {
    await setSearchDefaults(DDGS_DEFAULTS);
    const dir = await makeProject("ddgs-photos", { imageSearch: true });
    const results = [
      {
        title: "Wide",
        imageUrl: "https://images.example.com/wide.jpg",
        pageUrl: "https://example.com/wide",
        thumbnailUrl: "https://images.example.com/wide-thumb.jpg",
        width: 1600,
        height: 900,
      },
      {
        title: "Tall",
        imageUrl: "https://images.example.com/tall.jpg",
        pageUrl: "https://example.com/tall",
        width: 900,
        height: 1600,
      },
      { title: "Unknown", imageUrl: "https://images.example.com/unknown.jpg" },
    ];
    await withDdgsFixture({ ok: true, results }, async () => {
      const found = (await createToolHarness(findPhotos, { cwd: dir }).run({
        query: "photos",
        orientation: "landscape",
      })) as {
        photos: Array<{ photoId: string; description: string; width?: number; height?: number }>;
      };
      expect(found.photos.map((photo) => photo.description)).toEqual(["Wide", "Unknown"]);
      expect(found.photos.every((photo) => photo.photoId.startsWith("ddgs:"))).toBe(true);
    });
  });
});

describe("built-in photo imports", () => {
  const imageUrl = "http://93.184.216.34/photo.jpg";
  const pageUrl = "https://example.com/photo";
  const photoId = encodeDdgsPhoto({ title: "Photo", imageUrl, pageUrl });

  it("imports a photo and records an unverified source", async () => {
    await setSearchDefaults(DDGS_DEFAULTS);
    const dir = await makeProject("ddgs-import", { imageSearch: true });
    const imported = await withMockFetch(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }),
      async () =>
        (await createToolHarness(importPhoto, { cwd: dir }).run({
          photoId,
          query: "photos",
          role: "style-reference",
        })) as {
          contextId: string;
          name: string;
          attribution: { provider: string; licenseStatus: string };
        },
    );
    expect(imported.name).toBe("Photo");
    expect(imported.attribution).toMatchObject({
      provider: "Built-in image search",
      licenseStatus: "unverified",
    });
    const project = await openProject(dir);
    expect(project.context.find((entry) => entry.id === imported.contextId)).toMatchObject({
      mime: "image/jpeg",
      role: "style-reference",
      status: "ready",
    });
    expect(project.sources[0]).toMatchObject({
      kind: "photo",
      provider: "ddgs",
      url: pageUrl,
      query: "photos",
      licenseStatus: "unverified",
    });
  });

  it("rejects invalid photo ids without importing", async () => {
    await setSearchDefaults(DDGS_DEFAULTS);
    const dir = await makeProject("ddgs-invalid-id", { imageSearch: true });
    await expect(createToolHarness(importPhoto, { cwd: dir }).run({ photoId: "ddgs:@@@" })).rejects.toThrow(
      /Invalid photoId/,
    );
    await expect(createToolHarness(importPhoto, { cwd: dir }).run({ photoId: "not-a-photo" })).rejects.toThrow(
      /Invalid photoId/,
    );
    expect((await openProject(dir)).context).toHaveLength(0);
  });

  it("blocks private download targets and redirects", async () => {
    await setSearchDefaults(DDGS_DEFAULTS);
    const dir = await makeProject("ddgs-blocked", { imageSearch: true });
    const privateId = encodeDdgsPhoto({ title: "Private", imageUrl: "http://127.0.0.1/photo.jpg" });
    await expect(createToolHarness(importPhoto, { cwd: dir }).run({ photoId: privateId })).rejects.toThrow(
      /private|loopback/i,
    );
    const redirectId = encodeDdgsPhoto({ title: "Redirect", imageUrl });
    await withMockFetch(
      async () =>
        new Response(null, { status: 302, headers: { location: "http://127.0.0.1/evil.jpg" } }),
      async () => {
        await expect(createToolHarness(importPhoto, { cwd: dir }).run({ photoId: redirectId })).rejects.toThrow(
          /private|loopback/i,
        );
      },
    );
    const project = await openProject(dir);
    expect(project.context).toHaveLength(0);
    expect(project.sources).toHaveLength(0);
  });

  it("rejects unsupported image types and oversized downloads", async () => {
    await setSearchDefaults(DDGS_DEFAULTS);
    const dir = await makeProject("ddgs-types", { imageSearch: true });
    await withMockFetch(
      async () => new Response("not an image", { headers: { "content-type": "text/plain" } }),
      async () => {
        await expect(createToolHarness(importPhoto, { cwd: dir }).run({ photoId })).rejects.toThrow(
          /unsupported image type/i,
        );
      },
    );
    await withMockFetch(
      async () =>
        new Response(new Uint8Array(25 * 1024 * 1024 + 1), {
          headers: { "content-type": "image/png" },
        }),
      async () => {
        await expect(createToolHarness(importPhoto, { cwd: dir }).run({ photoId })).rejects.toThrow(
          /too large/i,
        );
      },
    );
    expect((await openProject(dir)).context).toHaveLength(0);
  });

  it("leaves no asset when the download fails", async () => {
    await setSearchDefaults(DDGS_DEFAULTS);
    const dir = await makeProject("ddgs-download-fail", { imageSearch: true });
    await withMockFetch(
      async () => new Response("nope", { status: 500 }),
      async () => {
        await expect(createToolHarness(importPhoto, { cwd: dir }).run({ photoId })).rejects.toThrow(
          /HTTP 500/,
        );
      },
    );
    const project = await openProject(dir);
    expect(project.context).toHaveLength(0);
    expect(project.sources).toHaveLength(0);
  });
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

  it("deletes a page, its files, and emits a deleted event", async () => {
    const dir = await makeProject("delete-page");
    const first = await writePage(dir, { index: 1, title: "One", html: "<p>one</p>", css: "p { color: red; }" });
    const second = await writePage(dir, { index: 2, title: "Two", html: "<p>two</p>", css: "" });
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    setFormaEnv({ projectDir: dir, events: { emit: (type, data) => { events.push({ type, data }); } } });
    const session = { id: "delete-page" };
    projectRuns.set(session.id, { mode: "build", artworkChanged: false, changedPageIds: new Set() });
    try {
      const run = (name: string, input: unknown) => createToolHarness(projectTools.find((tool) => tool.name === name)!, { cwd: dir, session }).run(input);
      const result = await run("delete_page", { pageId: first.pageId }) as { ok: boolean; total: number };
      expect(result.ok).toBe(true);
      expect(result.total).toBe(1);
      const project = await openProject(dir);
      expect(project.pages).toEqual([second.pageId]);
      expect(project.pageMeta[first.pageId]).toBeUndefined();
      await expect(readFile(join(dir, `pages/${first.pageId}.html`), "utf8")).rejects.toThrow();
      await expect(readFile(join(dir, `pages/${first.pageId}.css`), "utf8")).rejects.toThrow();
      expect(events.some((event) => event.type === "forma.page.deleted" && event.data.pageId === first.pageId)).toBe(true);
    } finally {
      projectRuns.delete(session.id);
      setFormaEnv(undefined);
    }
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
      await expect(run("delete_page", { pageId: second.pageId })).rejects.toThrow(/selected page/);
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
      await expect(run("delete_page", { pageId: page.pageId })).rejects.toThrow(/Switch to Build/);
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

describe("brand icon tools", () => {
  interface BrandIconResult {
    results: Array<{ name: string; slug: string; color: string }>;
  }

  it("searches names and slugs case-insensitively, prioritizing exact matches, capped at five", async () => {
    const dir = await makeProject("brand-search");
    const search = async (query: string) =>
      (await createToolHarness(findBrandIcon, { cwd: dir }).run({ query })) as BrandIconResult;
    for (const query of ["GitHub", "github"]) {
      const { results } = await search(query);
      expect(results).toHaveLength(5);
      expect(results[0]).toEqual({ name: "GitHub", slug: "github", color: "#181717" });
      expect(results.every((result) => `${result.name} ${result.slug}`.toLowerCase().includes("github"))).toBe(true);
    }
    const partial = await search("gitla");
    expect(partial.results.every((result) => `${result.name} ${result.slug}`.toLowerCase().includes("gitla"))).toBe(true);
    expect(partial.results.map((result) => result.slug)).toContain("gitlab");
    const capped = await search("cloud");
    expect(capped.results).toHaveLength(5);
    expect(capped.results.every((result) => /^#[0-9a-f]{6}$/i.test(result.color))).toBe(true);
  });

  it("imports a slug as a brand-colored svg context asset", async () => {
    const dir = await makeProject("brand-import");
    const imported = (await createToolHarness(importBrandIcon, { cwd: dir }).run({ slug: "GitHub" })) as {
      contextId: string;
      name: string;
      asset: string;
    };
    expect(imported.asset).toBe(`assets/${imported.contextId}.svg`);
    const svg = await readFile(join(dir, imported.asset), "utf8");
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain('fill="#181717"');
    const item = (await openProject(dir)).context.find((entry) => entry.id === imported.contextId);
    expect(item).toMatchObject({
      name: "GitHub brand icon",
      asset: imported.asset,
      mime: "image/svg+xml",
      role: "optional",
      status: "ready",
    });
    expect(item?.size).toBeGreaterThan(0);
  });

  it("rejects unknown slugs", async () => {
    const dir = await makeProject("brand-unknown");
    await expect(createToolHarness(importBrandIcon, { cwd: dir }).run({ slug: "not-a-brand" })).rejects.toThrow(
      /no brand icon/i,
    );
  });

  it("renders and exports an imported brand icon", async () => {
    const dir = await makeProject("brand-render");
    const imported = (await createToolHarness(importBrandIcon, { cwd: dir }).run({ slug: "github" })) as {
      contextId: string;
      asset: string;
    };
    const page = await writePage(dir, {
      index: 1,
      title: "Brand",
      html: `<img src="../${imported.asset}" alt="GitHub" style="position:absolute;left:480px;top:60px;width:960px;height:960px">`,
      css: "",
    });
    const composed = await composePage(dir, page.pageId, { width: 1920, height: 1080, unit: "px" });
    expect(composed.missing).toEqual([]);
    expect(composed.html).toContain("data:image/svg+xml;base64,");
    const exported = await runExport({
      dir,
      project: await openProject(dir),
      format: "png",
      pageIds: [page.pageId],
      destination: join(root, "brand-icon.png"),
      scale: 1,
    });
    const image = await loadImage(await readFile(exported.files[0]!));
    const context = createCanvas(image.width, image.height).getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let brandPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 24 && pixels[i + 1] === 23 && pixels[i + 2] === 23 && pixels[i + 3] === 255) brandPixels += 1;
    }
    expect(brandPixels).toBeGreaterThan(100);
  }, 120_000);
});

describe("chart tool", () => {
  const barOptions = {
    xAxis: { type: "category", data: ["Q1", "Q2", "Q3", "Q4"] },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: [120, 200, 150, 80], itemStyle: { color: "#8032a8" } }],
  };

  const treemapOptions = {
    series: [
      {
        type: "treemap",
        roam: false,
        data: [
          { name: "Alpha", value: 40, itemStyle: { color: "#8032a8" } },
          {
            name: "Beta",
            value: 30,
            itemStyle: { color: "#ef7866" },
            children: [
              { name: "B1", value: 10, itemStyle: { color: "#ef7866" } },
              { name: "B2", value: 20, itemStyle: { color: "#ef7866" } },
            ],
          },
          { name: "Gamma", value: 30, itemStyle: { color: "#a0e8c4" } },
        ],
      },
    ],
  };

  it("renders a bar chart to an svg context asset with default dimensions", async () => {
    const dir = await makeProject("chart-bar");
    const created = (await createToolHarness(createChart, { cwd: dir }).run({
      name: "Quarterly revenue",
      options: barOptions,
    })) as { contextId: string; name: string; asset: string };
    expect(created.asset).toBe(`assets/${created.contextId}.svg`);
    expect(created.name).toBe("Quarterly revenue");
    const svg = await readFile(join(dir, created.asset), "utf8");
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="800"');
    expect(svg).toContain("#8032a8");
    expect(svg).toContain("Q1");
    expect(svg).toContain("Q4");
    expect(svg).not.toContain("<script");
    const item = (await openProject(dir)).context.find((entry) => entry.id === created.contextId);
    expect(item).toMatchObject({
      name: "Quarterly revenue",
      asset: created.asset,
      mime: "image/svg+xml",
      role: "optional",
      status: "ready",
    });
    expect(item?.size).toBeGreaterThan(0);
  });

  it("renders a treemap with custom dimensions", async () => {
    const dir = await makeProject("chart-treemap");
    const created = (await createToolHarness(createChart, { cwd: dir }).run({
      name: "Category treemap",
      width: 640,
      height: 400,
      options: treemapOptions,
    })) as { contextId: string; asset: string };
    const svg = await readFile(join(dir, created.asset), "utf8");
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain('width="640"');
    expect(svg).toContain('height="400"');
    expect(svg).toContain("Alpha");
    expect(svg).toContain("B1");
    expect(svg).toContain("B2");
  });

  it("rejects invalid dimensions, callbacks, external urls, and unrenderable options", async () => {
    const dir = await makeProject("chart-invalid");
    const harness = createToolHarness(createChart, { cwd: dir });
    await expect(harness.run({ name: "Bad size", width: 0, options: barOptions })).rejects.toThrow();
    await expect(
      harness.run({ name: "Callback", options: { tooltip: { formatter: () => "x" } } }),
    ).rejects.toThrow(/plain JSON|callback/i);
    await expect(
      harness.run({
        name: "External",
        options: { graphic: [{ type: "image", style: { image: "https://example.com/x.png" } }] },
      }),
    ).rejects.toThrow(/external asset/i);
    await expect(
      harness.run({ name: "Unregistered map", options: { series: [{ type: "map", map: "never-registered-map" }] } }),
    ).rejects.toThrow(/could not be rendered/i);
    expect((await openProject(dir)).context).toHaveLength(0);
  });

  it("renders and exports generated charts in a page preview and export", async () => {
    const dir = await makeProject("chart-render");
    const bar = (await createToolHarness(createChart, { cwd: dir }).run({
      name: "Quarterly revenue",
      width: 1200,
      height: 800,
      options: barOptions,
    })) as { contextId: string; asset: string };
    const treemap = (await createToolHarness(createChart, { cwd: dir }).run({
      name: "Category treemap",
      width: 1200,
      height: 800,
      options: treemapOptions,
    })) as { contextId: string; asset: string };
    const page = await writePage(dir, {
      index: 1,
      title: "Charts",
      html: `<img src="../${bar.asset}" alt="Quarterly revenue" style="position:absolute;left:60px;top:60px;width:1200px;height:480px"><img src="../${treemap.asset}" alt="Category treemap" style="position:absolute;left:60px;top:560px;width:1200px;height:460px">`,
      css: "",
    });
    const composed = await composePage(dir, page.pageId, { width: 1920, height: 1080, unit: "px" });
    expect(composed.missing).toEqual([]);
    expect(composed.html).toContain("data:image/svg+xml;base64,");
    const exported = await runExport({
      dir,
      project: await openProject(dir),
      format: "png",
      pageIds: [page.pageId],
      destination: join(root, "chart.png"),
      scale: 1,
    });
    const image = await loadImage(await readFile(exported.files[0]!));
    const context = createCanvas(image.width, image.height).getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let chartPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 128 && pixels[i + 1] === 50 && pixels[i + 2] === 168 && pixels[i + 3] === 255) chartPixels += 1;
    }
    expect(chartPixels).toBeGreaterThan(100);
  }, 120_000);
});

describe("diagram tool", () => {
  const flowchart = "flowchart TD\n  A[Start] --> B{Ready?}\n  B -->|yes| C[Ship]\n  B -->|no| D[Revise]";

  it("renders a flowchart to an svg context asset with mermaid source metadata", async () => {
    const dir = await makeProject("diagram-flow");
    const created = (await createToolHarness(createDiagram, { cwd: dir }).run({
      name: "Order flow",
      mermaid: flowchart,
    })) as { contextId: string; name: string; asset: string; source: string };
    expect(created.asset).toBe(`assets/${created.contextId}.svg`);
    expect(created.source).toBe(`assets/${created.contextId}.mmd`);
    expect(created.name).toBe("Order flow");
    const svg = await readFile(join(dir, created.asset), "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Start");
    expect(svg).toContain("Ship");
    expect(svg).toContain("#2563eb");
    expect(svg).toContain("#172033");
    expect(svg).not.toContain("<script");
    const source = await readFile(join(dir, created.source), "utf8");
    expect(source).toBe(`${flowchart}\n`);
    const item = (await openProject(dir)).context.find((entry) => entry.id === created.contextId);
    expect(item).toMatchObject({
      name: "Order flow",
      asset: created.asset,
      mime: "image/svg+xml",
      role: "optional",
      status: "ready",
    });
    expect(item?.size).toBeGreaterThan(0);
  }, 120_000);

  it("renders a sequence diagram", async () => {
    const dir = await makeProject("diagram-sequence");
    const created = (await createToolHarness(createDiagram, { cwd: dir }).run({
      name: "Handshake",
      mermaid: "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi",
    })) as { asset: string };
    const svg = await readFile(join(dir, created.asset), "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Alice");
    expect(svg).toContain("Bob");
  }, 120_000);

  it("applies the design profile palette and font", async () => {
    const profile = defaultDesignProfile();
    const dir = await makeProject("diagram-theme", {
      designProfile: {
        ...profile,
        colors: { ...profile.colors, accent: "#92344a", text: "#202020", surface: "#eeede8" },
        fonts: { heading: "Georgia", body: "Georgia" },
      },
    });
    const created = (await createToolHarness(createDiagram, { cwd: dir }).run({
      name: "Theme flow",
      mermaid: "flowchart LR\n  A[Alpha] --> B[Beta]",
    })) as { asset: string };
    const svg = await readFile(join(dir, created.asset), "utf8");
    expect(svg).toContain("#92344a");
    expect(svg).toContain("#202020");
    expect(svg.toLowerCase()).toContain("georgia");
  }, 120_000);

  it("rejects invalid Mermaid syntax without creating an asset", async () => {
    const dir = await makeProject("diagram-invalid");
    const harness = createToolHarness(createDiagram, { cwd: dir });
    await expect(harness.run({ name: "Broken", mermaid: "flowchart TD\n  A -->" })).rejects.toThrow(/could not be rendered/i);
    await expect(harness.run({ name: "Unknown type", mermaid: "notamermaid\n  x --> y" })).rejects.toThrow(/could not be rendered/i);
    expect((await openProject(dir)).context).toHaveLength(0);
  }, 120_000);

  it("renders and exports diagrams in a page preview with networking disabled", async () => {
    const profile = defaultDesignProfile();
    const dir = await makeProject("diagram-render", {
      designProfile: {
        ...profile,
        colors: { background: "#12243a", surface: "#203952", text: "#f4f8fc", muted: "#b0c1d3", accent: "#ffbd59" },
      },
    });
    const flow = (await createToolHarness(createDiagram, { cwd: dir }).run({
      name: "Pipeline",
      mermaid: "flowchart LR\n  A[Ingest] --> B[Process] --> C[Publish]",
    })) as { contextId: string; asset: string };
    const sequence = (await createToolHarness(createDiagram, { cwd: dir }).run({
      name: "Handshake",
      mermaid: "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi",
    })) as { contextId: string; asset: string };
    const page = await writePage(dir, {
      index: 1,
      title: "Diagrams",
      html: `<img src="../${flow.asset}" alt="Pipeline" style="position:absolute;left:60px;top:60px;width:1200px;height:460px"><img src="../${sequence.asset}" alt="Handshake" style="position:absolute;left:60px;top:560px;width:1200px;height:460px">`,
      css: "",
    });
    const exported = await withFetchSpy(async () => {
      const composed = await composePage(dir, page.pageId, { width: 1920, height: 1080, unit: "px" });
      expect(composed.missing).toEqual([]);
      expect(composed.html).toContain("data:image/svg+xml;base64,");
      return runExport({
        dir,
        project: await openProject(dir),
        format: "png",
        pageIds: [page.pageId],
        destination: join(root, "diagram.png"),
        scale: 1,
      });
    });
    expect(exported.calls).toBe(0);
    const image = await loadImage(await readFile(exported.result.files[0]!));
    const context = createCanvas(image.width, image.height).getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let diagramPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 32 && pixels[i + 1] === 57 && pixels[i + 2] === 82 && pixels[i + 3] === 255) diagramPixels += 1;
    }
    expect(diagramPixels).toBeGreaterThan(100);
  }, 120_000);
});

describe("Lucide icon tools", () => {
  interface IconSearchResult {
    results: Array<{ name: string; slug: string }>;
  }

  it("searches names and slugs case-insensitively, prioritizing exact matches, capped at five", async () => {
    const dir = await makeProject("icon-search");
    const search = async (query: string) =>
      (await createToolHarness(findIcon, { cwd: dir }).run({ query })) as IconSearchResult;
    for (const query of ["arrow-right", "Arrow Right"]) {
      const { results } = await search(query);
      expect(results[0]).toEqual({ name: "Arrow Right", slug: "arrow-right" });
    }
    const partial = await search("arrow");
    expect(partial.results).toHaveLength(5);
    expect(partial.results.every((result) => result.slug.includes("arrow"))).toBe(true);
    const capped = await search("circle");
    expect(capped.results).toHaveLength(5);
  });

  it("imports a slug as an svg context asset with the requested stroke", async () => {
    const dir = await makeProject("icon-import");
    const imported = (await createToolHarness(importIcon, { cwd: dir }).run({
      slug: "arrow-right",
      color: "#8032a8",
      strokeWidth: 3,
    })) as { contextId: string; name: string; asset: string };
    expect(imported.asset).toBe(`assets/${imported.contextId}.svg`);
    const svg = await readFile(join(dir, imported.asset), "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('stroke="#8032a8"');
    expect(svg).toContain('stroke-width="3"');
    expect(svg).not.toContain("currentColor");
    const item = (await openProject(dir)).context.find((entry) => entry.id === imported.contextId);
    expect(item).toMatchObject({
      name: "Arrow Right icon",
      asset: imported.asset,
      mime: "image/svg+xml",
      role: "optional",
      status: "ready",
    });
    expect(item?.size).toBeGreaterThan(0);
  });

  it("rejects unknown slugs and unsafe colors", async () => {
    const dir = await makeProject("icon-invalid");
    const harness = createToolHarness(importIcon, { cwd: dir });
    await expect(harness.run({ slug: "not-an-icon" })).rejects.toThrow(/no icon/i);
    await expect(harness.run({ slug: "arrow-right", color: 'red"; fill:blue' })).rejects.toThrow();
    await expect(harness.run({ slug: "arrow-right", strokeWidth: 99 })).rejects.toThrow();
    expect((await openProject(dir)).context).toHaveLength(0);
  });

  it("renders and exports an imported icon", async () => {
    const dir = await makeProject("icon-render");
    const imported = (await createToolHarness(importIcon, { cwd: dir }).run({
      slug: "arrow-right",
      color: "#8032a8",
      strokeWidth: 3,
    })) as { contextId: string; asset: string };
    const page = await writePage(dir, {
      index: 1,
      title: "Icon",
      html: `<img src="../${imported.asset}" alt="Arrow right" style="position:absolute;left:200px;top:200px;width:600px;height:600px">`,
      css: "",
    });
    const composed = await composePage(dir, page.pageId, { width: 1920, height: 1080, unit: "px" });
    expect(composed.missing).toEqual([]);
    expect(composed.html).toContain("data:image/svg+xml;base64,");
    const exported = await runExport({
      dir,
      project: await openProject(dir),
      format: "png",
      pageIds: [page.pageId],
      destination: join(root, "icon.png"),
      scale: 1,
    });
    const image = await loadImage(await readFile(exported.files[0]!));
    const context = createCanvas(image.width, image.height).getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let iconPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 128 && pixels[i + 1] === 50 && pixels[i + 2] === 168 && pixels[i + 3] === 255) iconPixels += 1;
    }
    expect(iconPixels).toBeGreaterThan(100);
  }, 120_000);
});

describe("math tool", () => {
  it("renders inline math to static KaTeX HTML", async () => {
    const dir = await makeProject("math-inline");
    const result = (await createToolHarness(renderMath, { cwd: dir }).run({ tex: "\\frac{a}{b}" })) as {
      display: string;
      html: string;
    };
    expect(result.display).toBe("inline");
    expect(result.html).toContain('class="katex"');
    expect(result.html).toContain("<mfrac>");
    expect(result.html).not.toContain("<script");
  });

  it("renders display matrices inside a display wrapper", async () => {
    const dir = await makeProject("math-display");
    const result = (await createToolHarness(renderMath, { cwd: dir }).run({
      tex: "\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}",
      display: "display",
    })) as { html: string };
    expect(result.html).toContain("katex-display");
    expect(result.html).toContain("<mtable");
  });

  it("reports LaTeX parse errors to the agent", async () => {
    const dir = await makeProject("math-invalid");
    await expect(createToolHarness(renderMath, { cwd: dir }).run({ tex: "\\frac{" })).rejects.toThrow(
      /could not be rendered/i,
    );
    await expect(createToolHarness(renderMath, { cwd: dir }).run({ tex: "\\notacommand" })).rejects.toThrow(
      /could not be rendered/i,
    );
  });

  it("composes and exports inline equations, fractions, and matrices without network", async () => {
    const dir = await makeProject("math-render");
    const inline = (await createToolHarness(renderMath, { cwd: dir }).run({ tex: "E = mc^2" })) as { html: string };
    const fraction = (await createToolHarness(renderMath, { cwd: dir }).run({ tex: "\\frac{a}{b}" })) as { html: string };
    const matrix = (await createToolHarness(renderMath, { cwd: dir }).run({
      tex: "\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}",
      display: "display",
    })) as { html: string };
    const page = await writePage(dir, {
      index: 1,
      title: "Math",
      html: `<div style="position:absolute;left:120px;top:120px;width:1600px;font-size:64px">${inline.html} and ${fraction.html}</div><div style="position:absolute;left:120px;top:520px;font-size:64px">${matrix.html}</div>`,
      css: "",
    });
    const { result, calls } = await withFetchSpy(async () => {
      const composed = await composePage(dir, page.pageId, { width: 1920, height: 1080, unit: "px" });
      expect(composed.missing).toEqual([]);
      expect(composed.html).toContain("@font-face");
      expect(composed.html).toContain("data:font/woff2;base64,");
      expect(composed.html).not.toContain("url(fonts/");
      expect(composed.html).toContain("katex-display");
      const preview = await renderArtworkPreview(dir, await openProject(dir), page.pageId);
      expect(preview.issues).toEqual([]);
      expect(preview.data.length).toBeGreaterThan(0);
      return runExport({
        dir,
        project: await openProject(dir),
        format: "png",
        pageIds: [page.pageId],
        destination: join(root, "math.png"),
        scale: 1,
      });
    });
    expect(calls).toBe(0);
    const image = await loadImage(await readFile(result.files[0]!));
    const context = createCanvas(image.width, image.height).getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let darkPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i]! < 200 && pixels[i + 1]! < 200 && pixels[i + 2]! < 200 && pixels[i + 3] === 255) darkPixels += 1;
    }
    expect(darkPixels).toBeGreaterThan(100);
  }, 120_000);
});

describe("lazy tool loading", () => {
  const loadTools = loadToolsTool();
  const deferred: string[] = Object.values(TOOL_GROUPS).flat();
  const allToolNames = [...projectTools, ...researchTools, ...brandTools, ...chartTools, ...diagramTools, ...iconTools, ...mathTools, ...designTools]
    .map((tool) => tool.name)
    .concat("read", "search", "load_tools", "question", "todo");
  const coreNames = allToolNames.filter((name) => !deferred.includes(name));

  function fakeSession(active: string[]) {
    const state = { tools: [] as Array<{ name: string }> };
    const session = {
      setActiveCalls: [] as string[][],
      getActiveToolNames(): string[] {
        return state.tools.map((tool) => tool.name);
      },
      setActiveToolsByName(names: string[]) {
        session.setActiveCalls.push([...names]);
        state.tools = names.filter((name) => allToolNames.includes(name)).map((name) => ({ name }));
      },
      getAllTools(): Array<{ name: string }> {
        return allToolNames.map((name) => ({ name }));
      },
      agent: { state },
    };
    session.setActiveToolsByName(active);
    session.setActiveCalls.length = 0;
    return session;
  }

  it("initializes sessions with the core set plus load_tools", () => {
    const session = fakeSession(allToolNames);
    prepareSessionTools({ id: "init", piSession: session });
    const active = session.getActiveToolNames();
    for (const name of deferred) {
      expect(active).not.toContain(name);
    }
    expect(active).toContain("load_tools");
    expect(active).toContain("read_project");
    expect(active).toContain("question");
    expect(loadedGroupTools("init")).toEqual([]);
  });

  it("activates a group only for the requesting session and ignores repeats", async () => {
    const a = fakeSession(coreNames);
    const b = fakeSession(coreNames);
    prepareSessionTools({ id: "a", piSession: a });
    prepareSessionTools({ id: "b", piSession: b });
    a.agent.state.tools = [...a.agent.state.tools, { name: "view_image" }, { name: "view_artwork" }];
    const harness = createToolHarness(loadTools, { session: { id: "a" } });
    const first = (await harness.run({ group: "research" })) as { group: string; tools: string[]; added: string[] };
    expect(first).toEqual({ group: "research", tools: ["research", "read_url"], added: ["research", "read_url"] });
    const active = a.getActiveToolNames();
    expect(active).toContain("research");
    expect(active).toContain("read_url");
    expect(active).toContain("view_image");
    expect(active).toContain("view_artwork");
    expect(b.getActiveToolNames()).not.toContain("research");

    const calls = a.setActiveCalls.length;
    const repeat = (await harness.run({ group: "research" })) as { added: string[] };
    expect(repeat).toEqual({ group: "research", tools: ["research", "read_url"], added: [] });
    expect(a.setActiveCalls.length).toBe(calls);
    expect(a.getActiveToolNames().filter((name) => name === "research")).toHaveLength(1);

    await createToolHarness(loadTools, { session: { id: "b" } }).run({ group: "brands" });
    expect(b.getActiveToolNames()).toContain("find_brand_icon");
    expect(a.getActiveToolNames()).not.toContain("find_brand_icon");
  });

  it("activates the icon and math groups", async () => {
    const session = fakeSession(coreNames);
    prepareSessionTools({ id: "specialist", piSession: session });
    const harness = createToolHarness(loadTools, { session: { id: "specialist" } });
    const icons = (await harness.run({ group: "icons" })) as { group: string; tools: string[]; added: string[] };
    expect(icons).toEqual({ group: "icons", tools: ["find_icon", "import_icon"], added: ["find_icon", "import_icon"] });
    const math = (await harness.run({ group: "math" })) as { group: string; tools: string[]; added: string[] };
    expect(math).toEqual({ group: "math", tools: ["render_math"], added: ["render_math"] });
    const diagrams = (await harness.run({ group: "diagrams" })) as { group: string; tools: string[]; added: string[] };
    expect(diagrams).toEqual({ group: "diagrams", tools: ["create_diagram"], added: ["create_diagram"] });
    expect(session.getActiveToolNames()).toEqual(expect.arrayContaining(["find_icon", "import_icon", "render_math", "create_diagram"]));
  });

  it("keeps loaded groups available for artwork cleanup to restore", async () => {
    const session = fakeSession(coreNames);
    prepareSessionTools({ id: "cleanup", piSession: session });
    await createToolHarness(loadTools, { session: { id: "cleanup" } }).run({ group: "photos" });
    expect(loadedGroupTools("cleanup")).toEqual(["find_photos", "import_photo"]);
    expect(loadedGroupTools("unknown")).toEqual([]);
  });

  it("rejects unknown groups and sessions without tool loading", async () => {
    await expect(createToolHarness(loadTools, { session: { id: "ghost" } }).run({ group: "research" })).rejects.toThrow(/unavailable/i);
    const session = fakeSession(coreNames);
    prepareSessionTools({ id: "bad-group", piSession: session });
    await expect(createToolHarness(loadTools, { session: { id: "bad-group" } }).run({ group: "nope" })).rejects.toThrow();
    expect(session.getActiveToolNames()).toEqual(coreNames);
  });
});
