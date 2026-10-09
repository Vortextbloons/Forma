import type {
  ContextItem,
  ContextRole,
  Density,
  OutputKind,
  ProjectFile,
  ProjectSettings,
  StylePreset,
} from "../../../../src/projects/schema.ts";

export type {
  ContextItem,
  ContextRole,
  Density,
  OutputKind,
  ProjectFile,
  ProjectSettings,
  StylePreset,
};

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

export const CONTEXT_ROLE_OPTIONS: readonly ContextRole[] = [
  "must-include",
  "style-reference",
  "content-source",
  "optional",
];

export const CONTEXT_ROLE_LABELS: Record<ContextRole, string> = {
  "must-include": "Must Include",
  "style-reference": "Style Reference",
  "content-source": "Content Source",
  optional: "Optional",
};

export const STYLE_LABELS: Record<StylePreset, string> = {
  minimal: "Minimal",
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
