import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { atomicWriteFile } from "./atomic.ts";
import { defaultDesignProfile, designProfileSchema } from "./design.ts";
import { resolveDataDir } from "./home.ts";
import { DENSITIES, STYLES, nowIso, type ProjectSettings } from "./schema.ts";

const themeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
  style: z.enum(STYLES),
  density: z.enum(DENSITIES),
  designProfile: designProfileSchema,
  createdAt: z.string(),
});

export type DesignTheme = z.infer<typeof themeSchema>;

export async function listThemes(): Promise<DesignTheme[]> {
  const dir = join(resolveDataDir(), "themes");
  const files = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const themes = await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) =>
    themeSchema.parse(JSON.parse(await readFile(join(dir, file), "utf8"))),
  ));
  return themes.sort((a, b) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt));
}

export async function saveTheme(name: string, settings: ProjectSettings): Promise<DesignTheme> {
  const theme = themeSchema.parse({
    id: crypto.randomUUID(),
    name,
    style: settings.style,
    density: settings.density,
    designProfile: settings.designProfile ?? defaultDesignProfile(),
    createdAt: nowIso(),
  });
  const dir = join(resolveDataDir(), "themes");
  await mkdir(dir, { recursive: true });
  await atomicWriteFile(join(dir, `${theme.id}.json`), `${JSON.stringify(theme, null, 2)}\n`);
  return theme;
}
