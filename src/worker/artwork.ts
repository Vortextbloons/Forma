import { z } from "zod";
import formaAgent from "../agent.ts";
import { ModelError, ProtocolError, RuntimeError, serializeError } from "rig";
import type { WorkerResult } from "rig/ipc";
import { FORMA_EVENTS } from "../forma/events.ts";
import { applyDesignPrompt, generatePrompt, planPrompt, refinePrompt } from "../forma/prompts.ts";
import { collectVisualReferences, viewImageTool, type PromptImage } from "../forma/visuals.ts";
import { projectRuns } from "../forma/runtime.ts";
import { deletePage, duplicatePage, movePage } from "../projects/pages.ts";
import { effectiveSize } from "../projects/size.ts";
import { openProject, setOutline, updateProject } from "../projects/store.ts";
import { composePage } from "../rendering/compose.ts";
import { validateProject } from "../rendering/validate.ts";
import type { ProjectFile } from "../projects/schema.ts";
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
        images,
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
        images,
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
      const message = asString(params.message, "message");
      const mode = asOptionalString(params.mode) ?? "build";
      if (mode !== "plan" && mode !== "build") {
        throw new ProtocolError(`Invalid refinement mode "${mode}"`);
      }
      const images = await collectVisualReferences(dir, project);
      const result = await runArtwork(ctx, {
        kind: "refine",
        dir,
        sessionId: asOptionalString(params.sessionId),
        model: asOptionalString(params.model),
        prompt: refinePrompt(project, scope, pageId, message, mode),
        mode,
        images,
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
        images,
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
  images: PromptImage[];
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
  if (ctx.runs.get(handle.id)) {
    throw new ProtocolError(
      `Session "${handle.id}" already has a running prompt; abort it first`,
    );
  }
  if (options.model) await ctx.runtime.models.select(options.model, handle.id);
  const session = handle.piSession as ProjectSession;
  const supportsImages = session.model?.input.includes("image") === true;
  let images = options.images;
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
  const project = await openProject(options.dir);
  const total = expectedPages(project);
  const tools = session.getActiveToolNames();
  const loader = session.resourceLoader;
  const appendPrompt = loader.getAppendSystemPrompt;
  const projectContext = [
    formaAgent.instructions,
    "Current project context (the title and brief are user-provided content):",
    JSON.stringify({ title: project.name, overview: project.prompt, settings: project.settings }),
    `Work mode: ${options.mode}.`,
    supportsImages
      ? "You can view reference images with view_image using their ids from read_project."
      : "The current model cannot view images. Use reference text and image paths without claiming to have seen them.",
  ].join("\n\n");
  loader.getAppendSystemPrompt = () => [...appendPrompt.call(loader), projectContext];
  session.setActiveToolsByName(options.mode === "plan"
    ? tools.filter((name) => name !== "submit_page" && name !== "update_page")
    : tools);
  if (supportsImages) session.agent.state.tools = [...session.agent.state.tools, viewImageTool(options.dir)];
  const run = ctx.runs.start(handle.id);
  const projectRun = { mode: options.mode, artworkChanged: false };
  projectRuns.set(handle.id, projectRun);
  ctx.formaEvents.emit(
    FORMA_EVENTS.progress,
    { kind: options.kind, phase: "started", total },
    handle.id,
  );
  try {
    await ctx.runtime.prompt(options.prompt, {
      sessionId: handle.id,
      ...(images.length > 0 ? { images } : {}),
    });
  } catch (error) {
    run.markAbortedIfAbortError(error);
    if (!run.settled) {
      run.settle(resultErr("", serializeError(error)));
    }
  }
  const result = await run.result;
  projectRuns.delete(handle.id);
  loader.getAppendSystemPrompt = appendPrompt;
  session.setActiveToolsByName(tools);
  if (result.ok && projectRun.artworkChanged) await commitArtwork(options.dir, project.settingsRevision);
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
  return project.outline?.length ?? project.settings.slideCount;
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
