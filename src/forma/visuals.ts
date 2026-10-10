import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RuntimeError } from "rig";
import { openProject } from "../projects/store.ts";
import type { ProjectFile } from "../projects/schema.ts";

const ATTACHABLE = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGES = 6;
const MAX_BYTES = 6 * 1024 * 1024;

export interface PromptImage {
  data: string;
  mediaType: string;
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
      const data = await readFile(resolve(dir, item.asset), { signal });
      if (data.byteLength > MAX_BYTES) throw new RuntimeError("This reference image exceeds the 6 MB viewing limit.");
      return {
        content: [
          { type: "text" as const, text: `${item.name} (${item.asset})` },
          { type: "image" as const, data: data.toString("base64"), mimeType: item.mime },
        ],
        details: { id: item.id, path: item.asset },
      };
    },
  };
}

export async function collectVisualReferences(
  dir: string,
  project: ProjectFile,
): Promise<PromptImage[]> {
  const items = project.context.filter((item) => ATTACHABLE.has(item.mime));
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
