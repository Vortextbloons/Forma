import { z } from "zod";
import { RuntimeError, type RigTool, type ToolContext } from "rig";
import { loadExtraction } from "../extraction/index.ts";
import { FORMA_EVENTS } from "../forma/events.ts";
import { formaEnv, projectRuns } from "../forma/runtime.ts";
import { deletePage, pageRefs, readPage, restorePage, updatePage, writePage } from "../projects/pages.ts";
import { openProject, setOutline } from "../projects/store.ts";
import { effectiveSize } from "../projects/size.ts";
import type { ContextItem, ProjectFile } from "../projects/schema.ts";
import { resolveSearchSettings } from "../settings/search.ts";
import { getSearchDefaults } from "../settings/credentials.ts";
import { DESIGN_INSTRUCTIONS } from "../projects/design.ts";
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
  action: z.string().optional().describe("Recorded action id (from read_project); returns the full record including any script"),
  page: z.number().int().positive().optional().describe("PDF page number to read"),
  maxChars: z.number().int().positive().max(60_000).optional(),
  offset: z.number().int().nonnegative().optional().describe("Character offset within a specific page; use nextOffset to continue"),
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
  evidence: z.record(z.string(), z.string()).optional().describe("For required text sources: context id mapped to an exact excerpt shown in the artwork"),
});

const sourceEdits = z.array(z.object({ find: z.string().min(1), replace: z.string() })).min(1);

const sourcesRefreshed = z
  .record(z.string(), z.number())
  .optional()
  .describe(
    "After re-reading every material this out-of-date slide uses and confirming the artwork matches, pass their id → revision (from read_project) to clear the slide's out-of-date flag. The flag stays when a referenced material is missing, still out of date, or has been revised since the revision you list.",
  );

const updatePageInput = z.object({
  pageId: z.string().describe("Page id from read_project"),
  title: z.string().optional(),
  html: z.string().optional(),
  css: z.string().optional(),
  assets: z.array(z.string()).optional(),
  evidence: z.record(z.string(), z.string()).optional(),
  htmlEdits: sourceEdits.optional().describe("Exact unique find/replace edits to HTML; prefer for small changes"),
  cssEdits: sourceEdits.optional().describe("Exact unique find/replace edits to CSS; prefer for small changes"),
  sourcesRefreshed,
});

const pageIdInput = z.object({ pageId: z.string() });
const createPageInput = submitPageInput.omit({ html: true, css: true });
const writeFileInput = z.object({
  path: z.string().describe("Page source path from create_page or read_page"),
  content: z.string(),
  sourcesRefreshed,
});
const editFileInput = z.object({
  path: z.string().describe("Page source path from create_page or read_page"),
  edits: sourceEdits.describe("Exact unique find/replace edits read from the source file"),
  sourcesRefreshed,
});

export const projectTools: Array<RigTool<z.ZodTypeAny, unknown>> = [
  readProjectTool(),
  readContextTool(),
  submitOutlineTool(),
  submitPageTool(),
  createPageTool(),
  writeFileTool(),
  editFileTool(),
  updatePageTool(),
  restorePageTool(),
  deletePageTool(),
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
  return project.outline?.length ?? project.pages.length;
}

