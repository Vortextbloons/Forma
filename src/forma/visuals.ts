import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ProtocolError, RuntimeError } from "rig";
import { openProject } from "../projects/store.ts";
import type { ContextItem, ProjectFile } from "../projects/schema.ts";
import { renderArtworkPreview } from "../rendering/validate.ts";

const ATTACHABLE = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_IMAGES = 6;
const MAX_BYTES = 6 * 1024 * 1024;

export const IMAGES_UNSUPPORTED =
  "The selected model cannot read images. Choose an image-capable model, then try again.";

export interface PromptImage {
  data: string;
  mediaType: string;
}

export interface VisualReferences {
  images: PromptImage[];
  labels: Array<{ id: string; name: string; role: string; path: string }>;
  skipped: Array<{ id: string; name: string; reason: string }>;
}

async function promptImage(data: Buffer, mediaType: string): Promise<PromptImage> {
  if (data.byteLength <= MAX_BYTES) return { data: data.toString("base64"), mediaType };
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(data);
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return { data: (await canvas.encode("webp", 85)).toString("base64"), mediaType: "image/webp" };
}

async function referenceImage(dir: string, item: ContextItem, signal?: AbortSignal): Promise<PromptImage> {
  const data = await readFile(resolve(dir, item.asset), { signal });
  return promptImage(data, item.mime);
}

export async function normalizePromptImages(value: unknown): Promise<PromptImage[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ProtocolError('Missing or invalid parameter "images" (expected an array)');
  }
  if (value.length > MAX_IMAGES) {
    throw new RuntimeError(`Attach at most ${MAX_IMAGES} images per message.`);
  }
  const images: PromptImage[] = [];
  for (const raw of value) {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const data = typeof record.data === "string" ? record.data : "";
    const mediaType = typeof record.mediaType === "string" ? record.mediaType : "";
    if (!data || !mediaType) {
      throw new ProtocolError('Missing or invalid image attachment (expected "data" and "mediaType")');
    }
    if (!ATTACHABLE.has(mediaType)) {
      throw new RuntimeError(`Unsupported image type "${mediaType}". Attach PNG, JPEG, or WebP images.`);
    }
    images.push(await promptImage(Buffer.from(data, "base64"), mediaType));
  }
  return images;
}

export function viewImageTool(dir: string) {
  return {
    name: "view_image",
    label: "View reference image",
    description: "View a reference image before using it in artwork. Use an image id from read_project.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Reference image id from read_project" } },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(_toolCallId: string, { id }: { id: string }, signal?: AbortSignal) {
      const project = await openProject(dir);
      const item = project.context.find((item) => item.id === id);
      if (!item || !ATTACHABLE.has(item.mime)) {
        throw new RuntimeError("Choose a PNG, JPEG, or WebP reference image from read_project.");
      }
      const image = await referenceImage(dir, item, signal);
      return {
        content: [
          { type: "text" as const, text: `${item.id}: ${item.name} [${item.role}] (${item.asset})` },
          { type: "image" as const, data: image.data, mimeType: image.mediaType },
        ],
        details: { id: item.id, path: item.asset },
      };
    },
  };
}

export async function collectVisualReferences(
  dir: string,
  project: ProjectFile,
  pageId?: string,
  limit = MAX_IMAGES,
): Promise<VisualReferences> {
  const assigned = new Set([
    ...(project.pageMeta[pageId ?? ""]?.assets ?? []),
    ...(project.outline?.filter((entry) => !pageId || entry.id === pageId).flatMap((entry) => entry.assetIds) ?? []),
  ]);
  const items = project.context.filter((item) => ATTACHABLE.has(item.mime))
    .sort((a, b) => Number(assigned.has(b.id)) - Number(assigned.has(a.id)) || Number(b.role === "must-include") - Number(a.role === "must-include"));
  const result: VisualReferences = { images: [], labels: [], skipped: [] };
  for (const item of items) {
    if (result.images.length >= limit) {
      result.skipped.push({ id: item.id, name: item.name, reason: "Attachment limit; available through view_image" });
      continue;
    }
    try {
      result.images.push(await referenceImage(dir, item));
      result.labels.push({ id: item.id, name: item.name, role: item.role, path: item.asset });
    } catch (error) {
      result.skipped.push({ id: item.id, name: item.name, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export function viewArtworkTool(dir: string) {
  return {
    name: "view_artwork",
    label: "View rendered artwork",
    description: "View a rendered page and its layout diagnostics. Omit pageId for a labeled deck contact sheet. Use after creating or refining artwork to judge visual quality.",
    parameters: {
      type: "object",
      properties: { pageId: { type: "string", description: "Page id from read_project; omit to view the deck" } },
      additionalProperties: false,
    },
    async execute(_toolCallId: string, { pageId }: { pageId?: string }, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const project = await openProject(dir);
      if (pageId && !project.pages.includes(pageId)) throw new RuntimeError(`Unknown page "${pageId}"`);
      if (!project.pages.length) throw new RuntimeError("There is no artwork to preview yet.");
      const preview = await renderArtworkPreview(dir, project, pageId);
      signal?.throwIfAborted();
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ pageId, pages: project.pages, issues: preview.issues }) },
          { type: "image" as const, data: preview.data.toString("base64"), mimeType: "image/png" },
        ],
        details: { pageId, issues: preview.issues },
      };
    },
  };
}
