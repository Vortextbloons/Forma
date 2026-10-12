import { z } from "zod";
import { RuntimeError, type RigTool, type ToolContext } from "rig";
import { assertPublicHttpUrl, createSearchProvider, web } from "rig/tools/web";
import { addSource, importContextAsset, openProject } from "../projects/store.ts";
import { getSearchDefaults, getSearchKey } from "../settings/credentials.ts";
import type { ProjectFile } from "../projects/schema.ts";
import { resolveSearchSettings, type SearchDefaults } from "../settings/search.ts";
import { searchDdgsImages, searchDdgsText } from "../search/ddgs.ts";

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

type ImportPhotoInput = z.infer<typeof importPhotoInput>;

export const researchTools: Array<RigTool<z.ZodTypeAny, unknown>> = [
  researchTool(),
  readUrlTool(),
  findPhotosTool(),
  importPhotoTool(),
];

function dirOf(ctx: ToolContext): string {
  return ctx.workspace.dir || ctx.workspace.root || process.cwd();
}

async function requireResearch(ctx: ToolContext): Promise<SearchDefaults> {
  const project = await openProject(dirOf(ctx));
  const settings = resolveSearchSettings(project.settings, await getSearchDefaults());
  if (!settings.research) {
    throw new RuntimeError(
      "Web search is turned off for this project. Enable it in Settings under Web & images before using research tools.",
    );
  }
  return settings;
}

async function requireImageSearch(ctx: ToolContext): Promise<SearchDefaults> {
  const project = await openProject(dirOf(ctx));
  const settings = resolveSearchSettings(project.settings, await getSearchDefaults());
  if (!settings.imageSearch) {
    throw new RuntimeError(
      "Image finder is turned off for this project. Enable it in Settings under Web & images before finding photos.",
    );
  }
  return settings;
}

async function requireKey(provider: "exa" | "pexels", label: string): Promise<string> {
  const key = await getSearchKey(provider);
  if (!key) {
    throw new RuntimeError(
      `${label} needs an API key. Add one in Settings under Web & images.`,
    );
  }
  return key;
}

function researchTool(): RigTool<z.ZodTypeAny, unknown> {
  return {
    name: "research",
    description:
      "Search the web for current facts using the configured search provider (built-in or Exa). Only available when research is enabled for the project. Record which result supports which claim.",
    input: researchInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      const settings = await requireResearch(ctx);
      let results: Array<{ title: string; url: string; snippet: string }>;
      if (settings.researchProvider === "exa") {
        const apiKey = await requireKey("exa", "Research");
        const provider = createSearchProvider("exa", { apiKey });
        try {
          const response = await provider.search(input.query, {
            maxResults: input.maxResults ?? 5,
            signal: ctx.signal,
          });
          results = response.results.map((result) => ({
            title: result.title,
            url: result.url,
            snippet: result.snippet,
          }));
        } catch (error) {
          throw new RuntimeError(
            `Research search failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else {
        results = await searchDdgsText(input.query, input.maxResults ?? 5, ctx.signal);
      }
      for (const result of results) {
        await addSource(dir, {
          kind: "research",
          title: result.title,
          url: result.url,
          provider: settings.researchProvider,
          query: input.query,
        });
      }
      return { query: input.query, results };
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
      "Search for photos using the configured image provider (built-in or Pexels). Only available when image search is enabled for the project. Pick suitable photoIds and import them with import_photo.",
    input: findPhotosInput,
    async execute(input, ctx) {
      const settings = await requireImageSearch(ctx);
      if (settings.imageProvider === "pexels") {
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
      }
      const results = await searchDdgsImages(input.query, input.count ?? 8, ctx.signal);
      const photos = results.map((photo) => ({
        photoId: encodeDdgsPhotoId(photo),
        description: photo.title,
        width: photo.width,
        height: photo.height,
        pageUrl: photo.pageUrl,
        thumbnailUrl: photo.thumbnailUrl,
        imageUrl: photo.imageUrl,
      }));
      return { query: input.query, photos: filterByOrientation(photos, input.orientation) };
    },
  };
}

function importPhotoTool(): RigTool<z.ZodTypeAny, unknown> {
  return {
    name: "import_photo",
    description:
      "Download a photo into the project as a context asset and record its source. Use the photoId returned by find_photos.",
    input: importPhotoInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      await requireImageSearch(ctx);
      if (input.photoId.startsWith("ddgs:")) {
        return importDdgsPhoto(dir, input, ctx.signal);
      }
      if (!/^\d+$/.test(input.photoId)) {
        throw new RuntimeError("Invalid photoId. Use a photoId returned by find_photos.");
      }
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
      if (data.byteLength > MAX_PHOTO_BYTES) {
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

async function importDdgsPhoto(
  dir: string,
  input: ImportPhotoInput,
  signal?: AbortSignal,
): Promise<unknown> {
  const photo = decodeDdgsPhotoId(input.photoId);
  const { data, mime } = await downloadDdgsImage(photo.imageUrl, signal);
  const name = photo.title.trim() || "Imported photo";
  const source = await addSource(dir, {
    kind: "photo",
    title: name,
    url: photo.pageUrl,
    provider: "ddgs",
    query: input.query,
    licenseStatus: "unverified",
  });
  const { item } = await importContextAsset(dir, {
    name,
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
      provider: "Built-in image search",
      pageUrl: photo.pageUrl,
      licenseStatus: "unverified",
    },
  };
}

const ddgsPhotoSchema = z.object({
  title: z.string().default(""),
  imageUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  pageUrl: z.string().url().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  source: z.string().optional(),
});

type DdgsPhoto = z.infer<typeof ddgsPhotoSchema>;

function encodeDdgsPhotoId(photo: DdgsPhoto): string {
  return `ddgs:${Buffer.from(JSON.stringify(photo), "utf8").toString("base64url")}`;
}

function decodeDdgsPhotoId(id: string): DdgsPhoto {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(id.slice("ddgs:".length), "base64url").toString("utf8"));
  } catch {
    throw new RuntimeError("Invalid photoId. Use a photoId returned by find_photos.");
  }
  const parsed = ddgsPhotoSchema.safeParse(payload);
  if (!parsed.success) {
    throw new RuntimeError("Invalid photoId. Use a photoId returned by find_photos.");
  }
  return parsed.data;
}

function filterByOrientation<T extends { width?: number; height?: number }>(
  photos: T[],
  orientation?: "landscape" | "portrait" | "square",
): T[] {
  if (!orientation) return photos;
  return photos.filter((photo) => {
    if (!photo.width || !photo.height) return true;
    if (orientation === "landscape") return photo.width > photo.height;
    if (orientation === "portrait") return photo.height > photo.width;
    return photo.width === photo.height;
  });
}

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function downloadDdgsImage(
  url: string,
  signal?: AbortSignal,
): Promise<{ data: Uint8Array; mime: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHttpUrl(current);
    const response = await fetch(current, { redirect: "manual", signal }).catch((error: unknown) => {
      throw new RuntimeError(
        `Photo download failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new RuntimeError("Photo download redirect was missing a location");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      throw new RuntimeError(`Photo download failed (HTTP ${response.status})`);
    }
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
      throw new RuntimeError(
        `Photo download returned an unsupported image type (${mime || "unknown"})`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new RuntimeError("Photo download returned no data");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PHOTO_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new RuntimeError(`Photo is too large (over ${MAX_PHOTO_BYTES} bytes)`);
      }
      chunks.push(value);
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { data, mime };
  }
  throw new RuntimeError("Photo download exceeded the redirect limit");
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
