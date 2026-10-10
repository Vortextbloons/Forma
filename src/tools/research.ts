import { z } from "zod";
import { RuntimeError, type RigTool, type ToolContext } from "rig";
import { createSearchProvider, web } from "rig/tools/web";
import { addSource, importContextAsset, openProject } from "../projects/store.ts";
import { getSearchKey } from "../settings/credentials.ts";
import type { ProjectFile } from "../projects/schema.ts";

const researchInput = z.object({
  query: z.string().min(1).describe("What to research"),
  maxResults: z.number().int().positive().max(10).optional(),
});

const readUrlInput = z.object({
  url: z.string().url().describe("Public http(s) URL to fetch and read"),
});

const findPhotosInput = z.object({
  query: z.string().min(1).describe("What the photo should show"),
  count: z.number().int().positive().max(12).optional(),
  orientation: z.enum(["landscape", "portrait", "square"]).optional(),
});

const importPhotoInput = z.object({
  photoId: z.string().min(1).describe("photoId from find_photos"),
  query: z.string().optional().describe("The search query that found this photo"),
  role: z.enum(["must-include", "style-reference", "content-source", "optional"]).optional(),
});

export const researchTools: Array<RigTool<z.ZodTypeAny, unknown>> = [
  researchTool(),
  readUrlTool(),
  findPhotosTool(),
  importPhotoTool(),
];

function dirOf(ctx: ToolContext): string {
  return ctx.workspace.dir || ctx.workspace.root || process.cwd();
}

async function requireResearch(ctx: ToolContext): Promise<ProjectFile> {
  const project = await openProject(dirOf(ctx));
  if (!project.settings.research) {
    throw new RuntimeError(
      "Research is turned off for this project. Enable it in the Design tab before using research tools.",
    );
  }
  return project;
}

async function requireImageSearch(ctx: ToolContext): Promise<ProjectFile> {
  const project = await openProject(dirOf(ctx));
  if (!project.settings.imageSearch) {
    throw new RuntimeError(
      "Image search is turned off for this project. Enable it in the Design tab before finding photos.",
    );
  }
  return project;
}

async function requireKey(provider: "exa" | "pexels", label: string): Promise<string> {
  const key = await getSearchKey(provider);
  if (!key) {
    throw new RuntimeError(
      `${label} needs an API key. Add one in Settings under Search credentials.`,
    );
  }
  return key;
}

