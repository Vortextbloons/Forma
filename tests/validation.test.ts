import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateProject } from "../src/rendering/validate.ts";
import { createProject, importContextAsset, importContextNote, openProject, setOutline } from "../src/projects/store.ts";
import { updatePage, writePage } from "../src/projects/pages.ts";
import { scheduleExtraction } from "../src/extraction/index.ts";
import { defaultSettings } from "../src/projects/schema.ts";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forma-validate-"));
  process.env.FORMA_DATA_DIR = join(root, "data");
});

afterAll(async () => {
  delete process.env.FORMA_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

async function makeProject(name: string): Promise<string> {
  const dir = join(root, name);
  await createProject({
    dir,
    name,
    prompt: "",
    mode: "plan",
    settings: defaultSettings("slides"),
  });
  return dir;
}

describe("artwork validation", () => {
  it("requires visible required images instead of outline or metadata assignments", async () => {
    const dir = await makeProject("visible-required-image");
    const { item } = await importContextAsset(dir, { name: "Required image", extension: ".png", mime: "image/png", data: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"), role: "must-include" });
    await setOutline(dir, [{ title: "One", points: [], assetIds: [item.id] }]);
    const { pageId } = await writePage(dir, { index: 1, title: "One", html: "<p>No image</p>", css: "", assets: [item.id] });
    expect((await validateProject(dir, await openProject(dir))).issues.some((issue) => issue.kind === "must-include")).toBe(true);
    await updatePage(dir, pageId, { html: `<img src="${item.asset}" style="width:100px;height:100px">` });
    expect((await validateProject(dir, await openProject(dir))).issues).toEqual([]);
    await updatePage(dir, pageId, { css: ".forma-page img{display:none}" });
    expect((await validateProject(dir, await openProject(dir))).issues.some((issue) => issue.kind === "must-include")).toBe(true);
  }, 60_000);

  it("checks required text evidence against both its source and rendered content", async () => {
    const dir = await makeProject("required-text-evidence");
    const { item } = await importContextNote(dir, "Revenue grew by 25 percent.", "must-include", "Required fact");
    await scheduleExtraction(dir, item.id);
    const { pageId } = await writePage(dir, { index: 1, title: "One", html: "<p>Revenue grew by 25 percent.</p>", css: "", assets: [item.id], evidence: { [item.id]: "Revenue grew by 25 percent." } });
    expect((await validateProject(dir, await openProject(dir))).issues).toEqual([]);
    await updatePage(dir, pageId, { html: "<p>Revenue grew by 50 percent.</p>" });
    expect((await validateProject(dir, await openProject(dir))).issues.some((issue) => issue.kind === "must-include")).toBe(true);
  }, 60_000);

  it("reports unmet Must Include requirements", async () => {
    const dir = await makeProject("must-include");
    await importContextNote(dir, "Required fact", "must-include", "Required note");
    const project = await openProject(dir);
    const report = await validateProject(dir, project);
    expect(report.issues.some((issue) => issue.kind === "must-include")).toBe(true);
  }, 60_000);

  it("reports missing assets per slide", async () => {
    const dir = await makeProject("missing-assets");
    await writePage(dir, {
      index: 1,
      title: "Broken",
      html: '<img src="assets/ctx_missing.png" alt=""><p>text</p>',
      css: ".missing { background: url(assets/ctx_gone.svg); }",
    });
    const project = await openProject(dir);
    const report = await validateProject(dir, project);
    const missing = report.issues.filter((issue) => issue.kind === "missing-asset");
    expect(missing).toHaveLength(2);
    expect(missing.every((issue) => issue.pageId === project.pages[0])).toBe(true);
  }, 90_000);

  it("reports page-boundary overflow and clipped text", async () => {
    const dir = await makeProject("overflow");
    await writePage(dir, {
      index: 1,
      title: "Overflowing",
      html: [
        '<div style="height:3000px;width:4000px">beyond the page</div>',
        '<div style="height:60px;overflow:hidden">',
        "A very long paragraph that cannot possibly fit inside sixty pixels of height, ".repeat(8),
        "</div>",
      ].join(""),
      css: "",
    });
    const project = await openProject(dir);
    const report = await validateProject(dir, project);
    expect(report.renderError, report.renderError).toBeUndefined();
    expect(report.issues.some((issue) => issue.kind === "overflow")).toBe(true);
    expect(report.issues.some((issue) => issue.kind === "clipped-text")).toBe(true);
  }, 120_000);
});
