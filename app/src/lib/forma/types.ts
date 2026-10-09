import type {
  ContextItem,
  ContextRole,
  Density,
  OutputKind,
  ProjectFile,
  ProjectSettings,
  StylePreset,
} from "../../../../src/projects/schema.ts";
import type { RecentProject } from "../../../../src/projects/recent.ts";

export type {
  ContextItem,
  ContextRole,
  Density,
  OutputKind,
  ProjectFile,
  ProjectSettings,
  RecentProject,
  StylePreset,
};

export interface ProjectSnapshot {
  dir: string;
  project: ProjectFile;
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

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