function researchTool(): RigTool<z.ZodTypeAny, unknown> {
  return {
    name: "research",
    description:
      "Search the web for current facts via Exa. Only available when research is enabled for the project. Record which result supports which claim.",
    input: researchInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      await requireResearch(ctx);
      const apiKey = await requireKey("exa", "Research");
      const provider = createSearchProvider("exa", { apiKey });
      let response;
      try {
        response = await provider.search(input.query, {
          maxResults: input.maxResults ?? 5,
          signal: ctx.signal,
        });
      } catch (error) {
        throw new RuntimeError(
          `Research search failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      for (const result of response.results) {
        await addSource(dir, {
          kind: "research",
          title: result.title,
          url: result.url,
          provider: "exa",
          query: input.query,
        });
      }
      return { query: input.query, results: response.results };
    },
  };
}

function readUrlTool(): RigTool<z.ZodTypeAny, unknown> {
  return {
    name: "read_url",
    description:
      "Fetch a public web page and return its text. Only available when research is enabled for the project.",
    input: readUrlInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      await requireResearch(ctx);
      const result = await web.fetch({ approval: "allow" }).execute({ url: input.url }, ctx);
      await addSource(dir, {
        kind: "research",
        title: result.url,
        url: result.url,
        provider: "web",
      });
      return result;
    },
  };
}

function findPhotosTool(): RigTool<z.ZodTypeAny, unknown> {
  return {
    name: "find_photos",
    description:
      "Search Pexels for photos. Only available when image search is enabled for the project. Pick suitable photoIds and import them with import_photo.",
    input: findPhotosInput,
    async execute(input, ctx) {
      await requireImageSearch(ctx);
      const apiKey = await requireKey("pexels", "Image search");
      const url = new URL("https://api.pexels.com/v1/search");
      url.searchParams.set("query", input.query);
      url.searchParams.set("per_page", String(input.count ?? 8));
      if (input.orientation) url.searchParams.set("orientation", input.orientation);
      const response = await fetch(url, {
        headers: { Authorization: apiKey },
        signal: ctx.signal,
      }).catch((error: unknown) => {
        throw new RuntimeError(
          `Image search request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      if (!response.ok) {
        throw new RuntimeError(`Pexels search failed (HTTP ${response.status})`);
      }
      const payload = (await response.json()) as PexelsSearchResponse;
      return {
        query: input.query,
        photos: (payload.photos ?? []).map((photo) => ({
          photoId: String(photo.id),
          description: photo.alt ?? "",
          width: photo.width,
          height: photo.height,
          photographer: photo.photographer,
          photographerUrl: photo.photographer_url,
          pageUrl: photo.url,
          imageUrl: photo.src?.large2x ?? photo.src?.large ?? photo.src?.original,
        })),
      };
    },
  };
}

function importPhotoTool(): RigTool<z.ZodTypeAny, unknown> {
  return {
    name: "import_photo",
    description:
      "Download a Pexels photo into the project as a context asset, recording its attribution. Use the photoId returned by find_photos.",
    input: importPhotoInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      await requireImageSearch(ctx);
      const apiKey = await requireKey("pexels", "Image search");
      const detail = await fetch(`https://api.pexels.com/v1/photos/${input.photoId}`, {
        headers: { Authorization: apiKey },
        signal: ctx.signal,
      }).catch((error: unknown) => {
        throw new RuntimeError(
          `Could not load photo ${input.photoId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      if (!detail.ok) {
        throw new RuntimeError(`Pexels photo ${input.photoId} failed (HTTP ${detail.status})`);
      }
      const photo = (await detail.json()) as PexelsPhoto;
      const imageUrl = photo.src?.large2x ?? photo.src?.large ?? photo.src?.original;
      if (!imageUrl) {
        throw new RuntimeError(`Pexels photo ${input.photoId} has no downloadable image`);
      }
      const image = await fetch(imageUrl, { signal: ctx.signal }).catch((error: unknown) => {
        throw new RuntimeError(
          `Could not download photo ${input.photoId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      if (!image.ok) {
        throw new RuntimeError(`Downloading photo ${input.photoId} failed (HTTP ${image.status})`);
      }
      const data = new Uint8Array(await image.arrayBuffer());
      if (data.byteLength > 25 * 1024 * 1024) {
        throw new RuntimeError(`Photo ${input.photoId} is too large (${data.byteLength} bytes)`);
      }
      const mime = image.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
      const source = await addSource(dir, {
        kind: "photo",
        title: photo.alt || `Pexels photo ${input.photoId}`,
        url: photo.url,
        provider: "pexels",
        author: photo.photographer,
        authorUrl: photo.photographer_url,
        query: input.query,
      });
      const { item } = await importContextAsset(dir, {
        name: photo.alt || `Pexels photo ${input.photoId}`,
        extension: extensionFor(mime),
        mime,
        data,
        role: input.role ?? "optional",
        sourceId: source.source.id,
      });
      return {
        contextId: item.id,
        name: item.name,
        sourceId: source.source.id,
        attribution: {
          provider: "Pexels",
          photographer: photo.photographer,
          photographerUrl: photo.photographer_url,
          pageUrl: photo.url,
        },
      };
    },
  };
}

function extensionFor(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return ".jpg";
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  alt?: string;
  src?: Record<string, string>;
}

interface PexelsSearchResponse {
  photos?: PexelsPhoto[];
}