function contextSummary(item: ContextItem): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    role: item.role,
    mime: item.mime,
    path: item.asset,
    status: item.status,
    folder: item.folder || undefined,
    revision: item.revision,
    pages: item.extraction?.pages,
    data: item.data
      ? {
          format: item.data.format,
          truncated: item.data.truncated || undefined,
          sheets: item.data.sheets.map((sheet) => ({
            name: sheet.name,
            rows: sheet.rows,
            columns: sheet.columns.map((column) => `${column.name}:${column.type}`),
          })),
        }
      : undefined,
    derivedFrom: item.derivedFrom.length > 0 ? item.derivedFrom : undefined,
    stale: item.stale || undefined,
    error: item.error,
  };
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
          ...resolveSearchSettings(project.settings, await getSearchDefaults()),
          designProfile: project.settings.designProfile,
          designApproved: project.settings.designApproved,
          designName: project.settings.designName,
          designGuidelines: project.settings.designGuidelines,
        },
        ...(project.settings.designProfile ? { designInstructions: DESIGN_INSTRUCTIONS } : {}),
        pageSize: { width: size.width, height: size.height, unit: size.unit },
        outline: project.outline,
        pages: pageRefs(project).map((page) => ({
          ...page,
          files: sourceFiles(page.id),
          stale: project.pageMeta[page.id]?.stale || undefined,
        })),
        context: project.context.map(contextSummary),
        folders: project.folders,
        actions: project.actions.slice(-10).map((action) => ({
          id: action.id,
          kind: action.kind,
          label: action.label,
          inputs: action.inputs,
          outputs: action.outputs,
          detail: action.detail,
          hasScript: action.code !== undefined || undefined,
          createdAt: action.createdAt,
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
      "Read extracted text from a context item (PDF pages preserve page numbers), read a data material's profile (format, sheets, column types, preview rows), read a recorded action including any script, or list all context items when no id is given.",
    input: readContextInput,
    async execute(input, ctx) {
      const dir = dirOf(ctx);
      const project = await openProject(dir);
      if (input.action) {
        const action = project.actions.find((entry) => entry.id === input.action);
        if (!action) {
          throw new RuntimeError(`Unknown action "${input.action}"`, {
            details: { actionIds: project.actions.map((entry) => entry.id) },
          });
        }
        return action;
      }
      if (!input.id) {
        return {
          items: project.context.map(contextSummary),
        };
      }
      const item = project.context.find((entry) => entry.id === input.id);
      if (!item) {
        throw new RuntimeError(`Unknown context item "${input.id}"`, {
          details: { contextIds: project.context.map((entry) => entry.id) },
        });
      }
      if (item.data) {
        return {
          id: item.id,
          name: item.name,
          mime: item.mime,
          status: item.status,
          format: item.data.format,
          path: item.asset,
          truncated: item.data.truncated,
          derivedFrom: item.derivedFrom.length > 0 ? item.derivedFrom : undefined,
          stale: item.stale || undefined,
          sheets: item.data.sheets.map((sheet) => ({
            name: sheet.name,
            rows: sheet.rows,
            columns: sheet.columns.map((column) => `${column.name} (${column.type})`),
            preview: sheet.preview,
          })),
          note: "Only this profile is kept in context to avoid flooding it. The preview shows a few rows. To work with the full data, load the materials tools with load_tools and analyse the file with run_python.",
        };
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
      if (input.offset !== undefined && input.page === undefined) {
        throw new RuntimeError("Specify a page when using a character offset.");
      }
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
          ...textChunk(page.text, maxChars, input.offset ?? 0),
        };
      }
      let budget = maxChars;
      const pages = [];
      for (const page of extraction.pages) {
        if (budget <= 0) break;
        const chunk = textChunk(page.text, budget);
        const text = chunk.text;
        budget -= text.length;
        pages.push({ page: page.page, source: page.source, ...chunk });
      }
      return {
        id: item.id,
        name: item.name,
        kind: extraction.kind,
        totalPages: extraction.pages.length,
        truncated: pages.length < extraction.pages.length || pages.some((page) => page.truncated),
        next: pages.at(-1)?.truncated
          ? { page: pages.at(-1)!.page, offset: pages.at(-1)!.nextOffset }
          : pages.length < extraction.pages.length ? { page: extraction.pages[pages.length]!.page, offset: 0 } : undefined,
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
      const run = projectRuns.get(ctx.session.id);
      if (run?.allowedPageIds || run?.allowOutline === false) {
        throw new RuntimeError("This run cannot change the project outline. Revise it in a planning run first.");
      }
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
      if (!before.settings.designApproved) throw new RuntimeError("Propose a design and wait for approval before creating artwork.");
      assertPageScope(ctx, input.pageId ?? before.pages[input.index - 1] ?? before.outline?.[input.index - 1]?.id);
      const { project, pageId } = await writePage(dir, {
        pageId: input.pageId,
        index: input.index,
        title: input.title,
        html: input.html,
        css: input.css,
        assets: input.assets,
        evidence: input.evidence,
      });
      const index = project.pages.indexOf(pageId);
      if (run) run.artworkChanged = true;
      run?.changedPageIds?.add(pageId);
      const total = totalPages(project);
      ctx.progress.report({
        message: `Page ${index + 1}/${total} ready`,
        current: index + 1,
        total,
      });
      emit(
        FORMA_EVENTS.pageReady,
        { pageId, index: index + 1, total, title: project.pageMeta[pageId]?.title ?? input.title },
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
      "Replace parts of an existing page (html, css, title, or assets). Use for refinements; other pages stay untouched. When a page is marked out of date, rebuild its artwork from the current materials and pass sources_refreshed (id → revision from read_project) to clear the flag.",
    input: updatePageInput,
    async execute(input, ctx) {
      const run = projectRuns.get(ctx.session.id);
      if (run?.mode === "plan") throw new RuntimeError("Switch to Build to change artwork.");
      if (
        input.title === undefined &&
        input.html === undefined &&
        input.css === undefined &&
        input.assets === undefined &&
        input.evidence === undefined &&
        input.htmlEdits === undefined &&
        input.cssEdits === undefined &&
        input.sourcesRefreshed === undefined
      ) {
        throw new RuntimeError("update_page needs a title, source, targeted edit, assets, evidence, or refresh acknowledgement change");
      }
      assertPageScope(ctx, input.pageId);
      const dir = dirOf(ctx);
      const before = await openProject(dir);
      if (!before.settings.designApproved) throw new RuntimeError("Propose a design and wait for approval before changing artwork.");
      const { project, pageId } = await updatePage(dir, input.pageId, {
        title: input.title,
        html: input.html,
        css: input.css,
        assets: input.assets,
        evidence: input.evidence,
        htmlEdits: input.htmlEdits,
        cssEdits: input.cssEdits,
        acknowledgeSources: input.sourcesRefreshed,
      });
      if (run) run.artworkChanged = true;
      run?.changedPageIds?.add(pageId);
      const index = project.pages.indexOf(pageId);
      emit(
        FORMA_EVENTS.pageReady,
        {
          pageId,
          index: index + 1,
          total: totalPages(before),
          title: project.pageMeta[pageId]?.title ?? "",
        },
        ctx,
      );
      return {
        ok: true,
        pageId,
        index: index + 1,
        ...(input.sourcesRefreshed !== undefined ? { stale: project.pageMeta[pageId]?.stale || undefined } : {}),
      };
    },
  };
}

function deletePageTool(): RigTool<typeof pageIdInput, unknown> {
  return {
    name: "delete_page",
    description: "Delete a page and its source files. Remaining pages keep their order; their indexes shift up.",
    input: pageIdInput,
    async execute(input, ctx) {
      const run = projectRuns.get(ctx.session.id);
      if (run?.mode === "plan") throw new RuntimeError("Switch to Build to delete artwork.");
      assertPageScope(ctx, input.pageId);
      const project = await deletePage(dirOf(ctx), input.pageId);
      if (run) run.artworkChanged = true;
      emit(FORMA_EVENTS.pageDeleted, { pageId: input.pageId, total: project.pages.length }, ctx);
      return { ok: true, pageId: input.pageId, total: project.pages.length };
    },
  };
}

function sourceFiles(pageId: string): { html: string; css: string } {
  return { html: `pages/${pageId}.html`, css: `pages/${pageId}.css` };
}

function createPageTool(): RigTool<typeof createPageInput, unknown> {
  return {
    name: "create_page",
    description: "Create empty HTML and CSS source files for a new page in outline order. Write artwork into the returned files with write_file. For existing pages, read and edit their files instead.",
    input: createPageInput,
    async execute(input, ctx) {
      const project = await projectOf(ctx);
      if (project.pages.includes(input.pageId ?? project.pages[input.index - 1] ?? "")) {
        throw new RuntimeError("This page already exists. Read and edit its source files instead.");
      }
      const result = await submitPageTool().execute({ ...input, html: "", css: "" }, ctx) as { pageId: string };
      return { ...result, files: sourceFiles(result.pageId) };
    },
  };
}

async function sourceFile(path: string, ctx: ToolContext): Promise<{ pageId: string; source: "html" | "css" }> {
  const project = await projectOf(ctx);
  for (const pageId of project.pages) {
    const files = sourceFiles(pageId);
    for (const source of ["html", "css"] as const) {
      if (path === files[source]) return { pageId, source };
    }
  }
  throw new RuntimeError("Only registered page HTML and CSS files can be written. Use the paths from create_page or read_page.");
}

function writeFileTool(): RigTool<typeof writeFileInput, unknown> {
  return {
    name: "write_file",
    description: "Write a page's HTML or CSS source file. Saves the file, updates its preview, and preserves the previous version. Use edit_file for small changes. When refreshing an out-of-date page, pass sources_refreshed (id → revision from read_project) after re-reading its materials.",
    input: writeFileInput,
    async execute(input, ctx) {
      const { pageId, source } = await sourceFile(input.path, ctx);
      return updatePageTool().execute(
        {
          pageId,
          [source]: input.content,
          ...(input.sourcesRefreshed !== undefined ? { sourcesRefreshed: input.sourcesRefreshed } : {}),
        },
        ctx,
      );
    },
  };
}

function editFileTool(): RigTool<typeof editFileInput, unknown> {
  return {
    name: "edit_file",
    description: "Edit a page's HTML or CSS file with exact unique replacements, preserving the rest of the source. Read the file first. Saves the file and updates its preview. When refreshing an out-of-date page, pass sources_refreshed (id → revision from read_project) after re-reading its materials.",
    input: editFileInput,
    async execute(input, ctx) {
      const { pageId, source } = await sourceFile(input.path, ctx);
      return updatePageTool().execute(
        {
          pageId,
          [`${source}Edits`]: input.edits,
          ...(input.sourcesRefreshed !== undefined ? { sourcesRefreshed: input.sourcesRefreshed } : {}),
        },
        ctx,
      );
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
        evidence: meta?.evidence ?? {},
        stale: meta?.stale || undefined,
        files: sourceFiles(input.pageId),
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

function textChunk(text: string, max: number, offset = 0) {
  const end = Math.min(text.length, offset + max);
  return { text: text.slice(offset, end), offset, truncated: end < text.length, nextOffset: end < text.length ? end : undefined };
}

function assertPageScope(ctx: ToolContext, pageId: string | undefined): void {
  const allowed = projectRuns.get(ctx.session.id)?.allowedPageIds;
  if (allowed && (!pageId || !allowed.includes(pageId))) {
    throw new RuntimeError("This refinement can only change the selected page.", { details: { allowedPageIds: allowed } });
  }
}

function restorePageTool(): RigTool<typeof pageIdInput, unknown> {
  return {
    name: "restore_page",
    description: "Restore a page's previous source, title, assets, and evidence. The replaced version becomes the next restore point.",
    input: pageIdInput,
    async execute(input, ctx) {
      const run = projectRuns.get(ctx.session.id);
      if (run?.mode === "plan") throw new RuntimeError("Switch to Build to restore artwork.");
      assertPageScope(ctx, input.pageId);
      const { project, pageId } = await restorePage(dirOf(ctx), input.pageId);
      if (run) run.artworkChanged = true;
      run?.changedPageIds?.add(pageId);
      const index = project.pages.indexOf(pageId);
      emit(FORMA_EVENTS.pageReady, { pageId, index: index + 1, total: totalPages(project), title: project.pageMeta[pageId]?.title ?? "" }, ctx);
      return { ok: true, pageId, index: index + 1 };
    },
  };
}
