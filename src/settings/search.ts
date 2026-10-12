import { z } from "zod";
import type { ProjectSettings } from "../projects/schema.ts";

export const RESEARCH_PROVIDERS = ["ddgs", "exa"] as const;
export const IMAGE_PROVIDERS = ["ddgs", "pexels"] as const;

export const searchDefaultsSchema = z.object({
  research: z.boolean().default(false),
  imageSearch: z.boolean().default(false),
  researchProvider: z.enum(RESEARCH_PROVIDERS).default("ddgs"),
  imageProvider: z.enum(IMAGE_PROVIDERS).default("ddgs"),
});

export type SearchDefaults = z.infer<typeof searchDefaultsSchema>;
export type ResearchProviderId = (typeof RESEARCH_PROVIDERS)[number];
export type ImageProviderId = (typeof IMAGE_PROVIDERS)[number];

export function resolveSearchSettings(
  settings: Pick<ProjectSettings, "research" | "imageSearch">,
  defaults: SearchDefaults,
): SearchDefaults {
  return {
    research: settings.research ?? defaults.research,
    imageSearch: settings.imageSearch ?? defaults.imageSearch,
    researchProvider: defaults.researchProvider,
    imageProvider: defaults.imageProvider,
  };
}
