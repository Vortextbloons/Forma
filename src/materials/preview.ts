import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { loadExtraction } from "../extraction/index.ts";
import type { ContextItem, DataColumn } from "../projects/schema.ts";

export type MaterialPreview =
  | { kind: "image"; dataUri: string }
  | { kind: "table"; sheets: Array<{ name: string; columns: DataColumn[]; rows: string[][] }>; truncated: boolean }
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "html"; html: string }
  | { kind: "empty"; note: string };

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TEXT_CHARS = 4_000;
const MAX_HTML_CHARS = 200_000;

export async function materialPreview(dir: string, item: ContextItem): Promise<MaterialPreview> {
  if (item.data) {
    return {
      kind: "table",
      sheets: item.data.sheets.map((sheet) => ({
        name: sheet.name,
        columns: sheet.columns,
        rows: sheet.preview,
      })),
      truncated: item.data.truncated,
    };
  }
  const file = resolve(dir, item.asset);
  if (item.mime.startsWith("image/")) {
    const info = await stat(file).catch(() => undefined);
    if (!info || info.size > MAX_IMAGE_BYTES) {
      return { kind: "empty", note: info ? "This image is too large to preview here." : "The image file is missing." };
    }
    const bytes = await readFile(file).catch(() => undefined);
    if (!bytes) return { kind: "empty", note: "The image file is missing." };
    return { kind: "image", dataUri: `data:${item.mime};base64,${bytes.toString("base64")}` };
  }
  if (item.mime === "text/html") {
    const html = await readFile(file, "utf8").catch(() => "");
    return html
      ? { kind: "html", html: html.slice(0, MAX_HTML_CHARS) }
      : { kind: "empty", note: "The result file is missing." };
  }
  if (item.mime === "text/plain" || item.mime === "text/markdown") {
    const text = await readFile(file, "utf8").catch(() => "");
    return textExcerpt(text || "The file is empty.");
  }
  if (item.mime === "application/pdf") {
    const extraction = await loadExtraction(dir, item.id);
    const text = extraction?.pages.map((page) => page.text).join("\n\n") ?? "";
    if (text) return textExcerpt(text);
    return {
      kind: "empty",
      note: item.status === "processing" ? "Reading this document…" : "No readable text was found in this document.",
    };
  }
  return { kind: "empty", note: "This file type has no preview." };
}

function textExcerpt(text: string): MaterialPreview {
  return {
    kind: "text",
    text: text.slice(0, MAX_TEXT_CHARS),
    truncated: text.length > MAX_TEXT_CHARS,
  };
}
