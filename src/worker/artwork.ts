import { z } from "zod";
import { createHash } from "node:crypto";
import formaAgent from "../agent.ts";
import { CancellationError, ModelError, ProtocolError, RuntimeError, serializeError } from "rig";
import type { WorkerResult } from "rig/ipc";
import { FORMA_EVENTS } from "../forma/events.ts";
import { applyDesignPrompt, generatePrompt, planPrompt, refinePrompt } from "../forma/prompts.ts";
import { collectVisualReferences, normalizePromptImages, viewArtworkTool, viewImageTool, IMAGES_UNSUPPORTED, MAX_IMAGES, type PromptImage, type VisualReferences } from "../forma/visuals.ts";
import { projectRuns, type ProjectRun } from "../forma/runtime.ts";
import { loadedGroupTools, prepareSessionTools } from "../tools/lazy.ts";
import { deletePage, duplicatePage, movePage, readPage, restorePage, updatePage } from "../projects/pages.ts";
import { effectiveSize } from "../projects/size.ts";
import { openProject, setOutline, updateProject } from "../projects/store.ts";
import { composePage } from "../rendering/compose.ts";
import { validateProject, type ValidationReport } from "../rendering/validate.ts";
import type { ProjectFile } from "../projects/schema.ts";
import { resolveSearchSettings } from "../settings/search.ts";
import { getSearchDefaults } from "../settings/credentials.ts";
import { designGuidelineInstructions, DESIGN_INSTRUCTIONS } from "../projects/design.ts";
import { resultErr, resultOk } from "./results.ts";
import type { CommandHandler, WorkerContext } from "./commands.ts";

type RunKind = "outline" | "artwork" | "refine" | "design";

const outlineInputSchema = z.array(
  z.object({
    id: z.string().optional(),
    title: z.string(),
    points: z.array(z.string()).default([]),
    visualDirection: z.string().optional(),
    assetIds: z.array(z.string()).default([]),
  }),
);

