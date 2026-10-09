import { effectiveSize } from "../../../../src/projects/size.ts";
import type { ProjectSettings } from "./types.ts";

export function formatDimensions(settings: ProjectSettings): string {
  const size = effectiveSize(settings);
  if (size.unit === "px") return `${size.width} × ${size.height}`;
  const width = Number.isInteger(size.width) ? String(size.width) : size.width.toFixed(1);
  const height = Number.isInteger(size.height) ? String(size.height) : size.height.toFixed(1);
  return `${width} × ${height} ${size.unit}`;
}
