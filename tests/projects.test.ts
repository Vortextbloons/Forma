import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProject,
  importContextFile,
  openProject,
  projectFilePath,
  removeContextItem,
  updateContextItem,
  updateProject,
} from "../src/projects/store.ts";
import { defaultSettings } from "../src/projects/schema.ts";
import { repairSessionIndex } from "../src/projects/sessions.ts";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "forma-projects-"));
}

describe("project persistence", () => {
  it("creates a project folder with project.json, pages/ and assets/", async () => {
    const root = await tempDir();
    const dir = join(root, "Deck");
    const project = await createProject({
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
