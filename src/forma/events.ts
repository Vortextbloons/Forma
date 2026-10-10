import type { WorkerToHost } from "rig/ipc";
import type { FormaEventSink } from "./runtime.ts";

export const FORMA_EVENTS = {
  progress: "forma.run.progress",
  outlineReady: "forma.outline.ready",
  pageReady: "forma.page.ready",
  contextReady: "forma.context.ready",
  validationReady: "forma.validation.ready",
  runSettled: "forma.run.settled",
  exportProgress: "forma.export.progress",
  exportCompleted: "forma.export.completed",
  exportFailed: "forma.export.failed",
  exportCancelled: "forma.export.cancelled",
} as const;

export function createFormaEventSink(
  write: (message: WorkerToHost) => void,
  projectId: string,
): FormaEventSink {
  let seq = 0;
  return {
    emit(type, data, sessionId = "") {
      write({
        v: 1,
        type: "event",
        event: {
          version: 1,
          seq: (seq += 1),
          timestamp: new Date().toISOString(),
          projectId,
          sessionId,
          type,
          data,
        },
      } as unknown as WorkerToHost);
    },
  };
}
