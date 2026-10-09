import type { WorkerToHost } from "rig/ipc";

export class WorkerWriter {
  #chain: Promise<void> = Promise.resolve();

  write(message: WorkerToHost): void {
    let line: string;
    try {
      line = `${JSON.stringify(message)}\n`;
    } catch (error) {
      process.stderr.write(`[worker] failed to serialize message: ${String(error)}\n`);
      return;
    }
    this.#chain = this.#chain
      .then(
        () =>
          new Promise<void>((resolve) => {
            process.stdout.write(line, () => resolve());
          }),
      )
      .catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.#chain;
  }
}
