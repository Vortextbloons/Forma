import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  contextAssetFormat,
  createProject,
  deleteProject,
  duplicateProject,
  importContextFile,
  listProjects,
  openProject,
  projectFilePath,
  removeContextItem,
  renameProject,
  setOutline,
  updateContextItem,
  updateProject,
} from "../src/projects/store.ts";
import {
  deletePage,
  duplicatePage,
  movePage,
  readPage,
  restorePage,
  updatePage,
  writePage,
} from "../src/projects/pages.ts";
import { resolveProjectsHome } from "../src/projects/home.ts";
import { defaultSettings } from "../src/projects/schema.ts";
import { repairSessionIndex } from "../src/projects/sessions.ts";
import { collectVisualReferences } from "../src/forma/visuals.ts";
import { listThemes, saveTheme } from "../src/projects/themes.ts";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "forma-projects-"));
}

async function useDataDir(): Promise<string> {
  const root = await tempDir();
  process.env.FORMA_DATA_DIR = root;
  return root;
}

describe("project persistence", () => {
  it("persists reusable themes independently of project edits and excludes content and page settings", async () => {
    const root = await tempDir();
    const previousDataDir = process.env.FORMA_DATA_DIR;
    process.env.FORMA_DATA_DIR = root;
    try {
      expect(await listThemes()).toEqual([]);
      const settings = defaultSettings();
      settings.style = "editorial";
      settings.density = "concise";
      settings.designProfile!.colors.accent = "#ca2468";
      settings.designProfile!.colors.coral = "#ef7866";
      settings.designProfile!.fonts.heading = "Georgia";
      settings.designProfile!.fonts.utility = "Consolas";
      settings.designProfile!.direction = "Strong headlines and spacious layouts";
      const theme = await saveTheme("Studio", settings);
      settings.designProfile!.colors.accent = "#112233";
      const [saved] = await listThemes();
      expect(saved).toEqual(theme);
      expect(saved!.designProfile.colors.accent).toBe("#ca2468");
      expect(saved).not.toHaveProperty("slideCount");
      expect(saved).not.toHaveProperty("research");
      const targetSettings = defaultSettings("poster");
      const target = await createProject({ dir: join(root, "Target"), name: "Target", prompt: "Keep the brief", mode: "plan", settings: { ...targetSettings, style: saved!.style, density: saved!.density, designProfile: saved!.designProfile } });
      const reopened = await openProject(target.dir);
      expect(reopened.settings.designProfile).toEqual(theme.designProfile);
      expect(reopened.settings.output).toBe("poster");
      expect(reopened.prompt).toBe("Keep the brief");
      await updateProject(target.dir, (project) => { project.settings.designProfile!.fonts.heading = "Arial"; });
      expect((await listThemes())[0]!.designProfile.fonts.heading).toBe("Georgia");
    } finally {
      if (previousDataDir === undefined) delete process.env.FORMA_DATA_DIR;
      else process.env.FORMA_DATA_DIR = previousDataDir;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies precise edits and restores source and metadata without damaging other content", async () => {
    const root = await tempDir();
    try {
      const { dir } = await createProject({ dir: join(root, "Edits"), name: "Edits", prompt: "", mode: "create", settings: defaultSettings() });
      const { pageId } = await writePage(dir, { index: 1, title: "Original", html: "<h1>Original</h1><p>Keep this</p>", css: "h1{color:red}" });
      await updatePage(dir, pageId, { title: "Edited", htmlEdits: [{ find: "<h1>Original</h1>", replace: "<h1>Edited</h1>" }], cssEdits: [{ find: "red", replace: "blue" }] });
      expect(await readPage(dir, pageId)).toEqual({ html: "<h1>Edited</h1><p>Keep this</p>\n", css: "h1{color:blue}\n" });
      await expect(updatePage(dir, pageId, { htmlEdits: [{ find: "missing", replace: "bad" }] })).rejects.toThrow(/exactly once/);
      await expect(updatePage(dir, pageId, { html: "<p>overwrite</p>", htmlEdits: [{ find: "overwrite", replace: "bad" }] })).rejects.toThrow(/not both/);
      await restorePage(dir, pageId);
      expect((await readPage(dir, pageId)).html).toBe("<h1>Original</h1><p>Keep this</p>\n");
      expect((await openProject(dir)).pageMeta[pageId]?.title).toBe("Original");
      await restorePage(dir, pageId);
      expect((await readPage(dir, pageId)).css).toBe("h1{color:blue}\n");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("creates a project folder with project.json, pages/ and assets/", async () => {
    const root = await tempDir();
    const dir = join(root, "Deck");
    const { project } = await createProject({
      dir,
      name: "Deck",
      prompt: "A deck about persistence",
      mode: "plan",
      settings: defaultSettings("slides"),
    });

    expect(project.formatVersion).toBe(1);
    expect(project.name).toBe("Deck");
    expect(project.outline).toBeNull();
    expect(project.pages).toEqual([]);
    expect((await stat(join(dir, "pages"))).isDirectory()).toBe(true);
    expect((await stat(join(dir, "assets"))).isDirectory()).toBe(true);

    const reopened = await openProject(dir);
    expect(reopened.id).toBe(project.id);
    expect(reopened.settings.slideCount).toBe(8);
    await rm(projectFilePath(dir));
    await expect(openProject(dir)).rejects.toMatchObject({
      details: { dir, reason: "project-not-found" },
    });
    await rm(root, { recursive: true, force: true });
  });

  it("seeds a new project with the caller's model preferences", async () => {
    const root = await tempDir();
    const seeded = await createProject({
      dir: join(root, "Seeded"),
      name: "Seeded",
      prompt: "",
      mode: "plan",
      settings: defaultSettings(),
      preferences: { model: "openai/gpt-5", thinkingLevel: "high" },
    });
    expect(seeded.project.preferences).toEqual({ model: "openai/gpt-5", thinkingLevel: "high", zoom: "fit" });
    expect((await openProject(seeded.dir)).preferences).toEqual(seeded.project.preferences);

    const unseeded = await createProject({
      dir: join(root, "Unseeded"),
      name: "Unseeded",
      prompt: "",
      mode: "plan",
      settings: defaultSettings(),
    });
    expect(unseeded.project.preferences).toEqual({ model: "auto", thinkingLevel: "medium", zoom: "fit" });
    await rm(root, { recursive: true, force: true });
  });

  it("keeps saved chat preferences and defaults projects saved before they existed", async () => {
    const root = await tempDir();
    const dir = join(root, "Preferences");
    await createProject({ dir, name: "Preferences", prompt: "", mode: "plan", settings: defaultSettings() });

    await updateProject(dir, (project) => {
      project.preferences = { model: "openai/gpt-5", thinkingLevel: "high", zoom: 150 };
    });
    expect((await openProject(dir)).preferences).toEqual({ model: "openai/gpt-5", thinkingLevel: "high", zoom: 150 });

    const legacy = JSON.parse(await readFile(projectFilePath(dir), "utf8"));
    delete legacy.preferences;
    await writeFile(projectFilePath(dir), JSON.stringify(legacy));
    expect((await openProject(dir)).preferences).toEqual({ model: "auto", thinkingLevel: "medium", zoom: "fit" });
    await rm(root, { recursive: true, force: true });
  });

  it("refuses to create a second project in the same folder", async () => {
    const root = await tempDir();
    const dir = join(root, "Deck");
    await createProject({
      dir,
      name: "Deck",
      prompt: "first",
      mode: "plan",
      settings: defaultSettings("slides"),
    });
    await expect(
      createProject({
        dir,
        name: "Deck again",
        prompt: "second",
        mode: "plan",
        settings: defaultSettings("slides"),
      }),
    ).rejects.toThrow(/already exists/i);
    await rm(root, { recursive: true, force: true });
  });

  it("leaves the existing file untouched when an update fails", async () => {
    const root = await tempDir();
    const dir = join(root, "Deck");
    await createProject({
      dir,
      name: "Deck",
      prompt: "atomic",
      mode: "plan",
      settings: defaultSettings("slides"),
    });
    const before = await readFile(projectFilePath(dir), "utf8");
    await expect(
      updateProject(dir, () => {
        throw new Error("mutation failed");
      }),
    ).rejects.toThrow("mutation failed");
    const after = await readFile(projectFilePath(dir), "utf8");
    expect(after).toBe(before);
    await rm(root, { recursive: true, force: true });
  });

  it("imports, updates and removes context files", async () => {
    const root = await tempDir();
    const dir = join(root, "Deck");
    await createProject({
      dir,
      name: "Deck",
      prompt: "context",
      mode: "plan",
      settings: defaultSettings("slides"),
    });
    const source = join(root, "notes.txt");
    await writeFile(source, "facts for the deck", "utf8");

    const { project, item } = await importContextFile(dir, source, "content-source");
    expect(item.role).toBe("content-source");
    expect(item.mime).toBe("text/plain");
    expect(project.context).toHaveLength(1);
    const assetPath = join(dir, item.asset);
    expect((await stat(assetPath)).isFile()).toBe(true);

    const renamed = await updateContextItem(dir, item.id, {
      name: "Renamed notes",
      role: "must-include",
    });
    expect(renamed.context[0]?.name).toBe("Renamed notes");
    expect(renamed.context[0]?.role).toBe("must-include");

    const removed = await removeContextItem(dir, item.id);
    expect(removed.context).toHaveLength(0);
    await expect(stat(assetPath)).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });

  it("makes ordinary uploaded images available to the AI alongside reference information", async () => {
    const root = await tempDir();
    try {
      const { dir } = await createProject({
        dir: join(root, "References"),
        name: "References",
        prompt: "Use the supplied material",
        mode: "create",
        settings: defaultSettings("slides"),
      });
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
      const imagePath = join(root, "image.png");
      const textPath = join(root, "facts.txt");
      await writeFile(imagePath, Buffer.from(png, "base64"));
      await writeFile(textPath, "Background information");
      await importContextFile(dir, imagePath, "optional");
      const { project } = await importContextFile(dir, textPath, "content-source");
      expect(project.context).toHaveLength(2);
      const references = await collectVisualReferences(dir, project);
      expect(references.images).toEqual([{ data: png, mediaType: "image/png" }]);
      expect(references.labels).toEqual([{ id: project.context[0]!.id, name: project.context[0]!.name, role: "optional", path: project.context[0]!.asset }]);
      expect(references.skipped).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prioritizes selected-page references and reports references beyond the attachment limit", async () => {
    const root = await tempDir();
    try {
      const { dir } = await createProject({ dir: join(root, "Many references"), name: "Many references", prompt: "", mode: "create", settings: defaultSettings() });
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
      for (let index = 0; index < 7; index++) {
        const path = join(root, `image-${index}.png`);
        await writeFile(path, index === 6 ? Buffer.concat([png, Buffer.alloc(6 * 1024 * 1024)]) : png);
        await importContextFile(dir, path, "optional");
      }
      const project = await openProject(dir);
      const selected = project.context[6]!;
      const { pageId } = await writePage(dir, { index: 1, title: "One", html: `<img src="${selected.asset}">`, css: "", assets: [selected.id] });
      const references = await collectVisualReferences(dir, await openProject(dir), pageId);
      expect(references.images).toHaveLength(6);
      expect(references.labels[0]?.id).toBe(selected.id);
      expect(references.images[0]?.mediaType).toBe("image/webp");
      expect(references.skipped).toHaveLength(1);
      expect(references.skipped[0]?.reason).toContain("view_image");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects unsupported context file types", async () => {
    const root = await tempDir();
    const dir = join(root, "Deck");
    await createProject({
      dir,
      name: "Deck",
      prompt: "context",
      mode: "plan",
      settings: defaultSettings("slides"),
    });
    const source = join(root, "evil.exe");
    await writeFile(source, "binary", "utf8");
    await expect(importContextFile(dir, source, "optional")).rejects.toThrow(/unsupported/i);
    await rm(root, { recursive: true, force: true });
  });

  it("resolves dropped context assets from their mime type or file name", () => {
    expect(contextAssetFormat("photo.png", "application/octet-stream")).toEqual({
      extension: ".png",
      mime: "image/png",
    });
    expect(contextAssetFormat("", "image/jpeg; charset=binary")).toEqual({
      extension: ".jpg",
      mime: "image/jpeg",
    });
    expect(contextAssetFormat("https://example.com/image", "image/webp")).toEqual({
      extension: ".webp",
      mime: "image/webp",
    });
    expect(contextAssetFormat("facts.md", "")).toEqual({ extension: ".md", mime: "text/markdown" });
    expect(() => contextAssetFormat("page.html", "text/html")).toThrow(/unsupported/i);
  });

  it("repairs session index paths after the project folder moves", async () => {
    const root = await tempDir();
    const original = join(root, "Original");
    const moved = join(root, "Moved");
    await createProject({
      dir: original,
      name: "Deck",
      prompt: "move me",
      mode: "plan",
      settings: defaultSettings("slides"),
    });
    const sessionId = "rig_abcdef123456";
    await mkdir(join(original, ".rig", "sessions"), { recursive: true });
    await mkdir(join(original, ".rig", "state"), { recursive: true });
    const sessionFile = join(original, ".rig", "sessions", `${sessionId}.jsonl`);
    await writeFile(sessionFile, '{"type":"session","version":1,"id":"rig_abcdef123456"}\n', "utf8");
    const index = {
      version: 1,
      sessions: {
        [sessionId]: {
          rigId: sessionId,
          name: "Project chat",
          sessionFile,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          status: "idle",
        },
      },
    };
    await writeFile(join(original, ".rig", "state", "sessions.json"), JSON.stringify(index), "utf8");

    await rename(original, moved);
    const repaired = await repairSessionIndex(moved);
    expect(repaired).toBe(true);
    const rewritten = JSON.parse(
      await readFile(join(moved, ".rig", "state", "sessions.json"), "utf8"),
    ) as { sessions: Record<string, { sessionFile: string }> };
    expect(rewritten.sessions[sessionId]?.sessionFile).toBe(
      join(moved, ".rig", "sessions", `${sessionId}.jsonl`),
    );
    await rm(root, { recursive: true, force: true });
  });
});

describe("project library", () => {
  it("creates projects under the projects home when no dir is given", async () => {
    const root = await useDataDir();
    try {
      const { dir, project } = await createProject({
        name: "Library deck",
        prompt: "Store me in the library",
        mode: "plan",
        settings: defaultSettings("slides"),
      });
      expect(resolveProjectsHome()).toBe(join(root, "projects"));
      expect(dir).toBe(join(resolveProjectsHome(), project.id));
      expect(basename(dir)).toBe(project.id);
      expect((await stat(projectFilePath(dir))).isFile()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
      delete process.env.FORMA_DATA_DIR;
    }
  });

  it("lists library projects newest first and skips non-project folders", async () => {
    const root = await useDataDir();
    try {
      const first = await createProject({
        name: "First",
        prompt: "first",
        mode: "plan",
        settings: defaultSettings("slides"),
      });
      const second = await createProject({
        name: "Second",
        prompt: "second",
        mode: "plan",
        settings: defaultSettings("slides"),
      });
      await mkdir(join(resolveProjectsHome(), "not-a-project"));
      await updateProject(first.dir, () => undefined);

      const { home, projects } = await listProjects();
      expect(home).toBe(resolveProjectsHome());
      expect(projects.map((entry) => entry.dir)).toEqual([first.dir, second.dir]);
    } finally {
      await rm(root, { recursive: true, force: true });
      delete process.env.FORMA_DATA_DIR;
    }
  });

  it("renames a project on disk", async () => {
    const root = await useDataDir();
    try {
      const created = await createProject({
        name: "Before",
        prompt: "rename me",
        mode: "plan",
        settings: defaultSettings("slides"),
      });
      const renamed = await renameProject(created.dir, "  After  ");
      expect(renamed.name).toBe("After");
      const reopened = await openProject(created.dir);
      expect(reopened.name).toBe("After");
      await expect(renameProject(created.dir, "   ")).rejects.toThrow(/empty/i);
    } finally {
      await rm(root, { recursive: true, force: true });
      delete process.env.FORMA_DATA_DIR;
    }
  });

  it("duplicates artwork and assets but starts a fresh conversation", async () => {
    const root = await useDataDir();
    try {
      const source = await createProject({
        name: "Source",
        prompt: "duplicate me",
        mode: "plan",
        settings: defaultSettings("slides"),
      });
      await writeFile(join(source.dir, "pages", "slide-01.svg"), "<svg/>", "utf8");
      const notes = join(root, "notes.txt");
      await writeFile(notes, "facts for the deck", "utf8");
      const { item } = await importContextFile(source.dir, notes, "content-source");
      const sessionId = "rig_abcdef123456";
      await mkdir(join(source.dir, ".rig", "sessions"), { recursive: true });
      await writeFile(join(source.dir, ".rig", "sessions", `${sessionId}.jsonl`), "{}\n", "utf8");
      await updateProject(source.dir, (project) => {
        project.conversation.sessionIds = [sessionId];
      });

      const copy = await duplicateProject(source.dir);

      expect(copy.dir).not.toBe(source.dir);
      expect(basename(copy.dir)).toBe(copy.project.id);
      expect(copy.project.id).not.toBe(source.project.id);
      expect(copy.project.name).toBe("Source copy");
      expect(copy.project.conversation.sessionIds).toEqual([]);
      expect((await stat(join(copy.dir, "pages", "slide-01.svg"))).isFile()).toBe(true);
      expect((await stat(join(copy.dir, item.asset))).isFile()).toBe(true);
      expect(copy.project.context).toHaveLength(1);
      await expect(stat(join(copy.dir, ".rig"))).rejects.toThrow();

      const reopenedCopy = await openProject(copy.dir);
      expect(reopenedCopy.conversation.sessionIds).toEqual([]);
      const reopenedSource = await openProject(source.dir);
      expect(reopenedSource.conversation.sessionIds).toEqual([sessionId]);

      const custom = await duplicateProject(source.dir, "Custom name");
      expect(custom.project.name).toBe("Custom name");
    } finally {
      await rm(root, { recursive: true, force: true });
      delete process.env.FORMA_DATA_DIR;
    }
  });

  it("deletes only the intended project and refuses folders outside the library", async () => {
    const root = await useDataDir();
    try {
      const kept = await createProject({
        name: "Kept",
        prompt: "keep me",
        mode: "plan",
        settings: defaultSettings("slides"),
      });
      const removed = await createProject({
        name: "Removed",
        prompt: "remove me",
        mode: "plan",
        settings: defaultSettings("slides"),
      });

      const deleted = await deleteProject(removed.dir);
      expect(deleted).toBe(removed.dir);
      await expect(stat(removed.dir)).rejects.toThrow();
      const stillThere = await openProject(kept.dir);
      expect(stillThere.id).toBe(kept.project.id);

      const external = join(root, "External");
      await createProject({
        dir: external,
        name: "External",
        prompt: "outside the library",
        mode: "plan",
        settings: defaultSettings("slides"),
      });
      await expect(deleteProject(external)).rejects.toThrow(/not a Forma-managed project/i);
      expect((await stat(projectFilePath(external))).isFile()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
      delete process.env.FORMA_DATA_DIR;
    }
  });
});

describe("page persistence", () => {
  it("writes, edits, reorders, duplicates and deletes pages", async () => {
    const root = await tempDir();
    try {
      const created = await createProject({
        dir: join(root, "Deck"),
        name: "Deck",
        prompt: "pages",
        mode: "plan",
        settings: defaultSettings("slides"),
      });
      const dir = created.dir;
      const outline = await setOutline(dir, [
        { title: "One", points: ["a"] },
        { title: "Two", points: ["b"] },
      ]);
      const ids = outline.outline!.map((entry) => entry.id);

      const first = await writePage(dir, {
        index: 1,
        title: "One",
        html: "<div>one</div>",
        css: ".one{}",
      });
      expect(first.pageId).toBe(ids[0]);
      await writePage(dir, { index: 2, title: "Two", html: "<div>two</div>", css: "" });

      let project = await openProject(dir);
      expect(project.pages).toEqual(ids);
      expect(project.pageMeta[ids[0]!]?.title).toBe("One");
      expect((await readPage(dir, ids[0]!)).html.trim()).toBe("<div>one</div>");

      await updatePage(dir, ids[0]!, { html: "<div>one updated</div>" });
      expect((await readPage(dir, ids[0]!)).html.trim()).toBe("<div>one updated</div>");

      await movePage(dir, ids[0]!, 2);
      project = await openProject(dir);
      expect(project.pages).toEqual([ids[1], ids[0]]);

      const copy = await duplicatePage(dir, ids[1]!);
      project = await openProject(dir);
      expect(project.pages).toEqual([ids[1], copy.pageId, ids[0]]);
      expect((await readPage(dir, copy.pageId)).html.trim()).toBe("<div>two</div>");

      await deletePage(dir, copy.pageId);
      project = await openProject(dir);
      expect(project.pages).toEqual([ids[1], ids[0]]);
      await expect(stat(join(dir, "pages", `${copy.pageId}.html`))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses out-of-order pages and scripts in artwork", async () => {
    const root = await tempDir();
    try {
      const created = await createProject({
        dir: join(root, "Guards"),
        name: "Guards",
        prompt: "guards",
        mode: "create",
        settings: defaultSettings("slides"),
      });
      const dir = created.dir;
      await expect(
        writePage(dir, { index: 3, title: "Hole", html: "<div/>", css: "" }),
      ).rejects.toThrow(/out of order/i);
      await expect(
        writePage(dir, { index: 1, title: "Script", html: "<script>alert(1)</script>", css: "" }),
      ).rejects.toThrow(/script/i);
      const project = await openProject(dir);
      expect(project.pages).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows slides beyond the saved count when there is no outline", async () => {
    const root = await tempDir();
    try {
      const created = await createProject({
        dir: join(root, "Automatic count"),
        name: "Automatic count",
        prompt: "Choose the presentation length",
        mode: "create",
        settings: { ...defaultSettings("slides"), slideCount: 1 },
      });
      await writePage(created.dir, { index: 1, title: "One", html: "<h1>One</h1>", css: "" });
      await writePage(created.dir, { index: 2, title: "Two", html: "<h1>Two</h1>", css: "" });
      expect((await openProject(created.dir)).pages).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("validates outline asset assignments against context", async () => {
    const root = await tempDir();
    try {
      const created = await createProject({
        dir: join(root, "Outline"),
        name: "Outline",
        prompt: "outline",
        mode: "plan",
        settings: defaultSettings("slides"),
      });
      await expect(
        setOutline(created.dir, [{ title: "One", points: [], assetIds: ["ctx_nope"] }]),
      ).rejects.toThrow(/Unknown asset/i);
      const project = await openProject(created.dir);
      expect(project.outline).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
