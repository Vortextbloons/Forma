import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type Tesseract from "tesseract.js";
import { normalizeText } from "./types.ts";

let workerPromise: Promise<Tesseract.Worker> | undefined;

export function tessdataDir(): string {
  const override = process.env.FORMA_TESSDATA_DIR;
  if (override) return override;
  const require = createRequire(import.meta.url);
  const entry = require.resolve("@tesseract.js-data/eng");
  return join(dirname(entry), "4.0.0");
}

async function getWorker(): Promise<Tesseract.Worker> {
  workerPromise ??= (async () => {
    const { default: Tesseract } = await import("tesseract.js");
    return Tesseract.createWorker("eng", 1, {
      langPath: tessdataDir(),
      gzip: true,
      cacheMethod: "write",
    });
  })();
  return workerPromise;
}

export async function ocrImage(image: Uint8Array): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(Buffer.from(image));
  return normalizeText(data.text);
}

export async function closeOcrWorker(): Promise<void> {
  const pending = workerPromise;
  workerPromise = undefined;
  if (!pending) return;
  const worker = await pending.catch(() => undefined);
  await worker?.terminate().catch(() => undefined);
}
