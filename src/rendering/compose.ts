import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readPage } from "../projects/pages.ts";
import type { EffectiveSize } from "../projects/size.ts";

const ASSET_REF = /(?:\.\.\/)*assets\/[A-Za-z0-9._-]+/g;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

export interface ComposedPage {
  html: string;
  missing: string[];
}

export interface ComposeOptions {
  inlineAssets?: boolean;
}

export function collectAssetRefs(html: string, css: string): string[] {
  const refs = new Set<string>();
  for (const match of `${html}\n${css}`.matchAll(ASSET_REF)) {
    refs.add(match[0].replace(/^(?:\.\.\/)+/, ""));
  }
  return [...refs];
}

export async function composePage(
  dir: string,
  pageId: string,
  size: EffectiveSize,
  options: ComposeOptions = {},
): Promise<ComposedPage> {
  const source = await readPage(dir, pageId);
  const inlineAssets = options.inlineAssets ?? true;
  const refs = [...collectAssetRefs(source.html, source.css)].sort((a, b) => b.length - a.length);
  const missing: string[] = [];
  let html = source.html;
  let css = source.css;
  for (const ref of refs) {
    const dataUri = inlineAssets ? await assetDataUri(dir, ref) : ref;
    if (dataUri === null) {
      missing.push(ref);
      continue;
    }
    html = replaceRef(html, ref, dataUri);
    css = replaceRef(css, ref, dataUri);
  }
  return { html: document(html, css, size), missing };
}

function replaceRef(text: string, ref: string, replacement: string): string {
  return text.split(`../${ref}`).join(replacement).split(ref).join(replacement);
}

async function assetDataUri(dir: string, ref: string): Promise<string | null> {
  try {
    const file = resolve(dir, ref);
    const data = await readFile(file);
    const extension = ref.slice(ref.lastIndexOf(".")).toLowerCase();
    const mime = MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

export function document(html: string, css: string, size: EffectiveSize): string {
  const width = `${size.width}${size.unit}`;
  const height = `${size.height}${size.unit}`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@page { size: ${width} ${height}; margin: 0; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: ${width}; height: ${height}; background: #ffffff; }
body {
  font-family: "Segoe UI", "Segoe UI Variable", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.forma-page { position: relative; width: ${width}; height: ${height}; overflow: hidden; background: #ffffff; }
.forma-page img, .forma-page svg { display: block; }
${css}
</style>
</head>
<body>
<div class="forma-page">${html}</div>
</body>
</html>
`;
}
