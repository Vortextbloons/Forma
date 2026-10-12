import { z } from "zod";
import { RuntimeError, type RigTool, type ToolContext } from "rig";
import type { SimpleIcon } from "simple-icons";
import { importContextAsset } from "../projects/store.ts";

const findBrandIconInput = z.object({
  query: z.string().min(1).describe("Brand name or slug to search for"),
});

const importBrandIconInput = z.object({
  slug: z.string().min(1).describe("Brand slug from find_brand_icon"),
});

export const brandTools: Array<RigTool<z.ZodTypeAny, unknown>> = [
  findBrandIconTool(),
  importBrandIconTool(),
];

async function catalog(): Promise<SimpleIcon[]> {
  const icons = (await import("simple-icons")) as unknown as Record<string, SimpleIcon>;
  return Object.values(icons);
}

function dirOf(ctx: ToolContext): string {
  return ctx.workspace.dir || ctx.workspace.root || process.cwd();
}

function findBrandIconTool(): RigTool<typeof findBrandIconInput, unknown> {
  return {
    name: "find_brand_icon",
    description:
      "Search the local simple-icons catalog for single-color brand icons by name or slug. Returns names, slugs, and brand colors; import a match with import_brand_icon.",
    input: findBrandIconInput,
    async execute(input) {
      const query = input.query.trim().toLowerCase();
      if (!query) throw new RuntimeError("Give a brand name or slug to search for.");
      const exact: SimpleIcon[] = [];
      const partial: SimpleIcon[] = [];
      for (const icon of await catalog()) {
        const name = icon.title.toLowerCase();
        const slug = icon.slug.toLowerCase();
        if (name === query || slug === query) exact.push(icon);
        else if (name.includes(query) || slug.includes(query)) partial.push(icon);
      }
      return {
        query: input.query,
        results: [...exact, ...partial].slice(0, 5).map((icon) => ({
          name: icon.title,
          slug: icon.slug,
          color: `#${icon.hex}`,
        })),
      };
    },
  };
}

function importBrandIconTool(): RigTool<typeof importBrandIconInput, unknown> {
  return {
    name: "import_brand_icon",
    description:
      "Import a brand icon from simple-icons into the project as an optional SVG asset filled with the brand color. Use a slug from find_brand_icon; reference the returned asset path in artwork and record the context id in the page assets.",
    input: importBrandIconInput,
    async execute(input, ctx) {
      const slug = input.slug.trim().toLowerCase();
      const icon = (await catalog()).find((entry) => entry.slug.toLowerCase() === slug);
      if (!icon) {
        throw new RuntimeError(`No brand icon with slug "${input.slug}". Use find_brand_icon to search the catalog.`);
      }
      const { item } = await importContextAsset(dirOf(ctx), {
        name: `${icon.title} brand icon`,
        extension: ".svg",
        mime: "image/svg+xml",
        data: icon.svg.replace("<svg ", `<svg fill="#${icon.hex}" `),
        role: "optional",
      });
      return { contextId: item.id, name: item.name, asset: item.asset };
    },
  };
}