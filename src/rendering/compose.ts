import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { readPage } from "../projects/pages.ts";
import { openProject } from "../projects/store.ts";
import { designStyles, type DesignProfile } from "../projects/design.ts";
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

interface AssetUriEntry {
  mtimeMs: number;
  size: number;
  promise: Promise<string | null>;
}

const ASSET_URI_LIMIT = 16;
const assetUris = new Map<string, AssetUriEntry>();

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
  const katex = KATEX_MARKUP.test(html) ? await katexStyles() : "";
  const project = await openProject(dir);
  return { html: document(html, `${katex}${katex ? "\n" : ""}${css}`, size, project.settings.designProfile), missing };
}

const KATEX_MARKUP = /class="[^"]*\bkatex\b/;
const KATEX_FONT_SOURCES =
  /url\(fonts\/([A-Za-z0-9_-]+)\.woff2\) format\("woff2"\),url\(fonts\/[A-Za-z0-9_-]+\.woff\) format\("woff"\),url\(fonts\/[A-Za-z0-9_-]+\.ttf\) format\("truetype"\)/g;

let katexStylePromise: Promise<string> | undefined;

function katexStyles(): Promise<string> {
  katexStylePromise ??= buildKatexStyles();
  return katexStylePromise;
}

async function buildKatexStyles(): Promise<string> {
  const require = createRequire(import.meta.url);
  const cssPath = require.resolve("katex/dist/katex.min.css");
  const fontsDir = join(dirname(cssPath), "fonts");
  const css = await readFile(cssPath, "utf8");
  const fonts = new Map<string, string>();
  for (const match of css.matchAll(/url\(fonts\/([A-Za-z0-9_-]+)\.woff2\)/g)) {
    const name = match[1]!;
    if (fonts.has(name)) continue;
    fonts.set(name, (await readFile(join(fontsDir, `${name}.woff2`))).toString("base64"));
  }
  return css.replace(KATEX_FONT_SOURCES, (source, name: string) =>
    fonts.has(name) ? `url(data:font/woff2;base64,${fonts.get(name)}) format("woff2")` : source,
  );
}

function replaceRef(text: string, ref: string, replacement: string): string {
  return text.split(`../${ref}`).join(replacement).split(ref).join(replacement);
}

async function assetDataUri(dir: string, ref: string): Promise<string | null> {
  const file = resolve(dir, ref);
  const info = await stat(file).catch(() => undefined);
  if (!info) return null;
  const cached = assetUris.get(file);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
    return cached.promise;
  }
  const entry: AssetUriEntry = {
    mtimeMs: info.mtimeMs,
    size: info.size,
    promise: encodeAssetDataUri(file, ref),
  };
  if (assetUris.size >= ASSET_URI_LIMIT) {
    const oldest = assetUris.keys().next().value;
    if (oldest !== undefined) assetUris.delete(oldest);
  }
  assetUris.set(file, entry);
  const uri = await entry.promise;
  if (uri === null) assetUris.delete(file);
  return uri;
}

async function encodeAssetDataUri(file: string, ref: string): Promise<string | null> {
  try {
    const data = await readFile(file);
    const extension = ref.slice(ref.lastIndexOf(".")).toLowerCase();
    const mime = MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

export function document(html: string, css: string, size: EffectiveSize, profile?: DesignProfile): string {
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
${profile ? designStyles(profile, size) : ""}
${css}
</style>
</head>
<body>
<div class="forma-page">${html}</div>
</body>
</html>
`;
}
