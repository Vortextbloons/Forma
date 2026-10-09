import { describe, it, expect } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorkerReady } from "rig/ipc";
import { createProject } from "../src/projects/store.ts";
import { defaultSettings } from "../src/projects/schema.ts";

interface WorkerResultOk {
  id: string;
  ok: true;
  data?: unknown;
}

interface WorkerResultErr {
  id: string;
  ok: false;
  error: { code: string; message: string };
}

type WorkerResult = WorkerResultOk | WorkerResultErr;

const WORKER_ENTRY = resolve(import.meta.dirname, "..", "src", "worker", "index.ts");

class WorkerHarness {
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: Promise<WorkerReady>;
  #buffer = "";
  #seq = 0;
  #pending = new Map<string, (result: WorkerResult) => void>();
  #readyResolve!: (ready: WorkerReady) => void;
  #readyReject!: (error: Error) => void;
  readonly stderr: string[] = [];

  constructor(projectDir: string) {
    this.child = spawn(
      process.execPath,
      [WORKER_ENTRY, "--project", projectDir, "--log-level", "info"],
      { cwd: projectDir, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.ready = new Promise<WorkerReady>((resolveReady, rejectReady) => {
      this.#readyResolve = resolveReady;
      this.#readyReject = rejectReady;
    });
    const timer = setTimeout(
      () => this.#readyReject(new Error(`worker did not become ready; stderr:\n${this.stderr.join("")}`)),
      45_000,
    );
    this.child.stderr.on("data", (chunk) => this.stderr.push(String(chunk)));
    this.child.stdout.on("data", (chunk) => this.#handleChunk(String(chunk), timer));
  }

  #handleChunk(chunk: string, readyTimer: ReturnType<typeof setTimeout>): void {
    this.#buffer += chunk;
    let index: number;
    while ((index = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, index);
      this.#buffer = this.#buffer.slice(index + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      if (message.type === "ready") {
        clearTimeout(readyTimer);
        this.#readyResolve(message as unknown as WorkerReady);
      } else if (message.type === "result") {
        const result = message as unknown as WorkerResult;
        this.#pending.get(result.id)?.(result);
        this.#pending.delete(result.id);
      }
    }
  }

  send(name: string, params: Record<string, unknown> = {}): Promise<WorkerResult> {
    const id = `c${++this.#seq}`;
    return new Promise<WorkerResult>((resolveResult) => {
      this.#pending.set(id, resolveResult);
      this.child.stdin.write(`${JSON.stringify({ v: 1, type: "command", id, name, params })}\n`);
    });
  }

  async stop(): Promise<number> {
    const result = await this.send("shutdown");
    expect(result.ok).toBe(true);
    return await new Promise<number>((resolveCode) => {
      this.child.on("close", (code) => resolveCode(code ?? -1));
    });
  }
}

describe("forma worker", () => {
  it("boots, handles project commands and shuts down cleanly", async () => {    const root = await mkdtemp(join(tmpdir(), "forma-worker-"));
    const projectDir = join(root, "Deck");
    const harness = new WorkerHarness(root);
    try {
      const ready = await harness.ready;
      expect(ready.agentName).toBe("forma");
      expect(ready.projectDir).toBe(root);

      const created = await harness.send("project.create", {
        dir: projectDir,
        name: "Deck",
        prompt: "A worker integration deck",
        mode: "plan",
        settings: { output: "slides" },
      });
      expect(created.ok).toBe(true);

      const opened = await harness.send("project.open", { dir: projectDir });
      expect(opened.ok).toBe(true);
      const payload = (opened as WorkerResultOk).data as {
        project: { project: { name: string; formatVersion: number } };
      };
      expect(payload.project.project.name).toBe("Deck");
      expect(payload.project.project.formatVersion).toBe(1);

      const onDisk = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8")) as {
        name: string;
      };
      expect(onDisk.name).toBe("Deck");

      const unknown = await harness.send("does.not.exist");
      expect(unknown.ok).toBe(false);
      expect((unknown as WorkerResultErr).error.code).toBe("PROTOCOL_ERROR");

      const missing = await harness.send("project.open", { dir: join(root, "missing") });
      expect(missing.ok).toBe(false);

      expect(await harness.stop()).toBe(0);
    } finally {
      if (harness.child.exitCode === null) harness.child.kill();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  }, 90_000);

  it("reopens a moved project and resolves its conversation state", async () => {
    const root = await mkdtemp(join(tmpdir(), "forma-moved-"));
    const original = join(root, "Original");
    const moved = join(root, "Moved");
    await createProject({
      dir: original,
      name: "Moved deck",
      prompt: "Reopen me somewhere else",
      mode: "plan",
      settings: defaultSettings("slides"),
    });

    const first = new WorkerHarness(original);
    let sessionId = "";
    try {
      await first.ready;
      const session = await first.send("newSession", { name: "Project chat" });
      expect(session.ok).toBe(true);
      sessionId = (session as WorkerResultOk).data
        ? ((session as WorkerResultOk).data as { session: { id: string } }).session.id
        : "";
      expect(sessionId).toMatch(/^rig_/);

      const recorded = await first.send("project.setConversation", {
        dir: original,
        sessionIds: [sessionId],
      });
      expect(recorded.ok).toBe(true);
      expect(await first.stop()).toBe(0);
    } finally {
      if (first.child.exitCode === null) first.child.kill();
    }

    await rename(original, moved);

    const second = new WorkerHarness(moved);
    try {
      await second.ready;
      const opened = await second.send("project.open", { dir: moved });
      expect(opened.ok).toBe(true);
      const payload = (opened as WorkerResultOk).data as {
        project: { project: { conversation: { sessionIds: string[] } } };
      };
      expect(payload.project.project.conversation.sessionIds).toEqual([sessionId]);

      const resumed = await second.send("resumeSession", { sessionId });
      expect(resumed.ok).toBe(true);
      const resumedId = (resumed as WorkerResultOk).data
        ? ((resumed as WorkerResultOk).data as { session: { id: string } }).session.id
        : "";
      expect(resumedId).toBe(sessionId);

      expect(await second.stop()).toBe(0);
    } finally {
      if (second.child.exitCode === null) second.child.kill();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  }, 90_000);
});
