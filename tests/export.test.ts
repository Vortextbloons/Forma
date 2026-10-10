import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CancellationError } from "rig";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { runExport } from "../src/rendering/export.ts";
import { createExportHandlers } from "../src/worker/exports.ts";
import { FORMA_EVENTS } from "../src/forma/events.ts";
import { createProject, openProject, updateProject } from "../src/projects/store.ts";
import { readPage, updatePage, writePage } from "../src/projects/pages.ts";
import { defaultSettings } from "../src/projects/schema.ts";
import type { WorkerContext } from "../src/worker/commands.ts";
import { composePage } from "../src/rendering/compose.ts";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forma-export-"));
  process.env.FORMA_DATA_DIR = join(root, "data");
});

afterAll(async () => {
  delete process.env.FORMA_DATA_DIR;
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

async function deck(): Promise<{ dir: string; pages: string[] }> {
  const dir = join(root, `deck-${Math.random().toString(36).slice(2, 8)}`);
  await createProject({
    dir,
    name: "Deck",
    prompt: "",
    mode: "create",
    settings: defaultSettings("slides"),
  });
  await updateProject(dir, (project) => {
    project.settings.slideCount = 2;
  });
  const first = await writePage(dir, {
    index: 1,
    title: "One",
    html: '<div style="position:absolute;inset:0;background:#ff0000"></div>',
    css: "",
  });
  const second = await writePage(dir, {
    index: 2,
    title: "Two",
    html: '<div style="position:absolute;inset:0;background:#0000ff"></div>',
    css: "",
  });
  return { dir, pages: [first.pageId, second.pageId] };
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function centerColor(buffer: Buffer): Promise<[number, number, number]> {
  const image = await loadImage(buffer);
  const canvas = createCanvas(1, 1);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}

describe("forma exports", () => {
  it("shares profile changes across composed pages and PNG exports without rewriting artwork", async () => {
    const { dir, pages } = await deck();
    for (const pageId of pages) {
      await updatePage(dir, pageId, { html: '<div class="fill"></div>', css: ".fill{position:absolute;inset:0;background:var(--forma-accent)}" });
    }
    const source = await readPage(dir, pages[0]!);
    await updateProject(dir, (project) => {
      project.settings.designProfile!.colors.accent = "#cc2266";
      project.settings.designProfile!.fonts.heading = "Georgia";
    });
    for (const pageId of pages) {
      const composed = await composePage(dir, pageId, { width: 1920, height: 1080, unit: "px" });
      expect(composed.html).toContain('--forma-font-heading: "Georgia", serif');
      expect(composed.html).toContain("--forma-accent: #cc2266");
    }
    const first = await runExport({ dir, project: await openProject(dir), format: "png", pageIds: [pages[0]!], destination: join(root, "theme-before.png") });
    expect(await centerColor(await readFile(first.files[0]!))).toEqual([204, 34, 102]);
    await updateProject(dir, (project) => { project.settings.designProfile!.colors.accent = "#2266cc"; });
    const second = await runExport({ dir, project: await openProject(dir), format: "png", pageIds: [pages[1]!], destination: join(root, "theme-after.png") });
    expect(await centerColor(await readFile(second.files[0]!))).toEqual([34, 102, 204]);
    expect(await readPage(dir, pages[0]!)).toEqual(source);
    const print = await composePage(dir, pages[0]!, { width: 210, height: 297, unit: "mm" });
    expect(print.html).toContain("--forma-heading-size: 7.875mm");
  }, 120_000);

  it("exports a PDF with one page per slide at the project dimensions", async () => {
    const { dir, pages } = await deck();
    const result = await runExport({
      dir,
      project: await openProject(dir),
      format: "pdf",
      pageIds: pages,
      destination: join(root, "deck.pdf"),
    });
    const document = await PDFDocument.load(await readFile(result.files[0]!));
    expect(document.getPageCount()).toBe(2);
    for (const page of document.getPages()) {
      expect(page.getWidth()).toBeCloseTo((1920 * 72) / 96, 1);
      expect(page.getHeight()).toBeCloseTo((1080 * 72) / 96, 1);
    }
  }, 120_000);

  it("exports slide PNGs at 1x and 2x with the expected pixel dimensions", async () => {
    const { dir, pages } = await deck();
    const project = await openProject(dir);
    const single = await runExport({
      dir,
      project,
      format: "png",
      pageIds: [pages[0]!],
      destination: join(root, "slide.png"),
      scale: 1,
    });
    expect(pngSize(await readFile(single.files[0]!))).toEqual({ width: 1920, height: 1080 });
    const doubled = await runExport({
      dir,
      project,
      format: "png",
      pageIds: [pages[0]!],
      destination: join(root, "slide@2x.png"),
      scale: 2,
    });
    expect(pngSize(await readFile(doubled.files[0]!))).toEqual({ width: 3840, height: 2160 });
  }, 120_000);

  it("exports all slides to a folder as ordered PNG files", async () => {
    const { dir, pages } = await deck();
    const result = await runExport({
      dir,
      project: await openProject(dir),
      format: "png",
      pageIds: pages,
      destination: join(root, "slides"),
      directory: true,
      scale: 1,
    });
    expect(result.files.map((file) => file.split(/[\\/]/).pop())).toEqual([
      "slide-01.png",
      "slide-02.png",
    ]);
    expect(pngSize(await readFile(result.files[0]!))).toEqual({ width: 1920, height: 1080 });
  }, 120_000);

  it("exports a print poster PDF at its physical size and a PNG at the requested DPI", async () => {
    const dir = join(root, "poster");
    await createProject({
      dir,
      name: "Poster",
      prompt: "",
      mode: "create",
      settings: defaultSettings("poster"),
    });
    await updateProject(dir, (project) => {
      project.settings.posterKind = "print";
      project.settings.posterSize = { preset: "a4", width: 210, height: 297, unit: "mm" };
      project.settings.orientation = "portrait";
    });
    const { pageId } = await writePage(dir, {
      index: 1,
      title: "Poster",
      html: '<div style="position:absolute;inset:0;background:#ffffff"></div>',
      css: "",
    });
    const project = await openProject(dir);
    const pdf = await runExport({
      dir,
      project,
      format: "pdf",
      pageIds: [pageId],
      destination: join(root, "poster.pdf"),
    });
    const document = await PDFDocument.load(await readFile(pdf.files[0]!));
    expect(document.getPageCount()).toBe(1);
    expect(document.getPage(0).getWidth()).toBeCloseTo((210 * 72) / 25.4, 2);
    expect(document.getPage(0).getHeight()).toBeCloseTo((297 * 72) / 25.4, 2);

    const png = await runExport({
      dir,
      project,
      format: "png",
      pageIds: [pageId],
      destination: join(root, "poster.png"),
      dpi: 300,
    });
    const size = pngSize(await readFile(png.files[0]!));
    expect(Math.abs(size.width - (210 / 25.4) * 300)).toBeLessThanOrEqual(2);
    expect(Math.abs(size.height - (297 / 25.4) * 300)).toBeLessThanOrEqual(2);
  }, 120_000);

  it("exports a PPTX with one full-page image per slide in project order", async () => {
    const { dir, pages } = await deck();
    const result = await runExport({
      dir,
      project: await openProject(dir),
      format: "pptx",
      pageIds: pages,
      destination: join(root, "deck.pptx"),
    });
    const zip = await JSZip.loadAsync(await readFile(result.files[0]!));
    const slides = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    expect(slides).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]);
    const colors: Array<[number, number, number]> = [];
    for (const slide of slides) {
      const rels = await zip.file(`ppt/slides/_rels/${slide.split("/").pop()}.rels`)!.async("string");
      const target = /Target="\.\.\/media\/([^"]+)"/.exec(rels)![1]!;
      colors.push(await centerColor(await zip.file(`ppt/media/${target}`)!.async("nodebuffer")));
    }
    expect(colors[0]![0]).toBeGreaterThan(200);
    expect(colors[0]![2]).toBeLessThan(80);
    expect(colors[1]![2]).toBeGreaterThan(200);
    expect(colors[1]![0]).toBeLessThan(80);
  }, 180_000);

  it("blocks export when artwork references missing assets", async () => {
    const dir = join(root, "broken");
    await createProject({
      dir,
      name: "Broken",
      prompt: "",
      mode: "create",
      settings: defaultSettings("slides"),
    });
    await updateProject(dir, (project) => {
      project.settings.slideCount = 1;
    });
    const { pageId } = await writePage(dir, {
      index: 1,
      title: "Broken",
      html: '<img src="assets/ctx_missing.png" alt="">',
      css: "",
    });
    const error = await runExport({
      dir,
      project: await openProject(dir),
      format: "pdf",
      pageIds: [pageId],
      destination: join(root, "broken.pdf"),
    }).catch((caught: unknown) => caught);
    expect((error as { details?: { reason?: string } }).details?.reason).toBe("export-blocked");
  }, 60_000);

  it("refuses to start when the export was already cancelled", async () => {
    const { dir, pages } = await deck();
    const controller = new AbortController();
    controller.abort();
    const error = await runExport({
      dir,
      project: await openProject(dir),
      format: "pdf",
      pageIds: pages,
      destination: join(root, "cancelled.pdf"),
      signal: controller.signal,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CancellationError);
  }, 60_000);

  it("emits progress and completion events through the export command", async () => {
    const { dir, pages } = await deck();
    const emitted: Array<{ type: string; data: Record<string, unknown> }> = [];
    const handlers = createExportHandlers({
      formaEvents: { emit: (type: string, data: Record<string, unknown>) => emitted.push({ type, data }) },
    } as unknown as WorkerContext);
    const result = await handlers["rendering.export"]!({
      dir,
      format: "png",
      scope: "selected",
      pageId: pages[1],
      destination: join(root, "command.png"),
      scale: 1,
      runId: "run-1",
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) {
      expect((result.data as { files: string[] }).files).toHaveLength(1);
    }
    expect(emitted.filter((event) => event.type === FORMA_EVENTS.exportProgress).map((event) => event.data.completed)).toEqual([0, 1]);
    expect(emitted.some((event) => event.type === FORMA_EVENTS.exportCompleted)).toBe(true);
    expect(emitted.some((event) => event.type === FORMA_EVENTS.exportFailed)).toBe(false);
  }, 120_000);
});
