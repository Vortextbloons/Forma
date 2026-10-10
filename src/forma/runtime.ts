import { RuntimeError } from "rig";
import type { WorkerToHost } from "rig/ipc";

export interface FormaEventSink {
  emit(type: string, data: Record<string, unknown>, sessionId?: string): void;
}

export interface FormaEnv {
  projectDir: string;
  events: FormaEventSink;
}

let current: FormaEnv | undefined;

export const projectRuns = new Map<string, { mode: "plan" | "build"; artworkChanged: boolean }>();

export function setFormaEnv(next: FormaEnv | undefined): void {
  current = next;
}

export function formaEnv(): FormaEnv | undefined {
  return current;
}

export function requireFormaEnv(): FormaEnv {
  if (!current) {
    throw new RuntimeError("Forma runtime is not initialised");
  }
  return current;
}
