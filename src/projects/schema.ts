import { z } from "zod";
import { RuntimeError } from "rig";
import { defaultDesignProfile, designProfileSchema } from "./design.ts";

export const PROJECT_FORMAT_VERSION = 1;
export const PROJECT_FILE = "project.json";

export const CONTEXT_ROLES = [
  "must-include",
  "style-reference",
  "content-source",
  "optional",
] as const;
export type ContextRole = (typeof CONTEXT_ROLES)[number];

export const OUTPUT_KINDS = ["slides", "poster"] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

export const STYLES = ["balance", "bold", "editorial"] as const;
export type StylePreset = (typeof STYLES)[number];

export const DENSITIES = ["balanced", "concise", "detailed"] as const;
export type Density = (typeof DENSITIES)[number];

export const PLAN_MODES = ["plan", "create"] as const;
export type PlanMode = (typeof PLAN_MODES)[number];

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const slideSizeSchema = z.object({
  preset: z.enum(["16:9", "4:3", "custom"]).default("16:9"),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
});

const posterSizeSchema = z.object({
  preset: z
    .enum(["1080x1350", "square", "a4", "a3", "letter", "tabloid", "custom"])
    .default("1080x1350"),
  width: z.number().positive().default(1080),
  height: z.number().positive().default(1350),
  unit: z.enum(["px", "mm", "in"]).default("px"),
});

const styleSchema = z.preprocess(
  (v) => (v === "minimal" ? "balance" : v),
  z.enum(STYLES).default("balance"),
);

export const projectSettingsSchema = z.object({
  output: z.enum(OUTPUT_KINDS).default("slides"),
  style: styleSchema,
  density: z.enum(DENSITIES).default("balanced"),
  slideCount: z.number().int().positive().default(8),
  slideSize: slideSizeSchema.default({}),
  posterKind: z.enum(["digital", "print"]).default("digital"),
  posterSize: posterSizeSchema.default({}),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  research: z.boolean().nullable().default(null),
  imageSearch: z.boolean().nullable().default(null),
  designProfile: designProfileSchema.optional(),
  designApproved: z.boolean().default(true),
  designName: z.string().trim().default("Custom"),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export const CONTEXT_STATUSES = ["ready", "processing", "error"] as const;
export type ContextStatus = (typeof CONTEXT_STATUSES)[number];

export const EXTRACTION_KINDS = ["text", "ocr", "mixed"] as const;

export const contextItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(CONTEXT_ROLES),
  asset: z.string(),
  mime: z.string().default("application/octet-stream"),
  size: z.number().int().nonnegative().default(0),
  status: z.enum(CONTEXT_STATUSES).default("ready"),
  extraction: z
    .object({
      kind: z.enum(EXTRACTION_KINDS),
      pages: z.number().int().nonnegative(),
      chars: z.number().int().nonnegative(),
    })
    .optional(),
  error: z.string().optional(),
  sourceId: z.string().optional(),
  createdAt: z.string(),
});

export type ContextItem = z.infer<typeof contextItemSchema>;

export const sourceRecordSchema = z.object({
  id: z.string(),
  kind: z.enum(["research", "photo"]),
  title: z.string(),
  url: z.string().optional(),
  provider: z.string().optional(),
  author: z.string().optional(),
  authorUrl: z.string().optional(),
  query: z.string().optional(),
  licenseStatus: z.enum(["unverified"]).optional(),
  createdAt: z.string(),
});

export type SourceRecord = z.infer<typeof sourceRecordSchema>;

export const outlineEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  points: z.array(z.string()).default([]),
  visualDirection: z.string().optional(),
  assetIds: z.array(z.string()).default([]),
});

export type OutlineEntry = z.infer<typeof outlineEntrySchema>;

export const projectPreferencesSchema = z.object({
  model: z.string().default("auto"),
  thinkingLevel: z.enum(THINKING_LEVELS).default("medium"),
  zoom: z.union([z.number().positive(), z.literal("fit")]).default("fit"),
});

export type ProjectPreferences = z.infer<typeof projectPreferencesSchema>;

export const pageMetaSchema = z.object({
  title: z.string().default(""),
  assets: z.array(z.string()).default([]),
  evidence: z.record(z.string(), z.string()).optional(),
  updatedAt: z.string().optional(),
});

export type PageMeta = z.infer<typeof pageMetaSchema>;

export const projectFileSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  id: z.string(),
  name: z.string(),
  prompt: z.string().default(""),
  mode: z.enum(PLAN_MODES).default("plan"),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: projectSettingsSchema.default({}),
  settingsRevision: z.number().int().nonnegative().default(0),
  artworkRevision: z.number().int().min(-1).default(-1),
  outline: z.array(outlineEntrySchema).nullable().default(null),
  pages: z.array(z.string()).default([]),
  pageMeta: z.record(z.string(), pageMetaSchema).default({}),
  context: z.array(contextItemSchema).default([]),
  sources: z.array(sourceRecordSchema).default([]),
  conversation: z
    .object({
      sessionIds: z.array(z.string()).default([]),
    })
    .default({}),
  preferences: projectPreferencesSchema.default({}),
});

export type ProjectFile = z.infer<typeof projectFileSchema>;

export function newProjectId(): string {
  return `prj_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function newContextId(): string {
  return `ctx_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function newPageId(): string {
  return `pg_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function newSourceId(): string {
  return `src_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function defaultSettings(output: OutputKind = "slides"): ProjectSettings {
  return projectSettingsSchema.parse({ output, designProfile: defaultDesignProfile() });
}

export function deriveProjectName(prompt: string): string {
  const firstLine = prompt
    .split("\n")
    .map((line) => line.replace(/^[#>\-*\s]+/, "").trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "Untitled project";
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
}

export function parseProjectFile(raw: unknown, file: string): ProjectFile {
  const parsed = projectFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RuntimeError(`Invalid project file "${file}": ${parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ")}`);
  }
  return parsed.data;
}

export { effectiveSize, type EffectiveSize } from "./size.ts";
