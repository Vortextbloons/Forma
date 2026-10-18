import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { RuntimeError, type RigTool, type ToolContext } from "rig";
import { atomicWriteFile } from "../projects/atomic.ts";
import { defaultDesignProfile, fontStack, type DesignProfile } from "../projects/design.ts";
import { openProject, recordAction, saveGeneratedMaterial, updateProject } from "../projects/store.ts";
import { launchBrowser } from "../rendering/browser.ts";

const createDiagramInput = z.object({
  name: z.string().trim().min(1).describe("Diagram name, for example Order fulfilment flow"),
  mermaid: z.string().trim().min(1).describe("Mermaid diagram source, for example flowchart TD; A[Start] --> B[End]"),
  resultId: z
    .string()
    .optional()
    .describe("Existing diagram result id (from read_project) to refresh in place; the new SVG is saved as a new version and pages referencing this result must be refreshed"),
  sources: z
    .array(z.string())
    .default([])
    .describe("Material ids the diagram was built from, so the diagram is linked to its sources and flagged when they change"),
});

export const diagramTools: Array<RigTool<z.ZodTypeAny, unknown>> = [
  createDiagramTool(),
];

interface MermaidGlobal {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

function dirOf(ctx: ToolContext): string {
  return ctx.workspace.dir || ctx.workspace.root || process.cwd();
}

function themeVariablesOf(profile: DesignProfile): Record<string, string> {
  const colors = profile.colors;
  return {
    background: colors.background,
    primaryColor: colors.surface,
    secondaryColor: colors.surface,
    tertiaryColor: colors.background,
    primaryTextColor: colors.text,
    secondaryTextColor: colors.text,
    tertiaryTextColor: colors.muted,
    primaryBorderColor: colors.accent,
    secondaryBorderColor: colors.accent,
    tertiaryBorderColor: colors.muted,
    lineColor: colors.muted,
    textColor: colors.text,
    mainBkg: colors.surface,
    nodeBorder: colors.accent,
    clusterBkg: colors.background,
    clusterBorder: colors.muted,
    edgeLabelBackground: colors.background,
    noteBkgColor: colors.surface,
    noteTextColor: colors.text,
    noteBorderColor: colors.muted,
    fontFamily: fontStack(profile.fonts.body),
  };
}

async function renderDiagram(source: string, themeVariables: Record<string, string>): Promise<string> {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (request) => void request.abort().catch(() => undefined));
    const bundle = await readFile(new URL("./mermaid.min.js", import.meta.url), "utf8");
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>body { margin: 0; }</style></head><body><script>${bundle.replace(/<\/script/gi, "<\\/script")}</script></body></html>`,
      { waitUntil: "load" },
    );
    return await page.evaluate(async ({ source, theme }) => {
      const mermaid = (globalThis as { mermaid?: MermaidGlobal }).mermaid;
      if (!mermaid) throw new Error("Mermaid failed to load");
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, theme: "base", themeVariables: theme });
      const rendered = await mermaid.render("forma-diagram", source);
      return rendered.svg;
    }, { source, theme: themeVariables });
  } finally {
    await page.close().catch(() => undefined);
  }
}

function createDiagramTool(): RigTool<typeof createDiagramInput, unknown> {
  return {
    name: "create_diagram",
    description:
      "Render a Mermaid diagram to a static SVG asset. Pass Mermaid source for flowcharts, sequence, timeline, mindmap, state, class, ER, or gantt diagrams; interactive features and external assets are not supported. The SVG is themed with the approved design palette and fonts automatically. Pass resultId with an existing diagram id to rebuild that result in place (saved as a new version) instead of leaving a stale duplicate. Example: { name: \"Order fulfilment flow\", mermaid: \"flowchart TD\\n  A[Order] --> B{Paid?}\\n  B -->|yes| C[Ship]\" }. Reference the returned asset path in artwork and record the context id in the page assets. The Mermaid source is saved next to the SVG; read that path to revise the diagram later. Pass sources: [\"ctx_ab12cd34ef56\"] to link the diagram to the materials it was built from.",
    input: createDiagramInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      const profile = (await openProject(dir)).settings.designProfile ?? defaultDesignProfile();
      let svg: string;
      try {
        svg = await renderDiagram(input.mermaid, themeVariablesOf(profile));
      } catch (error) {
        throw new RuntimeError(
          `The diagram could not be rendered: ${error instanceof Error ? error.message : String(error)}. Check the Mermaid source for syntax errors.`,
        );
      }
      if (!svg.startsWith("<svg")) {
        throw new RuntimeError("The diagram could not be rendered: Mermaid returned an empty result. Check the Mermaid source.");
      }
      const { item } = await saveGeneratedMaterial(dir, {
        ...(input.resultId ? { id: input.resultId } : {}),
        name: input.name,
        extension: ".svg",
        mime: "image/svg+xml",
        data: svg,
        derivedFrom: input.sources,
      });
      const source = item.revision > 1 ? `assets/${item.id}.v${item.revision}.mmd` : `assets/${item.id}.mmd`;
      await atomicWriteFile(join(resolve(dir), source), `${input.mermaid.trim()}\n`);
      await updateProject(dir, (current) => {
        recordAction(current, {
          kind: "derive",
          label: `${input.resultId ? "Rebuilt" : "Built"} diagram "${input.name}"`,
          inputs: input.sources,
          outputs: [item.id],
        });
      });
      return { contextId: item.id, name: item.name, asset: item.asset, source };
    },
  };
}