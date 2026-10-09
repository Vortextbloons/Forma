




import type { WorkerReady } from "../types";

export type WorkerStatus = "connecting" | "ready" | "restarting" | "stopped" | "error";

export interface ReadyInfo {
  projectId: string;
  projectDir: string;
  agentName?: string;
  capabilities: WorkerReady["capabilities"] | null;
}

export interface WorkerExitInfo {
  code: number;
  restartable: boolean;
  restarts: number;
}

export interface WorkerErrorInfo {
  message: string;
  fatal?: boolean;
}

export interface LogEntry {
  id: number;
  level: "debug" | "info" | "warn" | "error" | "stderr" | "system";
  message: string;
  timestamp: string;
}

const MAX_LOG_ENTRIES = 300;

let status = $state<WorkerStatus>("connecting");
let readyInfo = $state<ReadyInfo | null>(null);
let restarts = $state(0);
let lastExit = $state<WorkerExitInfo | null>(null);
let lastError = $state<WorkerErrorInfo | null>(null);
let logs = $state<LogEntry[]>([]);

let logSeq = 0;

export function handleReady(payload: unknown): void {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const caps = p.capabilities;
  readyInfo = {
    projectId: typeof p.projectId === "string" ? p.projectId : "",
    projectDir: typeof p.projectDir === "string" ? p.projectDir : "",
    agentName: typeof p.agentName === "string" ? p.agentName : undefined,
    capabilities:
      typeof caps === "object" && caps !== null ? (caps as WorkerReady["capabilities"]) : null,
  };
  restarts = 0;
  status = "ready";
  pushLog("system", "worker ready");
}

export function handleWorkerExit(payload: unknown): void {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const exit: WorkerExitInfo = {
    code: typeof p.code === "number" ? p.code : -1,
    restartable: p.restartable === true,
    restarts: typeof p.restarts === "number" ? p.restarts : 0,
  };
  lastExit = exit;
  restarts = exit.restarts;
  if (exit.restartable) {
    status = "restarting";
    pushLog("system", `worker exited (code ${exit.code}); restarting…`);
  } else {
    status = "stopped";
    pushLog("error", `worker exited (code ${exit.code}); restart limit reached`);
  }
}

export function handleWorkerError(payload: unknown): void {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  lastError = {
    message: typeof p.message === "string" ? p.message : "Unknown worker error",
    fatal: p.fatal === true ? true : undefined,
  };
  if (lastError.fatal) status = "error";
  pushLog("error", lastError.message);
}

export function handleWorkerLog(payload: unknown): void {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const level = p.level === "debug" || p.level === "info" || p.level === "warn" || p.level === "error" || p.level === "stderr"
    ? p.level
    : ("info" as const);
  pushLog(level, typeof p.message === "string" ? p.message : "");
}

export function pushLog(level: LogEntry["level"], message: string): void {
  if (logs.length >= MAX_LOG_ENTRIES) logs.shift();
  logs.push({ id: ++logSeq, level, message, timestamp: new Date().toISOString() });
}

export function markRestarting(): void {
  status = "restarting";
  pushLog("system", "restarting worker…");
}

export const workerStore = {
  get status() {
    return status;
  },
  get readyInfo() {
    return readyInfo;
  },
  get restarts() {
    return restarts;
  },
  get lastExit() {
    return lastExit;
  },
  get lastError() {
    return lastError;
  },
  get logs() {
    return logs;
  },
  handleReady,
  handleWorkerExit,
  handleWorkerError,
  handleWorkerLog,
  markRestarting,
};
