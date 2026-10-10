import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdf } from "../src/extraction/pdf.ts";
import { loadExtraction, scheduleExtraction } from "../src/extraction/index.ts";
import { createProject, importContextFile, importContextNote, openProject } from "../src/projects/store.ts";
import { defaultSettings } from "../src/projects/schema.ts";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forma-extract-"));
  process.env.FORMA_DATA_DIR = join(root, "data");
});

afterAll(async () => {
  delete process.env.FORMA_DATA_DIR;
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

async function makeTextPdf(path: string): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([612, 792]);
  first.drawText("First page facts and figures that form a complete sentence.", {
    x: 72,
    y: 700,
    size: 20,
    font,
  });
  const second = doc.addPage([612, 792]);
  second.drawText("Second page supporting details for the presentation.", {
    x: 72,
    y: 700,
    size: 20,
    font,
  });
  await writeFile(path, await doc.save());
}

async function makeScannedPdf(path: string): Promise<void> {
  const canvas = createCanvas(1000, 300);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 1000, 300);
  context.fillStyle = "#111111";
  context.font = "48px Arial";
  context.fillText("Scanned page facts and figures", 40, 170);
  const png = canvas.toBuffer("image/png");

  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png);
  const page = doc.addPage([612, 792]);
  page.drawImage(image, { x: 40, y: 450, width: 532, height: 160 });
  await writeFile(path, await doc.save());
}

describe("context extraction", () => {
  it("extracts text PDFs with page references", async () => {
    const path = join(root, "text.pdf");
    await makeTextPdf(path);
    const result = await extractPdf(path);
    expect(result.kind).toBe("text");
    expect(result.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(result.pages[0]!.text).toContain("First page facts");
    expect(result.pages[1]!.text).toContain("Second page supporting details");
  }, 60_000);

  it("OCRs scanned PDF pages", async () => {
    const path = join(root, "scanned.pdf");
    await makeScannedPdf(path);
    const result = await extractPdf(path);
    expect(result.kind).toBe("ocr");
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.source).toBe("ocr");
    expect(result.pages[0]!.text.toLowerCase()).toContain("scanned");
  }, 240_000);

  it("turns pasted notes into context with extraction", async () => {
    const dir = join(root, "Notes");
    await createProject({
      dir,
      name: "Notes",
      prompt: "",
      mode: "plan",
      settings: defaultSettings("slides"),
    });
    const { item } = await importContextNote(
      dir,
      "The sky is blue.\nWater is wet.",
      "content-source",
    );
    await scheduleExtraction(dir, item.id);
    const stored = await loadExtraction(dir, item.id);
    expect(stored?.pages[0]?.text).toContain("sky is blue");
    const project = await openProject(dir);
    expect(project.context[0]?.status).toBe("ready");
    expect(project.context[0]?.extraction).toMatchObject({ kind: "text", pages: 1 });
  }, 30_000);

  it("extracts imported text files through the scheduler", async () => {
    const dir = join(root, "Files");
    await createProject({
      dir,
      name: "Files",
      prompt: "",
      mode: "plan",
      settings: defaultSettings("slides"),
    });
    const source = join(root, "facts.txt");
    await writeFile(source, "Supplied fact: Forma exports presentations.\n", "utf8");
    const { item } = await importContextFile(dir, source, "content-source");
    await scheduleExtraction(dir, item.id);
    const stored = await loadExtraction(dir, item.id);
    expect(stored?.pages[0]?.text).toContain("Supplied fact");
  }, 30_000);
});
