import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeText, type ExtractionResult } from "./types.ts";
import { FORMA_EVENTS } from "../forma/events.ts";
import { formaEnv } from "../forma/runtime.ts";
import { atomicWriteFile } from "../projects/atomic.ts";
import { extractionPath, openProject, updateContextItem } from "../projects/store.ts";
import type { ContextItem } from "../projects/schema.ts";

export interface StoredExtraction extends ExtractionResult {
  id: string;
  name: string;
  mime: string;
}

export async function extractContext(
  dir: string,
  item: ContextItem,
): Promise<ExtractionResult | null> {
  const assetPath = resolve(dir, item.asset);
  if (item.mime === "application/pdf") {
    const { extractPdf } = await import("./pdf.ts");
    return extractPdf(assetPath);
  }
  if (item.mime === "text/plain" || item.mime === "text/markdown") {
    const text = normalizeText(await readFile(assetPath, "utf8"));
    return {
      kind: "text",
      pages: text ? [{ page: 1, text, source: "text" }] : [],
    };
  }
  return null;
}

export function scheduleExtraction(dir: string, contextId: string): Promise<void> {
  const key = resolve(dir);
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(() => runExtraction(dir, contextId));
  queues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

const queues = new Map<string, Promise<void>>();

async function runExtraction(dir: string, contextId: string): Promise<void> {
  const project = await openProject(dir).catch(() => undefined);
  const item = project?.context.find((entry) => entry.id === contextId);
  if (!item) return;
  try {
    const result = await extractContext(dir, item);
    if (!result) {
      await updateContextItem(dir, contextId, { status: "ready", error: null });
      return;
    }
    const stored: StoredExtraction = {
      id: item.id,
      name: item.name,
      mime: item.mime,
      ...result,
    };
    await atomicWriteFile(extractionPath(dir, contextId), `${JSON.stringify(stored, null, 2)}\n`);
    const chars = result.pages.reduce((total, page) => total + page.text.length, 0);
    await updateContextItem(dir, contextId, {
      status: "ready",
      error: null,
      extraction: { kind: result.kind, pages: result.pages.length, chars },
    });
    emitContextReady(contextId, "ready");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateContextItem(dir, contextId, { status: "error", error: message }).catch(
      () => undefined,
    );
    emitContextReady(contextId, "error", message);
  }
}

function emitContextReady(contextId: string, status: "ready" | "error", error?: string): void {
  formaEnv()?.events.emit(FORMA_EVENTS.contextReady, {
    id: contextId,
    status,
    ...(error ? { error } : {}),
  });
}

export async function loadExtraction(
  dir: string,
  contextId: string,
): Promise<StoredExtraction | null> {
  try {
    const raw = await readFile(extractionPath(dir, contextId), "utf8");
    return JSON.parse(raw) as StoredExtraction;
  } catch {
    return null;
  }
}
