import type { SerializedIpcError, WorkerResult } from "rig/ipc";

export function resultOk(id: string, data?: unknown): WorkerResult {
  return { v: 1, type: "result", id, ok: true, data };
}

export function resultErr(id: string, error: SerializedIpcError): WorkerResult {
  return { v: 1, type: "result", id, ok: false, error };
}
