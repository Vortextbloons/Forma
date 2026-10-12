import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RuntimeError } from "rig";
import { z } from "zod";

const DEADLINE_MS = 30_000;
const DEFAULT_HELPER = fileURLToPath(new URL("./ddgs/helper.py", import.meta.url));

export interface DdgsCommand {
  python: string;
  script: string;
  deadlineMs?: number;
}

export interface DdgsTextResult {
  title: string;
  url: string;
  snippet: string;
}

export interface DdgsImageResult {
  title: string;
  imageUrl: string;
  thumbnailUrl?: string;
  pageUrl?: string;
  width?: number;
  height?: number;
  source?: string;
}

const textResultSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string(),
});

const imageResultSchema = z.object({
  title: z.string(),
  imageUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  pageUrl: z.string().url().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  source: z.string().optional(),
});

const responseSchema = z.object({
  ok: z.boolean(),
  results: z.array(z.unknown()).optional(),
  error: z.string().optional(),
});

let tail: Promise<unknown> = Promise.resolve();
const active = new Set<ChildProcess>();

export function resolveDdgsCommand(): DdgsCommand {
  const bundledPython = join(dirname(process.execPath), "ddgs", "python.exe");
  return {
    python:
      process.env.FORMA_DDGS_PYTHON ??
      (existsSync(bundledPython)
        ? bundledPython
        : fileURLToPath(new URL("../../desktop/bin/ddgs/Scripts/python.exe", import.meta.url))),
    script: process.env.FORMA_DDGS_HELPER ?? DEFAULT_HELPER,
  };
}

export function closeDdgsHelpers(): void {
  for (const child of active) child.kill();
  active.clear();
}

export function searchDdgsText(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
  command: DdgsCommand = resolveDdgsCommand(),
): Promise<DdgsTextResult[]> {
  return enqueue(command, { action: "text", query, maxResults }, signal).then((results) =>
    parseResults(textResultSchema.array(), results),
  );
}

export function searchDdgsImages(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
  command: DdgsCommand = resolveDdgsCommand(),
): Promise<DdgsImageResult[]> {
  return enqueue(command, { action: "images", query, maxResults }, signal).then((results) =>
    parseResults(imageResultSchema.array(), results),
  );
}

function enqueue(command: DdgsCommand, request: unknown, signal?: AbortSignal): Promise<unknown[]> {
  const next = tail.then(
    () => runHelper(command, request, signal),
    () => runHelper(command, request, signal),
  );
  tail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function parseResults<T>(schema: z.ZodType<T[]>, results: unknown[]): T[] {
  const parsed = schema.safeParse(results);
  if (!parsed.success) {
    throw new RuntimeError("Built-in search returned malformed results");
  }
  return parsed.data;
}

function runHelper(
  command: DdgsCommand,
  request: unknown,
  signal?: AbortSignal,
): Promise<unknown[]> {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new RuntimeError("Built-in search was cancelled"));
      return;
    }
    const child = spawn(command.python, [command.script], { windowsHide: true });
    active.add(child);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    function finish(error: Error | null, value?: unknown[]): void {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      active.delete(child);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        child.kill();
        reject(error);
        return;
      }
      resolvePromise(value ?? []);
    }

    function onAbort(): void {
      finish(new RuntimeError("Built-in search was cancelled"));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        finish(
          new RuntimeError(
            `Built-in search runtime was not found at "${command.python}". Set FORMA_DDGS_PYTHON to a Python executable.`,
          ),
        );
        return;
      }
      finish(new RuntimeError(`Could not start the built-in search runtime: ${error.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      const line = stdout.split(/\r?\n/).find((entry) => entry.trim() !== "");
      if (!line) {
        const detail = stderr.trim() || `exit code ${code}`;
        finish(new RuntimeError(`Built-in search returned no result (${detail})`));
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(line);
      } catch {
        finish(new RuntimeError("Built-in search returned malformed output"));
        return;
      }
      const response = responseSchema.safeParse(payload);
      if (!response.success) {
        finish(new RuntimeError("Built-in search returned malformed output"));
        return;
      }
      if (!response.data.ok) {
        finish(
          new RuntimeError(`Built-in search failed: ${response.data.error ?? "unknown error"}`),
        );
        return;
      }
      finish(null, response.data.results ?? []);
    });

    timer = setTimeout(() => {
      finish(new RuntimeError("Built-in search timed out after 30 seconds"));
    }, command.deadlineMs ?? DEADLINE_MS);
    child.stdin.end(`${JSON.stringify(request)}\n`, "utf8");
  });
}
