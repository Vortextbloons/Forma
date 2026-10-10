import { z } from "zod";
import { RuntimeError, type RigTool, type ToolContext } from "rig";
import { loadExtraction } from "../extraction/index.ts";
import { FORMA_EVENTS } from "../forma/events.ts";
import { formaEnv, projectRuns } from "../forma/runtime.ts";
import { pageRefs, readPage, updatePage, writePage } from "../projects/pages.ts";
import { openProject, setOutline } from "../projects/store.ts";
import { effectiveSize } from "../projects/size.ts";
import type { ProjectFile } from "../projects/schema.ts";
import { validateSinglePage } from "../rendering/validate.ts";

const outlineEntryInput = z.object({
  title: z.string().min(1).describe("Slide or poster headline"),
  points: z.array(z.string()).default([]).describe("Key points shown on the slide"),
  visualDirection: z
    .string()
    .optional()
    .describe("Short art-direction note for this slide"),
  assetIds: z
    .array(z.string())
    .default([])
    .describe("Context item ids assigned to this slide (from read_project)"),
});

const readContextInput = z.object({
  id: z.string().optional().describe("Context item id; omit to list all items"),
  page: z.number().int().positive().optional().describe("PDF page number to read"),
  maxChars: z.number().int().positive().max(60_000).optional(),
});

const submitOutlineInput = z.object({
  entries: z
    .array(outlineEntryInput)
    .min(1)
    .max(40)
    .describe("The full ordered outline, replacing any previous outline"),
});

const submitPageInput = z.object({
  index: z.number().int().positive().describe("1-based position; must follow the outline order"),
  pageId: z.string().optional().describe("Existing page id when regenerating a specific page"),
  title: z.string().default("").describe("Slide title"),
  html: z.string().min(1).describe("Artwork HTML fragment (no <script>)"),
  css: z.string().default("").describe("CSS scoped to this page"),
  assets: z.array(z.string()).default([]).describe("Context item ids used on this page"),
});

const updatePageInput = z.object({
  pageId: z.string().describe("Page id from read_project"),
  title: z.string().optional(),
  html: z.string().optional(),
  css: z.string().optional(),
  assets: z.array(z.string()).optional(),
});

const pageIdInput = z.object({ pageId: z.string() });

export const projectTools: Array<RigTool<z.ZodTypeAny, unknown>> = [
  readProjectTool(),
  readContextTool(),
  submitOutlineTool(),
  submitPageTool(),
  updatePageTool(),
  readPageTool(),
  inspectPageTool(),
];

function dirOf(ctx: ToolContext): string {
  return ctx.workspace.dir || ctx.workspace.root || process.cwd();
}

async function projectOf(ctx: ToolContext): Promise<ProjectFile> {
  return openProject(dirOf(ctx));
}

function emit(type: string, data: Record<string, unknown>, ctx: ToolContext): void {
  formaEnv()?.events.emit(type, data, ctx.session.id);
}

function totalPages(project: ProjectFile): number {
  if (project.settings.output === "poster") return 1;
  return project.outline?.length ?? project.settings.slideCount;
}

function readProjectTool(): RigTool<z.ZodTypeAny, unknown> {
  return {
    name: "read_project",
    description:
      "Read the current project: brief, design settings, outline, pages, and context item summaries. Call this before planning or generating.",
    input: z.object({}),
    async execute(_input, ctx) {
      const project = await projectOf(ctx);
      const size = effectiveSize(project.settings);
      return {
        name: project.name,
        brief: project.prompt,
        mode: project.mode,
        output: project.settings.output,
        settings: {
          style: project.settings.style,
          density: project.settings.density,
          slideCount: project.settings.slideCount,
          research: project.settings.research,
          imageSearch: project.settings.imageSearch,
        },
        pageSize: { width: size.width, height: size.height, unit: size.unit },
        outline: project.outline,
        pages: pageRefs(project),
        context: project.context.map((item) => ({
          id: item.id,
          name: item.name,
          role: item.role,
          mime: item.mime,
          path: item.asset,
          status: item.status,
          pages: item.extraction?.pages,
          error: item.error,
        })),
        sources: project.sources.map((source) => ({
          id: source.id,
          kind: source.kind,
          title: source.title,
          url: source.url,
        })),
      };
    },
  };
}

function readContextTool(): RigTool<typeof readContextInput, unknown> {
  return {
    name: "read_context",
    description:
      "Read extracted text from a context item (PDF pages preserve page numbers) or list all context items when no id is given.",
    input: readContextInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      const project = await openProject(dir);
      if (!input.id) {
        return {
          items: project.context.map((item) => ({
            id: item.id,
            name: item.name,
            role: item.role,
            mime: item.mime,
            status: item.status,
            extraction: item.extraction,
            error: item.error,
          })),
        };
      }
      const item = project.context.find((entry) => entry.id === input.id);
      if (!item) {
        throw new RuntimeError(`Unknown context item "${input.id}"`, {
          details: { contextIds: project.context.map((entry) => entry.id) },
        });
      }
      const extraction = await loadExtraction(dir, input.id);
      if (!extraction) {
        return {
          id: item.id,
          name: item.name,
          mime: item.mime,
          status: item.status,
          text: "",
          note:
            item.status === "processing"
              ? "Extraction is still running; try again shortly."
              : "No extracted text is available for this item.",
        };
      }
      const maxChars = input.maxChars ?? 20_000;
      if (input.page !== undefined) {
        const page = extraction.pages.find((entry) => entry.page === input.page);
        if (!page) {
          throw new RuntimeError(`"${item.name}" has no page ${input.page}`, {
            details: { pages: extraction.pages.length },
          });
        }
        return {
          id: item.id,
          name: item.name,
          page: page.page,
          totalPages: extraction.pages.length,
          source: page.source,
          text: truncate(page.text, maxChars),
        };
      }
      let budget = maxChars;
      const pages = [];
      for (const page of extraction.pages) {
        if (budget <= 0) break;
        const text = truncate(page.text, budget);
        budget -= text.length;
        pages.push({ page: page.page, source: page.source, text });
      }
      return {
        id: item.id,
        name: item.name,
        kind: extraction.kind,
        totalPages: extraction.pages.length,
        truncated: pages.length < extraction.pages.length,
        pages,
      };
    },
  };
}

