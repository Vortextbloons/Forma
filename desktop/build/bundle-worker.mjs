import { existsSync } from "node:fs";
import { cp, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as esbuild from "esbuild";

const runtimeDir = resolve(process.argv[2] ?? "");
const srcDir = join(runtimeDir, "src");
const entry = join(srcDir, "worker", "index.ts");

if (!existsSync(entry)) {
  console.error(`bundle-worker: missing worker entry ${entry}`);
  process.exit(1);
}

await esbuild.build({
  entryPoints: [entry],
  outbase: srcDir,
  outdir: srcDir,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  splitting: true,
  external: [
    "@earendil-works/*",
    "puppeteer",
    "@napi-rs/canvas",
    "pdf-lib",
    "pdfjs-dist",
    "pdfjs-dist/*",
    "pptxgenjs",
    "echarts",
    "katex",
    "tesseract.js",
    "simple-icons",
    "lucide-static",
  ],
});

await cp(join(srcDir, "search", "ddgs"), join(srcDir, "worker", "ddgs"), { recursive: true });
await cp(join(srcDir, "tools", "mermaid.min.js"), join(srcDir, "worker", "mermaid.min.js"));

// The bundled agent resolves prompts as ../Prompts relative to the bundle.
// Copy file by file: on case-insensitive filesystems the target collides with
// the existing source directory src/prompts.
const promptsTarget = join(srcDir, "Prompts");
await mkdir(promptsTarget, { recursive: true });
for (const name of await readdir(join(runtimeDir, "Prompts"))) {
  await cp(join(runtimeDir, "Prompts", name), join(promptsTarget, name), { recursive: true });
}

console.log(`bundle-worker: wrote ${join(srcDir, "worker", "index.js")}`);
