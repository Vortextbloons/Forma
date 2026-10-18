import { randomUUID } from "node:crypto";
import { CancellationError, ProtocolError, RuntimeError, serializeError } from "rig";
import { FORMA_EVENTS } from "../forma/events.ts";
import { openProject } from "../projects/store.ts";
import { runExport, type ExportFormat } from "../rendering/export.ts";
import { resultErr, resultOk } from "./results.ts";
import { asOptionalString, asString } from "./params.ts";
import type { CommandHandler, WorkerContext } from "./commands.ts";

const EXPORT_FORMATS = ["pdf", "png", "pptx"] as const;
const EXPORT_SCOPES = ["all", "selected", "poster"] as const;
const SLIDE_SCALES = [1, 2] as const;
const PRINT_DPI = [150, 300] as const;

export function createExportHandlers(ctx: WorkerContext): Record<string, CommandHandler> {
  const active = new Map<string, AbortController>();

  return {
    async "rendering.export"(params) {
      const dir = asString(params.dir, "dir");
      const format = asFormat(params.format);
      const scope = asScope(params.scope);
      const destination = asString(params.destination, "destination");
      const project = await openProject(dir);
      const pageIds = resolvePageIds(project, scope, asOptionalString(params.pageId));
      const print = project.settings.output === "poster" && project.settings.posterKind === "print";
      const request = {
        dir,
        project,
        format,
        pageIds,
        destination,
        directory: format === "png" && scope === "all",
        ...(format === "png" ? print ? { dpi: asDpi(params.dpi) } : { scale: asScale(params.scale) } : {}),
      };

      const runId = asOptionalString(params.runId) ?? randomUUID();
      const controller = new AbortController();
      active.set(runId, controller);
      const total = pageIds.length;
      ctx.formaEvents.emit(FORMA_EVENTS.exportProgress, {
        runId,
        format,
        phase: "started",
        completed: 0,
        total,
      });
      try {
        const result = await runExport({
          ...request,
          signal: controller.signal,
          onProgress: (completed) =>
            ctx.formaEvents.emit(FORMA_EVENTS.exportProgress, {
              runId,
              format,
              phase: "page",
              completed,
              total,
            }),
        });
        ctx.formaEvents.emit(FORMA_EVENTS.exportCompleted, { runId, format, files: result.files });
        return resultOk("", { runId, files: result.files });
      } catch (error) {
        if (controller.signal.aborted || error instanceof CancellationError) {
          ctx.formaEvents.emit(FORMA_EVENTS.exportCancelled, { runId });
        } else {
          ctx.formaEvents.emit(FORMA_EVENTS.exportFailed, { runId, error: serializeError(error) });
        }
        return resultErr("", serializeError(error));
      } finally {
        active.delete(runId);
      }
    },

    async "rendering.cancelExport"(params) {
      const runId = asString(params.runId, "runId");
      active.get(runId)?.abort();
      return resultOk("");
    },
  };
}

function resolvePageIds(
  project: Awaited<ReturnType<typeof openProject>>,
  scope: (typeof EXPORT_SCOPES)[number],
  pageId?: string,
): string[] {
  if (scope === "selected") {
    if (!pageId || !project.pages.includes(pageId)) {
      throw new RuntimeError(`Unknown page "${pageId ?? ""}"`, { details: { pageIds: project.pages } });
    }
    return [pageId];
  }
  if (project.pages.length === 0) {
    throw new RuntimeError("There is no artwork to export yet.");
  }
  return [...project.pages];
}

function asFormat(value: unknown): ExportFormat {
  if (typeof value !== "string" || !(EXPORT_FORMATS as readonly string[]).includes(value)) {
    throw new ProtocolError(`Invalid export format "${String(value)}" (expected ${EXPORT_FORMATS.join(", ")})`);
  }
  return value as ExportFormat;
}

function asScope(value: unknown): (typeof EXPORT_SCOPES)[number] {
  if (typeof value !== "string" || !(EXPORT_SCOPES as readonly string[]).includes(value)) {
    throw new ProtocolError(`Invalid export scope "${String(value)}" (expected ${EXPORT_SCOPES.join(", ")})`);
  }
  return value as (typeof EXPORT_SCOPES)[number];
}

function asScale(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== "number" || !(SLIDE_SCALES as readonly number[]).includes(value)) {
    throw new ProtocolError(`Invalid PNG scale "${String(value)}" (expected 1 or 2)`);
  }
  return value;
}

function asDpi(value: unknown): number {
  if (value === undefined) return 300;
  if (typeof value !== "number" || !(PRINT_DPI as readonly number[]).includes(value)) {
    throw new ProtocolError(`Invalid PNG resolution "${String(value)}" (expected 150 or 300)`);
  }
  return value;
}
