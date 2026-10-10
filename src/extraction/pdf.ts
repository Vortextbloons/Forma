import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { getDocument, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ocrImage } from "./ocr.ts";
import {
  extractionKind,
  normalizeText,
  type ExtractionResult,
  type ExtractedPage,
} from "./types.ts";

const MIN_TEXT_CHARS = 40;

type NapiContext = NonNullable<ReturnType<Canvas["getContext"]>>;

function standardFontsUrl(): string {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("pdfjs-dist/package.json"));
  const suffix = sep === "/" ? "" : "/";
  return `${pathToFileURL(join(root, "standard_fonts")).href}${suffix}`;
}

export async function extractPdf(path: string): Promise<ExtractionResult> {
  const data = new Uint8Array(await readFile(path));
  const task = getDocument({
    data,
    useSystemFonts: true,
    standardFontDataUrl: standardFontsUrl(),
  });
  const doc = await task.promise;
  const pages: ExtractedPage[] = [];
  try {
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
      }
      const normalized = normalizeText(text);
      if (normalized.length >= MIN_TEXT_CHARS) {
        pages.push({ page: number, text: normalized, source: "text" });
        continue;
      }
      pages.push({ page: number, text: await ocrPdfPage(page), source: "ocr" });
    }
  } finally {
    await task.destroy();
  }
  return { kind: extractionKind(pages), pages };
}

async function ocrPdfPage(page: PDFPageProxy): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  const maxSide = Math.max(base.width, base.height);
  const scale = Math.min(2, Math.max(1, 1800 / maxSide));
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d") as NapiContext;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, viewport.width, viewport.height);
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  const png = canvas.toBuffer("image/png");
  return ocrImage(png);
}
