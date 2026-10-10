import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CancellationError, RuntimeError } from "rig";
import { PDFDocument } from "pdf-lib";
import { atomicWriteFile } from "../projects/atomic.ts";
import { effectiveSize, type EffectiveSize } from "../projects/size.ts";
import type { ProjectFile } from "../projects/schema.ts";
import { launchBrowser, renderPage } from "./browser.ts";
import { composePage } from "./compose.ts";
import { cssPixelSize } from "./validate.ts";

export type ExportFormat = "pdf" | "png" | "pptx";

export interface ExportRequest {
  dir: string;
  project: ProjectFile;
  format: ExportFormat;
  pageIds: string[];
  destination: string;
  directory?: boolean;
  scale?: number;
  dpi?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export interface ExportResult {
  format: ExportFormat;
  files: string[];
}

const PPTX_LAYOUT = "FORMA";
const PPTX_SCALE = 2;
const DPI_PER_CSS_PX = 96;

export async function runExport(request: ExportRequest): Promise<ExportResult> {
  const { dir, project, pageIds } = request;
  if (pageIds.length === 0) {
    throw new RuntimeError("There is no artwork to export yet.");
  }
  const size = effectiveSize(project.settings);
  const composed = new Map<string, string>();
  const missing: Array<{ pageId: string; ref: string }> = [];
  for (const pageId of pageIds) {
    const page = await composePage(dir, pageId, size);
    for (const ref of page.missing) missing.push({ pageId, ref });
    composed.set(pageId, page.html);
  }
  if (missing.length > 0) {
    throw new RuntimeError(
      "Export is blocked because artwork references assets that are missing from the project.",
      {
        details: {
          reason: "export-blocked",
          issues: missing.map(({ pageId, ref }) => ({ pageId, kind: "missing-asset", message: `Referenced asset "${ref}" was not found in the project` })),
        },
      },
    );
  }
  throwIfAborted(request.signal);
  if (request.format === "pptx") return exportPptx(request, size, composed);
  return exportChromium(request, size, composed);
}

async function exportChromium(
  request: ExportRequest,
  size: EffectiveSize,
  composed: Map<string, string>,
): Promise<ExportResult> {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    if (request.format === "pdf") {
      const buffers: Uint8Array[] = [];
      const css = pdfCssSize(size);
      let completed = 0;
      for (const pageId of request.pageIds) {
        throwIfAborted(request.signal);
        await renderPage(page, composed.get(pageId)!, cssPixelSize(size));
        buffers.push(
          await page.pdf({
            width: `${css.width}px`,
            height: `${css.height}px`,
            printBackground: true,
            margin: { top: "0", right: "0", bottom: "0", left: "0" },
          }),
        );
        completed += 1;
        request.onProgress?.(completed, request.pageIds.length);
      }
      const exact = pdfPointSize(size);
      const merged = await PDFDocument.create();
      for (const buffer of buffers) {
        const document = await PDFDocument.load(buffer);
        const pages = await merged.copyPages(document, document.getPageIndices());
        for (const copied of pages) {
          copied.setSize(exact.width, exact.height);
          merged.addPage(copied);
        }
      }
      const destination = ensureExtension(request.destination, ".pdf");
      await mkdir(dirname(destination), { recursive: true });
      await atomicWriteFile(destination, await merged.save());
      return { format: "pdf", files: [destination] };
    }

    const viewport = cssPixelSize(size);
    const scale = pngScale(request);
    const files: string[] = [];
    let completed = 0;
    for (const [index, pageId] of request.pageIds.entries()) {
      throwIfAborted(request.signal);
      await renderPage(page, composed.get(pageId)!, viewport, scale);
      const shot = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      });
      if (request.directory) {
        await mkdir(request.destination, { recursive: true });
        const file = join(request.destination, `slide-${String(index + 1).padStart(2, "0")}.png`);
        await atomicWriteFile(file, shot);
        files.push(file);
      } else {
        const destination = ensureExtension(request.destination, ".png");
        await mkdir(dirname(destination), { recursive: true });
        await atomicWriteFile(destination, shot);
        files.push(destination);
      }
      completed += 1;
      request.onProgress?.(completed, request.pageIds.length);
    }
    return { format: "png", files };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function exportPptx(
  request: ExportRequest,
  size: EffectiveSize,
  composed: Map<string, string>,
): Promise<ExportResult> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const viewport = cssPixelSize(size);
  const width = viewport.width / DPI_PER_CSS_PX;
  const height = viewport.height / DPI_PER_CSS_PX;
  const presentation = new PptxGenJS();
  presentation.defineLayout({ name: PPTX_LAYOUT, width, height });
  presentation.layout = PPTX_LAYOUT;

  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    let completed = 0;
    for (const pageId of request.pageIds) {
      throwIfAborted(request.signal);
      await renderPage(page, composed.get(pageId)!, viewport, PPTX_SCALE);
      const shot = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      });
      presentation
        .addSlide()
        .addImage({ data: `image/png;base64,${Buffer.from(shot).toString("base64")}`, x: 0, y: 0, w: width, h: height });
      completed += 1;
      request.onProgress?.(completed, request.pageIds.length);
    }
    const data = (await presentation.write({ outputType: "nodebuffer" })) as Buffer;
    const destination = ensureExtension(request.destination, ".pptx");
    await mkdir(dirname(destination), { recursive: true });
    await atomicWriteFile(destination, data);
    return { format: "pptx", files: [destination] };
  } finally {
    await page.close().catch(() => undefined);
  }
}

function pngScale(request: ExportRequest): number {
  if (request.dpi && request.dpi > 0) return request.dpi / DPI_PER_CSS_PX;
  return request.scale === 2 ? 2 : 1;
}

function pdfCssSize(size: EffectiveSize): { width: number; height: number } {
  const factor = size.unit === "mm" ? DPI_PER_CSS_PX / 25.4 : size.unit === "in" ? DPI_PER_CSS_PX : 1;
  return { width: size.width * factor, height: size.height * factor };
}

function pdfPointSize(size: EffectiveSize): { width: number; height: number } {
  const factor = size.unit === "mm" ? 72 / 25.4 : size.unit === "in" ? 72 : 72 / DPI_PER_CSS_PX;
  return { width: size.width * factor, height: size.height * factor };
}

function ensureExtension(path: string, extension: string): string {
  return path.toLowerCase().endsWith(extension) ? path : `${path}${extension}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CancellationError("The export was cancelled");
  }
}
