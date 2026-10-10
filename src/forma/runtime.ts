import type { WorkerToHost } from "rig/ipc";

export interface FormaEventSink {
  emit(type: string, data: Record<string, unknown>, sessionId?: string): void;
}

export interface FormaEnv {
  projectDir: string;
  events: FormaEventSink;
}

let current: FormaEnv | undefined;

export interface ProjectRun {
  mode: "plan" | "build";
  artworkChanged: boolean;
  allowedPageIds?: string[];
  changedPageIds?: Set<string>;
  allowOutline?: boolean;
  aborted?: boolean;
}

export const projectRuns = new Map<string, ProjectRun>();

export function setFormaEnv(next: FormaEnv | undefined): void {
  current = next;
}

export function formaEnv(): FormaEnv | undefined {
  return current;
}

