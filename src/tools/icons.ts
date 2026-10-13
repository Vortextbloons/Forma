import { z } from "zod";
import { RuntimeError, type RigTool, type ToolContext } from "rig";
import { importContextAsset } from "../projects/store.ts";

const findIconInput = z.object({
  query: z.string().min(1).describe("Icon name or slug to search for"),
});

const importIconInput = z.object({
  slug: z.string().min(1).describe("Icon slug from find_icon"),
  color: z.string().trim().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i, "Use a hex color such as #8032a8").default("#111827").describe("Stroke color as a hex value"),
  strokeWidth: z.number().min(0).max(12).default(2).describe("Stroke width"),
});

export const iconTools: Array<RigTool<z.ZodTypeAny, unknown>> = [
  findIconTool(),
  importIconTool(),
];

interface LucideIcon {
  name: string;
  slug: string;
  svg: string;
}

async function catalog(): Promise<LucideIcon[]> {
  const icons = (await import("lucide-static")) as unknown as Record<string, string>;
  const bySlug = new Map<string, LucideIcon>();
  for (const svg of Object.values(icons)) {
    if (typeof svg !== "string") continue;
    const slug = svg.match(/class="lucide lucide-([a-z0-9-]+)"/)?.[1];
    if (slug && !bySlug.has(slug)) bySlug.set(slug, { name: titleCase(slug), slug, svg });
  }
  return [...bySlug.values()];
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function dirOf(ctx: ToolContext): string {
  return ctx.workspace.dir || ctx.workspace.root || process.cwd();
}

function findIconTool(): RigTool<typeof findIconInput, unknown> {
  return {
    name: "find_icon",
    description:
      "Search the local Lucide icon catalog for single-color UI icons by name or slug. Returns names and slugs; import a match with import_icon.",
    input: findIconInput,
    async execute(input) {
      const query = input.query.trim().toLowerCase();
      if (!query) throw new RuntimeError("Give an icon name or slug to search for.");
      const exact: LucideIcon[] = [];
      const partial: LucideIcon[] = [];
      for (const icon of await catalog()) {
        if (icon.slug === query || icon.name.toLowerCase() === query) exact.push(icon);
        else if (icon.slug.includes(query) || icon.name.toLowerCase().includes(query)) partial.push(icon);
      }
      return {
        query: input.query,
        results: [...exact, ...partial].slice(0, 5).map(({ name, slug }) => ({ name, slug })),
      };
    },
  };
}

function importIconTool(): RigTool<typeof importIconInput, unknown> {
  return {
    name: "import_icon",
    description:
      "Import a Lucide icon into the project as an optional SVG asset with the given stroke color and width. Use a slug from find_icon; reference the returned asset path in artwork and record the context id in the page assets.",
    input: importIconInput,
    async execute(input, ctx) {
      const slug = input.slug.trim().toLowerCase();
      const icon = (await catalog()).find((entry) => entry.slug === slug);
      if (!icon) {
        throw new RuntimeError(`No icon with slug "${input.slug}". Use find_icon to search the catalog.`);
      }
      const svg = icon.svg
        .trim()
        .replace('stroke="currentColor"', `stroke="${input.color}"`)
        .replace('stroke-width="2"', `stroke-width="${input.strokeWidth}"`);
      const { item } = await importContextAsset(dirOf(ctx), {
        name: `${icon.name} icon`,
        extension: ".svg",
        mime: "image/svg+xml",
        data: svg,
        role: "optional",
      });
      return { contextId: item.id, name: item.name, asset: item.asset };
    },
  };
}
