import { CancellationError, serializeError, type RigEvent } from "rig";
import type { WorkerResult } from "rig/ipc";
import { resultErr, resultOk } from "./results.ts";

export interface PendingRunHandle {
  readonly sessionId: string;
  readonly result: Promise<WorkerResult>;
  readonly settled: boolean;
  markAborted(): void;
  markAbortedIfAbortError(error: unknown): void;
  settle(result: WorkerResult): void;
}

export class PendingRunRegistry {
  readonly #runs = new Map<string, PendingRunImpl>();

  start(sessionId: string): PendingRunHandle {
    const run = new PendingRunImpl(sessionId, () => {
      this.#runs.delete(sessionId);
    });
    this.#runs.set(sessionId, run);
    return run;
  }

  get(sessionId: string): PendingRunHandle | undefined {
    return this.#runs.get(sessionId);
  }

  settleFromEvent(event: RigEvent): void {
    const run = this.#runs.get(event.sessionId);
    if (!run) return;
    switch (event.type) {
      case "run.completed":
        run.settle(resultOk("", { result: event.data.result, sessionId: event.sessionId }));
        break;
      case "run.failed":
        run.settle(resultErr("", event.data.error));
        break;
      default:
        break;
    }
  }

  rejectAll(error: unknown): void {
    for (const run of [...this.#runs.values()]) {
      run.settle(resultErr("", serializeError(error)));
    }
    this.#runs.clear();
  }
}

class PendingRunImpl implements PendingRunHandle {
  readonly sessionId: string;
  readonly result: Promise<WorkerResult>;
  #resolve!: (result: WorkerResult) => void;
  #aborted = false;
  #settled = false;
  readonly #onSettled: (run: PendingRunImpl) => void;

  constructor(sessionId: string, onSettled: (run: PendingRunImpl) => void) {
    this.sessionId = sessionId;
    this.#onSettled = onSettled;
    this.result = new Promise<WorkerResult>((resolve) => {
      this.#resolve = resolve;
    });
  }

  get settled(): boolean {
    return this.#settled;
  }

  markAborted(): void {
    this.#aborted = true;
  }

  markAbortedIfAbortError(error: unknown): void {
    if (
      error instanceof CancellationError ||
      (error instanceof Error && error.name === "AbortError") ||
      String(error).toLowerCase().includes("abort")
    ) {
      this.#aborted = true;
    }
  }

  settle(result: WorkerResult): void {
    if (this.#settled) return;
    this.#settled = true;
    if (this.#aborted) {
      result = resultErr("", serializeError(new CancellationError()));
    }
    this.#onSettled(this);
    this.#resolve(result);
  }
}
