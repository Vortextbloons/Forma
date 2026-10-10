import type {
  ContextItem,
  ContextRole,
  Density,
  OutputKind,
  PageMeta,
  ProjectFile,
  ProjectPreferences,
  ProjectSettings,
  SourceRecord,
  StylePreset,
} from "../../../../src/projects/schema.ts";
import type { ExtractedPage } from "../../../../src/extraction/types.ts";
import type { StoredExtraction } from "../../../../src/extraction/index.ts";
import type { ExportFormat, ExportResult } from "../../../../src/rendering/export.ts";
import type { ValidationIssue, ValidationReport } from "../../../../src/rendering/validate.ts";
import type { SearchCredentialStatus, SearchProviderId } from "../../../../src/settings/credentials.ts";

export type {
  ContextItem,
  ContextRole,
  Density,
  OutputKind,
  PageMeta,
  ProjectFile,
  ProjectPreferences,
  ProjectSettings,
  SourceRecord,
  StylePreset,
  ExtractedPage,
  ExportFormat,
  ExportResult,
  SearchCredentialStatus,
  SearchProviderId,
  StoredExtraction,
  ValidationIssue,
  ValidationReport,
};

export type ExportScope = "all" | "selected" | "poster";

export interface ExportRunState {
  runId: string;
  format: ExportFormat;
  total: number;
  completed: number;
  startedAt: string;
}

export function parseExportFiles(value: unknown): string[] | null {
  const files = (value as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) return null;
  return files as string[];
}

export interface FormaRunState {
  kind: "outline" | "artwork" | "refine" | "design";
  total: number;
  completed: number;
  startedAt: string;
}

export interface ProjectSnapshot {
  dir: string;
  project: ProjectFile;
}

export interface ProjectListEntry {
  dir: string;
  project: ProjectFile;
}

export interface ProjectLibrary {
  home: string;
  projects: ProjectListEntry[];
}

export const CONTEXT_ROLE_LABELS: Record<ContextRole, string> = {
  "must-include": "Must Include",
  "style-reference": "Style Reference",
  "content-source": "Content Source",
  optional: "Optional",
};

export const STYLE_LABELS: Record<StylePreset, string> = {
  balance: "Balance",
  bold: "Bold",
  editorial: "Editorial",
};

export const DENSITY_LABELS: Record<Density, string> = {
  balanced: "Balanced",
  concise: "Concise",
  detailed: "Detailed",
};

export const OUTPUT_LABELS: Record<OutputKind, string> = {
  slides: "Slides",
  poster: "Poster",
};

export function parseProjectSnapshot(data: unknown): ProjectSnapshot {
  const record = (data ?? {}) as { project?: { dir?: unknown; project?: unknown } };
  const dir = typeof record.project?.dir === "string" ? record.project.dir : "";
  const project = record.project?.project as ProjectFile | undefined;
  if (!dir || !project || project.formatVersion !== 1 || !Array.isArray(project.context)) {
    throw new Error("The worker returned a malformed project payload");
  }
  return { dir, project };
}

export function parseProjectEntry(value: unknown): ProjectListEntry | null {
  const record = (value ?? {}) as { dir?: unknown; project?: unknown };
  const dir = typeof record.dir === "string" ? record.dir : "";
  const project = record.project as ProjectFile | undefined;
  if (!dir || !project || project.formatVersion !== 1 || !Array.isArray(project.context)) {
    return null;
  }
  return { dir, project };
}

export function parseProjectLibrary(data: unknown): ProjectLibrary {
  const record = (data ?? {}) as { home?: unknown; projects?: unknown };
  const home = typeof record.home === "string" ? record.home : "";
  const projects = Array.isArray(record.projects)
    ? record.projects
        .map(parseProjectEntry)
        .filter((entry): entry is ProjectListEntry => entry !== null)
    : [];
  return { home, projects };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function parseValidationReport(value: unknown): ValidationReport | null {
  const report = (value as { report?: unknown } | null)?.report as ValidationReport | undefined;
  if (!report || !Array.isArray(report.issues)) return null;
  return report;
}

export function parseSearchCredentials(
  value: unknown,
): Record<SearchProviderId, SearchCredentialStatus> | null {
  const credentials = (value as { credentials?: unknown } | null)?.credentials as
    | Record<SearchProviderId, SearchCredentialStatus>
    | undefined;
  if (!credentials || typeof credentials.exa?.configured !== "boolean") return null;
  return credentials;
}

export function parseStoredExtraction(value: unknown): StoredExtraction | null {
  const extraction = (value as { extraction?: unknown } | null)?.extraction as
    | StoredExtraction
    | null
    | undefined;
  if (!extraction || !Array.isArray(extraction.pages)) return null;
  return extraction;
}