function submitOutlineTool(): RigTool<typeof submitOutlineInput, unknown> {
  return {
    name: "submit_outline",
    description:
      "Submit the full ordered outline after planning. Replaces any previous outline. For posters submit exactly one composition brief entry.",
    input: submitOutlineInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      const project = await openProject(dir);
      if (project.settings.output === "poster" && input.entries.length !== 1) {
        throw new RuntimeError(
          `This is a poster project; submit_outline expects exactly one composition brief entry (got ${input.entries.length})`,
        );
      }
      const updated = await setOutline(
        dir,
        input.entries.map((entry) => ({
          title: entry.title,
          points: entry.points,
          visualDirection: entry.visualDirection,
          assetIds: entry.assetIds,
        })),
      );
      const outline = updated.outline ?? [];
      emit(FORMA_EVENTS.outlineReady, { outline }, ctx);
      return {
        ok: true,
        entries: outline.length,
        ids: outline.map((entry) => entry.id),
      };
    },
  };
}

function submitPageTool(): RigTool<typeof submitPageInput, unknown> {
  return {
    name: "submit_page",
    description:
      "Submit one finished page. Call once per slide (or once for a poster), in outline order. html is a fragment; css styles it; no JavaScript.",
    input: submitPageInput,
    async execute(input, ctx) {
      const run = projectRuns.get(ctx.session.id);
      if (run?.mode === "plan") throw new RuntimeError("Switch to Build to create artwork.");
      const dir = dirOf(ctx);
      const before = await openProject(dir);
      const { project, pageId } = await writePage(dir, {
        pageId: input.pageId,
        index: input.index,
        title: input.title,
        html: input.html,
        css: input.css,
        assets: input.assets,
      });
      const index = project.pages.indexOf(pageId);
      if (run) run.artworkChanged = true;
      const total = totalPages(before);
      ctx.progress.report({
        message: `Page ${index + 1}/${total} ready`,
        current: index + 1,
        total,
      });
      emit(
        FORMA_EVENTS.pageReady,
        { pageId, index, total, title: project.pageMeta[pageId]?.title ?? input.title },
        ctx,
      );
      return { ok: true, pageId, index: index + 1, total };
    },
  };
}

function updatePageTool(): RigTool<typeof updatePageInput, unknown> {
  return {
    name: "update_page",
    description:
      "Replace parts of an existing page (html, css, title, or assets). Use for refinements; other pages stay untouched.",
    input: updatePageInput,
    async execute(input, ctx) {
      const run = projectRuns.get(ctx.session.id);
      if (run?.mode === "plan") throw new RuntimeError("Switch to Build to change artwork.");
      if (
        input.title === undefined &&
        input.html === undefined &&
        input.css === undefined &&
        input.assets === undefined
      ) {
        throw new RuntimeError("update_page needs at least one of title, html, css, or assets");
      }
      const dir = dirOf(ctx);
      const before = await openProject(dir);
      const { project, pageId } = await updatePage(dir, input.pageId, {
        title: input.title,
        html: input.html,
        css: input.css,
        assets: input.assets,
      });
      if (run) run.artworkChanged = true;
      const index = project.pages.indexOf(pageId);
      emit(
        FORMA_EVENTS.pageReady,
        {
          pageId,
          index,
          total: totalPages(before),
          title: project.pageMeta[pageId]?.title ?? "",
        },
        ctx,
      );
      return { ok: true, pageId, index: index + 1 };
    },
  };
}

function readPageTool(): RigTool<typeof pageIdInput, unknown> {
  return {
    name: "read_page",
    description: "Read a page's current html, css, title, and assigned context item ids.",
    input: pageIdInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      const project = await openProject(dir);
      const meta = project.pageMeta[input.pageId];
      if (!project.pages.includes(input.pageId)) {
        throw new RuntimeError(`Unknown page "${input.pageId}"`, {
          details: { pageIds: project.pages },
        });
      }
      const source = await readPage(dir, input.pageId);
      return {
        pageId: input.pageId,
        index: project.pages.indexOf(input.pageId) + 1,
        title: meta?.title ?? "",
        assets: meta?.assets ?? [],
        html: source.html,
        css: source.css,
      };
    },
  };
}

function inspectPageTool(): RigTool<typeof pageIdInput, unknown> {
  return {
    name: "inspect_page",
    description:
      "Render a page in Chromium and report layout problems (missing assets, page-boundary overflow, clipped text). Use after generating or refining a page.",
    input: pageIdInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      const project = await openProject(dir);
      if (!project.pages.includes(input.pageId)) {
        throw new RuntimeError(`Unknown page "${input.pageId}"`, {
          details: { pageIds: project.pages },
        });
      }
      const report = await validateSinglePage(dir, project, input.pageId);
      return {
        pageId: input.pageId,
        issues: report.issues,
        renderError: report.renderError,
      };
    },
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
