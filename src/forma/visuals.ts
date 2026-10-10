import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProjectFile } from "../projects/schema.ts";

const ATTACHABLE = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGES = 6;
const MAX_BYTES = 6 * 1024 * 1024;

export interface PromptImage {
  data: string;
  mediaType: string;
}

export async function collectVisualReferences(
  dir: string,
  project: ProjectFile,
): Promise<PromptImage[]> {
  const items = project.context.filter(
    (item) =>
      (item.role === "must-include" || item.role === "style-reference") &&
      ATTACHABLE.has(item.mime),
  );
  const images: PromptImage[] = [];
  for (const item of items.slice(0, MAX_IMAGES)) {
    try {
      const data = await readFile(resolve(dir, item.asset));
      if (data.byteLength > MAX_BYTES) continue;
      images.push({ data: data.toString("base64"), mediaType: item.mime });
    } catch {
      continue;
    }
  }
  return images;
}
