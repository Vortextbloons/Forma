import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
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
  updatePage,
  writePage,
} from "../src/projects/pages.ts";
import { resolveProjectsHome } from "../src/projects/home.ts";
import { defaultSettings } from "../src/projects/schema.ts";
import { repairSessionIndex } from "../src/projects/sessions.ts";
import { collectVisualReferences } from "../src/forma/visuals.ts";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "forma-projects-"));
}

async function useDataDir(): Promise<string> {
  const root = await tempDir();
  process.env.FORMA_DATA_DIR = root;
  return root;
}

describe("project persistence", () => {
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
      expect(await collectVisualReferences(dir, project)).toEqual([{ data: png, mediaType: "image/png" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