export function createArtworkHandlers(ctx: WorkerContext): Record<string, CommandHandler> {
  const ok = (data?: unknown): WorkerResult => resultOk("", data);
  let editableSave: Promise<unknown> = Promise.resolve();

  return {
    async "artwork.plan"(params) {
      const dir = asString(params.dir, "dir");
      const project = await openProject(dir);
      const images = await collectVisualReferences(dir, project);
      const result = await runArtwork(ctx, {
        kind: "outline",
        dir,
        sessionId: asOptionalString(params.sessionId),
        model: asOptionalString(params.model),
        prompt: planPrompt(project),
        mode: "plan",
        references: images,
        imageMode: "required",
      });
      if (!result.ok) return result;
      return ok({ project: await freshProject(dir) });
    },

    async "artwork.generate"(params) {
      const dir = asString(params.dir, "dir");
      const project = await openProject(dir);
      const images = await collectVisualReferences(dir, project);
      const result = await runArtwork(ctx, {
        kind: "artwork",
        dir,
        sessionId: asOptionalString(params.sessionId),
        model: asOptionalString(params.model),
        prompt: generatePrompt(project),
        mode: "build",
        references: images,
        imageMode: "required",
      });
      if (!result.ok) return result;
      return ok({ project: await freshProject(dir) });
    },

    async "artwork.refine"(params) {
      const dir = asString(params.dir, "dir");
      const project = await openProject(dir);
      const scope = asString(params.scope, "scope");
      if (scope !== "page" && scope !== "project") {
        throw new ProtocolError(`Invalid refinement scope "${scope}"`);
      }
      const pageId = asOptionalString(params.pageId);
      if (scope === "page" && (!pageId || !project.pages.includes(pageId))) {
        throw new RuntimeError(`Unknown page "${pageId ?? ""}"`, {
          details: { pageIds: project.pages },
        });
      }
      const chatImages = await normalizePromptImages(params.images);
      const message = asOptionalString(params.message) ?? "";
      if (!message && chatImages.length === 0) {
        throw new ProtocolError(`Missing or invalid parameter "message" (expected non-empty string)`);
      }
      const element = params.element === undefined ? undefined : z.object({
        selector: z.string().min(1).max(2000),
        html: z.string().max(4000),
        text: z.string().max(160),
      }).parse(params.element);
      if (element && scope !== "page") throw new ProtocolError("Element feedback requires a page target");
      const mode = asOptionalString(params.mode) ?? "build";
      if (mode !== "plan" && mode !== "build") {
        throw new ProtocolError(`Invalid refinement mode "${mode}"`);
      }
      const images = await collectVisualReferences(
        dir,
        project,
        scope === "page" ? pageId : undefined,
        Math.max(0, MAX_IMAGES - chatImages.length),
      );
      const result = await runArtwork(ctx, {
        kind: "refine",
        dir,
        sessionId: asOptionalString(params.sessionId),
        model: asOptionalString(params.model),
        prompt: refinePrompt(project, scope, pageId, message, mode, element),
        mode,
        references: images,
        chatImages,
        allowedPageIds: scope === "page" && pageId ? [pageId] : undefined,
        imageMode: "optional",
      });
      if (!result.ok) return result;
      return ok({ project: await freshProject(dir) });
    },

    async "artwork.applyDesign"(params) {
      const dir = asString(params.dir, "dir");
      const project = await openProject(dir);
      const images = await collectVisualReferences(dir, project);
      const result = await runArtwork(ctx, {
        kind: "design",
        dir,
        sessionId: asOptionalString(params.sessionId),
        model: asOptionalString(params.model),
        prompt: applyDesignPrompt(project),
        mode: "build",
        references: images,
        imageMode: "optional",
      });
      if (!result.ok) return result;
      return ok({ project: await freshProject(dir) });
    },

    async "artwork.updateOutline"(params) {
      const dir = asString(params.dir, "dir");
      const parsed = outlineInputSchema.safeParse(params.outline);
      if (!parsed.success) {
        throw new ProtocolError(
          `Invalid outline: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
        );
      }
      const project = await setOutline(dir, parsed.data);
      return ok({ project: { dir, project } });
    },

    async "artwork.reorder"(params) {
      const dir = asString(params.dir, "dir");
      const pageId = asString(params.pageId, "pageId");
      const toIndex = asNumber(params.toIndex, "toIndex");
      const project = await movePage(dir, pageId, toIndex);
      return ok({ project: { dir, project } });
    },

    async "artwork.duplicate"(params) {
      const dir = asString(params.dir, "dir");
      const pageId = asString(params.pageId, "pageId");
      const result = await duplicatePage(dir, pageId);
      return ok({ project: { dir, project: result.project }, pageId: result.pageId });
    },

    async "artwork.delete"(params) {
      const dir = asString(params.dir, "dir");
      const pageId = asString(params.pageId, "pageId");
      const project = await deletePage(dir, pageId);
      return ok({ project: { dir, project } });
    },

    async "artwork.restore"(params) {
      const dir = asString(params.dir, "dir");
      const { project, pageId } = await restorePage(dir, asString(params.pageId, "pageId"));
      return ok({ project: { dir, project }, pageId });
    },

    async "artwork.compose"(params) {
      const dir = asString(params.dir, "dir");
      const pageId = asString(params.pageId, "pageId");
      const project = await openProject(dir);
      if (!project.pages.includes(pageId)) {
        throw new RuntimeError(`Unknown page "${pageId}"`, { details: { pageIds: project.pages } });
      }
      const size = effectiveSize(project.settings);
      const composed = await composePage(dir, pageId, size, { inlineAssets: true });
      return ok({ html: composed.html, missing: composed.missing });
    },

    async "artwork.readEditable"(params) {
      const dir = asString(params.dir, "dir");
      const pageId = asString(params.pageId, "pageId");
      const project = await openProject(dir);
      if (!project.pages.includes(pageId)) {
        throw new RuntimeError(`Unknown page "${pageId}"`, { details: { pageIds: project.pages } });
      }
      const source = await readPage(dir, pageId);
      return ok({ html: source.html, css: source.css, revision: sourceRevision(source) });
    },

    async "artwork.saveEditable"(params) {
      const save = editableSave.then(async () => {
        const dir = asString(params.dir, "dir");
        const pageId = asString(params.pageId, "pageId");
        const html = asString(params.html, "html");
        const css = typeof params.css === "string" ? params.css : "";
        const revision = asString(params.revision, "revision");
        if (projectRuns.size > 0) {
          throw new RuntimeError("Forma is generating artwork. Try again when the run finishes.", {
            details: { reason: "ai-running" },
          });
        }
        const project = await openProject(dir);
        if (!project.pages.includes(pageId)) {
          throw new RuntimeError(`Unknown page "${pageId}"`, { details: { pageIds: project.pages } });
        }
        const source = await readPage(dir, pageId);
        if (sourceRevision(source) !== revision) {
          throw new RuntimeError("This page changed outside the editor. Retry the save or discard the draft.", {
            details: { reason: "stale-revision" },
          });
        }
        await updatePage(dir, pageId, { html, css, keepArtworkCurrent: true });
        return ok({
          project: { dir, project: await openProject(dir) },
          revision: sourceRevision(await readPage(dir, pageId)),
        });
      });
      editableSave = save.catch(() => undefined);
      return save;
    },

    async "rendering.validate"(params) {
      const dir = asString(params.dir, "dir");
      const project = await openProject(dir);
      const report = await validateProject(dir, project);
      ctx.formaEvents.emit(FORMA_EVENTS.validationReady, {
        issues: report.issues,
        pages: report.pages,
        ...(report.renderError ? { renderError: report.renderError } : {}),
      });
      return ok({ report });
    },
  };
}

interface ArtworkRunOptions {
  kind: RunKind;
  dir: string;
  sessionId?: string;
  model?: string;
  prompt: string;
  mode: "plan" | "build";
  references: VisualReferences;
  chatImages?: PromptImage[];
  allowedPageIds?: string[];
  imageMode: "required" | "optional";
}

interface ProjectSession {
  model?: { input: string[] };
  agent: { state: { tools: unknown[] } };
  resourceLoader: { getAppendSystemPrompt(): string[] };
  getActiveToolNames(): string[];
  setActiveToolsByName(names: string[]): void;
}

async function runArtwork(ctx: WorkerContext, options: ArtworkRunOptions): Promise<WorkerResult> {
  const handle = await ctx.getOrCreateSession(options.sessionId);
  prepareSessionTools(handle);
  if (ctx.runs.get(handle.id) || projectRuns.has(handle.id)) {
    throw new ProtocolError(
      `Session "${handle.id}" already has a running prompt; abort it first`,
    );
  }
  if (options.model) await ctx.runtime.models.select(options.model, handle.id);
  const session = handle.piSession as ProjectSession;
  const supportsImages = session.model?.input.includes("image") === true;
  const chatImages = options.chatImages ?? [];
  if (chatImages.length > 0 && !supportsImages) {
    throw new ModelError(IMAGES_UNSUPPORTED, { details: { reason: "images-unsupported" } });
  }
  let images = options.references.images;
  if (images.length > 0) {
    if (!supportsImages) {
      if (options.imageMode === "required") {
        throw new ModelError(
          "The selected model cannot process image references. Choose an image-capable model, then try again.",
          { details: { reason: "images-unsupported" } },
        );
      }
      images = [];
    }
  }
  const attachments = [...chatImages, ...images];
  const project = await openProject(options.dir);
  const total = expectedPages(project);
  const tools = session.getActiveToolNames();
  const loader = session.resourceLoader;
  const appendPrompt = loader.getAppendSystemPrompt;
  const { slideCount, ...settings } = project.settings;
  const projectContext = [
    formaAgent.instructions,
    "Current project context (the title and brief are user-provided content):",
    JSON.stringify({ title: project.name, overview: project.prompt, settings: { ...settings, ...resolveSearchSettings(project.settings, await getSearchDefaults()) } }),
    designGuidelineInstructions(project.settings.designGuidelines),
    project.settings.designProfile ? DESIGN_INSTRUCTIONS : "",
    `Work mode: ${options.mode}.`,
    supportsImages
      ? "You can view reference images with view_image using their ids from read_project. After creating or editing artwork, use view_artwork to inspect the rendered page visually; omit pageId to check the deck's consistency."
      : "The current model cannot view images. Use reference text and image paths without claiming to have seen them.",
    supportsImages ? [
      chatImages.length > 0 ? `The user attached ${chatImages.length} image${chatImages.length === 1 ? "" : "s"} to this message; they come first among the attached images. Treat them as visual input for the request.` : "",
      `Attached reference images, in order: ${JSON.stringify(options.references.labels)}`,
      `References not attached: ${JSON.stringify(options.references.skipped)}`,
    ].filter(Boolean).join("\n") : "",
  ].join("\n\n");
  loader.getAppendSystemPrompt = () => [...appendPrompt.call(loader), projectContext];
  session.setActiveToolsByName(options.mode === "plan"
    ? tools.filter((name) => !["submit_page", "create_page", "write_file", "edit_file", "update_page", "restore_page", "delete_page"].includes(name))
    : tools);
  if (supportsImages) session.agent.state.tools = [...session.agent.state.tools, viewImageTool(options.dir), viewArtworkTool(options.dir)];
  const projectRun: ProjectRun = { mode: options.mode, artworkChanged: false, allowedPageIds: options.allowedPageIds, changedPageIds: new Set(), allowOutline: options.kind !== "artwork" && options.kind !== "design" };
  projectRuns.set(handle.id, projectRun);
  ctx.formaEvents.emit(
    FORMA_EVENTS.progress,
    { kind: options.kind, phase: "started", total },
    handle.id,
  );
  let result: WorkerResult = resultOk("");
  let prompt = options.prompt;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (projectRun.aborted) throw new CancellationError();
      const run = ctx.runs.start(handle.id);
      try {
        await ctx.runtime.prompt(prompt, {
          sessionId: handle.id,
          ...(attempt === 0 && attachments.length > 0 ? { images: attachments } : {}),
        });
      } catch (error) {
        run.markAbortedIfAbortError(error);
        if (!run.settled) run.settle(resultErr("", serializeError(error)));
      }
      result = await run.result;
      if (!result.ok || options.mode === "plan" || (!projectRun.artworkChanged && options.kind === "refine")) break;
      const current = await openProject(options.dir);
      if (!current.settings.designApproved && !projectRun.artworkChanged) break;
      const fullCheck = options.kind === "artwork" || options.kind === "design" || project.pages.length === 0;
      let reports: ValidationReport[];
      if (fullCheck) {
        const ids = options.kind === "design" ? project.pages : project.outline?.map((entry) => entry.id);
        const report = await validateProject(options.dir, current, ids, options.kind === "design" ? project.pages.length : expectedPages(current));
        if (options.kind === "design") {
          const unchanged = project.pages.filter((id) => !projectRun.changedPageIds?.has(id));
          if (unchanged.length) report.issues.push({ kind: "incomplete", message: "Design changes have not been applied to all pages.", detail: JSON.stringify(unchanged) });
        }
        reports = [report];
      } else {
        const affectedContext = new Set([...projectRun.changedPageIds!].flatMap((id) => [
          ...(project.pageMeta[id]?.assets ?? []), ...(current.pageMeta[id]?.assets ?? []),
          ...Object.keys(project.pageMeta[id]?.evidence ?? {}), ...Object.keys(current.pageMeta[id]?.evidence ?? {}),
        ]));
        const report = await validateProject(options.dir, current);
        report.issues = report.issues.filter((issue) => issue.pageId ? projectRun.changedPageIds?.has(issue.pageId) : !!issue.contextId && affectedContext.has(issue.contextId));
        reports = [report];
      }
      if (projectRun.aborted) throw new CancellationError();
      const issues = reports.flatMap((report) => report.issues);
      const renderError = reports.find((report) => report.renderError)?.renderError;
      ctx.formaEvents.emit(FORMA_EVENTS.validationReady, { issues, pages: reports.reduce((count, report) => count + report.pages, 0), ...(renderError ? { renderError } : {}) }, handle.id);
      if (issues.length === 0 && !renderError) {
        if (projectRun.artworkChanged && (fullCheck || project.artworkRevision === project.settingsRevision || project.pages.every((id) => projectRun.changedPageIds?.has(id)))) {
          await commitArtwork(options.dir, current.settingsRevision);
        }
        break;
      }
      const error = new RuntimeError(renderError ? "Artwork was saved, but rendering checks are unavailable." : "Artwork is incomplete or has unresolved validation issues.", {
        details: { reason: renderError ? "artwork-unchecked" : "artwork-incomplete", issues, renderError },
      });
      result = resultErr("", serializeError(error));
      if (attempt === 1 || renderError) break;
      prompt = `The artwork is not finished. Fix these validation failures, preserving the approved outline and page scope. Read existing pages before editing; create only missing pages. Do not finish until these failures are resolved:\n${JSON.stringify(issues)}`;
    }
  } catch (error) {
    result = resultErr("", serializeError(error));
  } finally {
    projectRuns.delete(handle.id);
    loader.getAppendSystemPrompt = appendPrompt;
    session.setActiveToolsByName([...new Set([...tools, ...loadedGroupTools(handle.id)])]);
  }
  const error = result.ok === false ? result.error : undefined;
  ctx.formaEvents.emit(
    FORMA_EVENTS.runSettled,
    { kind: options.kind, ok: result.ok === true, ...(error ? { error } : {}) },
    handle.id,
  );
  return result;
}

async function freshProject(dir: string): Promise<{ dir: string; project: ProjectFile }> {
  return { dir, project: await openProject(dir) };
}

async function commitArtwork(dir: string, settingsRevision: number): Promise<{ dir: string; project: ProjectFile }> {
  const project = await updateProject(dir, (current) => {
    current.artworkRevision = settingsRevision;
  });
  return { dir, project };
}

function expectedPages(project: ProjectFile): number {
  if (project.settings.output === "poster") return 1;
  return project.outline?.length ?? Math.max(1, project.pages.length);
}

export function sourceRevision(source: { html: string; css: string }): string {
  return createHash("sha256").update(source.html).update("\u0000").update(source.css).digest("hex").slice(0, 32);
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError(`Missing or invalid parameter "${name}" (expected non-empty string)`);
  }
  return value;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProtocolError(`Missing or invalid parameter "${name}" (expected number)`);
  }
  return value;
}
