import type { OutputKind, ProjectSettings } from "./types";

export function defaultProjectSettings(output: OutputKind = "slides"): ProjectSettings {
  return {
    output,
    style: "minimal",
    density: "balanced",
    slideCount: 8,
    slideSize: { preset: "16:9", width: 1920, height: 1080 },
    posterKind: "digital",
    posterSize: { preset: "1080x1350", width: 1080, height: 1350, unit: "px" },
    orientation: "portrait",
    research: false,
    imageSearch: false,
  };
}
