import { z } from "zod";
import type { ProjectSettings } from "../projects/schema.ts";

export const searchDefaultsSchema = z.object({
  research: z.boolean().default(false),
  imageSearch: z.boolean().default(false),
});

export type SearchDefaults = z.infer<typeof searchDefaultsSchema>;

export function resolveSearchSettings(settings: Pick<ProjectSettings, "research" | "imageSearch">, defaults: SearchDefaults): SearchDefaults {
  return {
    research: settings.research ?? defaults.research,
    imageSearch: settings.imageSearch ?? defaults.imageSearch,
  };
}

