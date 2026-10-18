import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { RuntimeError } from "rig";

export interface PythonInput {
  name: string;
  data: Uint8Array;
}

export interface PythonOutput {
  name: string;
  data: Uint8Array;
}

export interface PythonRunOptions {
  code: string;
  inputs?: PythonInput[];
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface PythonRunResult {
  runtime: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  timedOut: boolean;
  durationMs: number;
  inputs: Array<{ name: string; staged: string }>;
  outputs: PythonOutput[];
}

const DEFAULT_TIMEOUT_MS = 20_000;
const BOOT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_OUTPUT_FILES = 128;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const RUNTIME_BASE = "https://forma.invalid/pyodide/";
const RUNTIME_FILES = [
  { name: "pyodide.js", type: "text/javascript" },
  { name: "pyodide.asm.js", type: "text/javascript" },
  { name: "pyodide.asm.wasm", type: "application/wasm" },
  { name: "python_stdlib.zip", type: "application/zip" },
  { name: "pyodide-lock.json", type: "application/json" },
] as const;

const SANDBOX_ARGS = [
  "--disable-gpu",
  "--no-first-run",
  "--hide-scrollbars",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-default-apps",
  "--no-default-browser-check",
  "--disable-component-update",
  "--disable-domain-reliability",
  "--host-resolver-rules=MAP * ~NOTFOUND",
  "--proxy-server=127.0.0.1:1",
  "--proxy-bypass-list=<-loopback>",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
];

const WORKER_SOURCE = `const RUNTIME = ${JSON.stringify(RUNTIME_BASE)};
const decode = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const encode = (bytes) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};
const blocked = () => {
  throw new Error("Network access is blocked in the Forma Python sandbox");
};
let pyodide;
let booted = false;
let runData;
self.onmessage = async (event) => {
  if (event.data && event.data.type === "start") {
    await run();
    return;
  }
  runData = event.data;
  try {
    const blobs = new Map();
    for (const file of runData.files) blobs.set(file.url, file);
    self.fetch = (input) => {
      const url = String(typeof input === "string" ? input : input && input.url ? input.url : input);
      const file = blobs.get(url);
      if (!booted && file) {
        return Promise.resolve(
          new Response(new Blob([decode(file.base64)], { type: file.type }), {
            headers: { "content-type": file.type },
          }),
        );
      }
      return Promise.reject(new Error("Network access is blocked in the Forma Python sandbox"));
    };
    const source = (name) => decode(runData.files.find((file) => file.url === RUNTIME + name).base64);
    importScripts(URL.createObjectURL(new Blob([source("pyodide.js")], { type: "text/javascript" })));
    importScripts(URL.createObjectURL(new Blob([source("pyodide.asm.js")], { type: "text/javascript" })));
    pyodide = await loadPyodide({ indexURL: RUNTIME, lockFileContents: runData.lockJson });
    booted = true;
    Object.defineProperty(self, "fetch", { value: blocked, writable: false, configurable: false });
    Object.defineProperty(self, "XMLHttpRequest", { value: function () { blocked(); }, writable: false, configurable: false });
    Object.defineProperty(self, "WebSocket", { value: function () { blocked(); }, writable: false, configurable: false });
    Object.defineProperty(self, "EventSource", { value: function () { blocked(); }, writable: false, configurable: false });
    Object.defineProperty(self, "importScripts", { value: blocked, writable: false, configurable: false });
    const FS = pyodide.FS;
    FS.mkdirTree("/work/inputs");
    FS.mkdirTree("/work/outputs");
    for (const input of runData.inputs) {
      const parts = input.name.split("/");
      if (parts.length > 1) FS.mkdirTree("/work/inputs/" + parts.slice(0, -1).join("/"));
      FS.writeFile("/work/inputs/" + input.name, decode(input.base64));
    }
    FS.chdir("/work");
    self.postMessage({ type: "ready" });
  } catch (error) {
    self.postMessage({ type: "ready", error: String(error && error.stack ? error.stack : error) });
  }
};
async function run() {
  const stdout = { bytes: new Uint8Array(runData.maxOutputBytes), length: 0 };
  const stderr = { bytes: new Uint8Array(runData.maxOutputBytes), length: 0 };
  let truncated = false;
  let exitCode = 0;
  const write = (target, bytes) => {
    const remaining = target.bytes.length - target.length;
    const accepted = bytes.subarray(0, remaining);
    target.bytes.set(accepted, target.length);
    target.length += accepted.length;
    if (bytes.length > remaining) truncated = true;
    return bytes.length;
  };
  const text = (target) => new TextDecoder().decode(target.bytes.subarray(0, target.length));
  try {
    pyodide.setStdout({ write: (bytes) => write(stdout, bytes) });
    pyodide.setStderr({ write: (bytes) => write(stderr, bytes) });
    try {
      await pyodide.runPythonAsync(runData.code);
    } catch (error) {
      exitCode = 1;
      write(stderr, new TextEncoder().encode(String(error && error.message ? error.message : error)));
    } finally {
      pyodide.runPython("import sys; sys.stdout.flush(); sys.stderr.flush()");
    }
    const outputs = [];
    let total = 0;
    const walk = (dir, prefix) => {
      for (const name of pyodide.FS.readdir(dir)) {
        if (name === "." || name === "..") continue;
        const full = dir + "/" + name;
        const relative = prefix ? prefix + "/" + name : name;
        if (pyodide.FS.isDir(pyodide.FS.stat(full).mode)) {
          walk(full, relative);
          continue;
        }
        if (outputs.length >= runData.maxOutputFiles) {
          throw new Error("Too many output files (limit " + runData.maxOutputFiles + ")");
        }
        const bytes = pyodide.FS.readFile(full);
        total += bytes.byteLength;
        if (total > runData.maxOutputBytesTotal) {
          throw new Error("Output files are too large (limit " + runData.maxOutputBytesTotal + " bytes)");
        }
        outputs.push({ name: relative, base64: encode(bytes) });
      }
    };
    walk("/work/outputs", "");
    self.postMessage({ type: "done", exitCode, stdout: text(stdout), stderr: text(stderr), truncated, outputs });
  } catch (error) {
    write(stderr, new TextEncoder().encode(String(error && error.stack ? error.stack : error)));
    self.postMessage({
      type: "done",
      exitCode: 1,
      stdout: text(stdout),
      stderr: text(stderr),
      truncated,
      outputs: [],
    });
  }
}
`;

class ExecutionTimeout extends Error {}

export async function runPython(options: PythonRunOptions): Promise<PythonRunResult> {
  const root = pyodideRoot();
  if (!root) {
    throw new RuntimeError(
      "The bundled Python runtime is missing. Reinstall Forma so its Pyodide assets are present.",
      { details: { reason: "python-runtime-missing" } },
    );
  }
  const staged = stageInputs(options.inputs ?? []);
  const totalInput = staged.reduce((sum, entry) => sum + entry.data.byteLength, 0);
  if (totalInput > MAX_INPUT_BYTES) {
    throw new RuntimeError(`Materials are too large to analyse (limit ${MAX_INPUT_BYTES / (1024 * 1024)} MB)`, {
      details: { reason: "python-input-too-large", bytes: totalInput },
    });
  }
  const assets = await loadAssets(root);
  return execute(options, staged, assets);
}

export async function pythonRuntime(): Promise<{ version: string; root: string; found: boolean }> {
  const root = pyodideRoot();
  if (!root) return { version: "", root: "", found: false };
  try {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version?: string };
    const present = await Promise.all(
      RUNTIME_FILES.map(async (file) => {
        const info = await stat(join(root, file.name)).catch(() => undefined);
        return Boolean(info?.isFile());
      }),
    );
    return { version: pkg.version ?? "", root, found: present.every(Boolean) };
  } catch {
    return { version: "", root, found: false };
  }
}

function pyodideRoot(): string {
  try {
    return dirname(createRequire(import.meta.url).resolve("pyodide/pyodide.js"));
  } catch {
    return "";
  }
}

interface RuntimeAssets {
  version: string;
  files: Array<{ url: string; type: string; base64: string }>;
  lockJson: string;
}

async function loadAssets(root: string): Promise<RuntimeAssets> {
  const [pkg, files, lockJson] = await Promise.all([
    readFile(join(root, "package.json"), "utf8"),
    Promise.all(
      RUNTIME_FILES.map(async (file) => ({
        url: RUNTIME_BASE + file.name,
        type: file.type,
        base64: (await readFile(join(root, file.name))).toString("base64"),
      })),
    ),
    readFile(join(root, "pyodide-lock.json"), "utf8"),
  ]);
  return { version: (JSON.parse(pkg) as { version?: string }).version ?? "", files, lockJson };
}

function stageInputs(inputs: PythonInput[]): Array<{ name: string; staged: string; data: Uint8Array }> {
  const used = new Set<string>();
  return inputs.map((input) => {
    const source = basename(input.name).replace(/[^\w.-]+/g, "_") || "input";
    let target = source;
    let counter = 2;
    while (used.has(target.toLowerCase())) {
      const extension = source.includes(".") ? source.slice(source.lastIndexOf(".")) : "";
      target = `${source.slice(0, source.length - extension.length)}-${counter}${extension}`;
      counter += 1;
    }
    used.add(target.toLowerCase());
    return { name: input.name, staged: target, data: input.data };
  });
}

async function execute(
  options: PythonRunOptions,
  staged: Array<{ name: string; staged: string; data: Uint8Array }>,
  assets: RuntimeAssets,
): Promise<PythonRunResult> {
  const puppeteer = (await import("puppeteer")).default;
  const executablePath = process.env.FORMA_CHROME_PATH;
  const browser = await puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: SANDBOX_ARGS,
  });
  try {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        void request.abort();
      });
      await page.setContent('<!doctype html><meta charset="utf-8"><title>Forma Python sandbox</title>', {
        waitUntil: "load",
      });
      const payload = {
        code: options.code,
        inputs: staged.map((entry) => ({ name: entry.staged, base64: Buffer.from(entry.data).toString("base64") })),
        files: assets.files,
        lockJson: assets.lockJson,
        maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        maxOutputFiles: MAX_OUTPUT_FILES,
        maxOutputBytesTotal: MAX_OUTPUT_BYTES,
      };
      await page.evaluate((source, data) => {
        const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
        let readyResolve: (value: unknown) => void = () => undefined;
        let doneResolve: (value: unknown) => void = () => undefined;
        const ready = new Promise<unknown>((resolve) => {
          readyResolve = resolve;
        });
        const done = new Promise<unknown>((resolve) => {
          doneResolve = resolve;
        });
        worker.onmessage = (event) => {
          const message = event.data as { type?: string };
          if (message.type === "ready") readyResolve(message);
          else if (message.type === "done") doneResolve(message);
        };
        worker.onerror = (event) => {
          readyResolve({ error: event.message });
          doneResolve({ exitCode: 1, stdout: "", stderr: `Sandbox worker error: ${event.message}`, truncated: false, outputs: [] });
        };
        (globalThis as unknown as { __forma: unknown }).__forma = { worker, ready, done };
        worker.postMessage(data);
      }, WORKER_SOURCE, payload);

      const readyPromise = page.evaluate(() => (globalThis as unknown as { __forma: { ready: Promise<unknown> } }).__forma.ready);
      let ready: { error?: string };
      try {
        ready = (await withTimeout(readyPromise, BOOT_TIMEOUT_MS)) as { error?: string };
      } catch (error) {
        void readyPromise.catch(() => undefined);
        if (error instanceof ExecutionTimeout) {
          throw new RuntimeError("The Python sandbox did not start in time.", { details: { reason: "python-boot-timeout" } });
        }
        throw error;
      }
      if (ready.error) {
        throw new RuntimeError(`The Python sandbox failed to start: ${ready.error}`, {
          details: { reason: "python-boot-failed" },
        });
      }

      const started = Date.now();
      await page.evaluate(() => {
        (globalThis as unknown as { __forma: { worker: Worker } }).__forma.worker.postMessage({ type: "start" });
      });
      const donePromise = page.evaluate(() => (globalThis as unknown as { __forma: { done: Promise<unknown> } }).__forma.done);
      let outcome: {
        exitCode: number;
        stdout: string;
        stderr: string;
        truncated: boolean;
        outputs: Array<{ name: string; base64: string }>;
      };
      try {
        outcome = (await withTimeout(donePromise, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)) as typeof outcome;
      } catch (error) {
        void donePromise.catch(() => undefined);
        if (error instanceof ExecutionTimeout) {
          await page
            .evaluate(() => (globalThis as unknown as { __forma: { worker: Worker } }).__forma.worker.terminate())
            .catch(() => undefined);
          return {
            runtime: runtimeLabel(assets.version),
            exitCode: null,
            stdout: "",
            stderr: "",
            outputTruncated: false,
            timedOut: true,
            durationMs: Date.now() - started,
            inputs: staged.map((entry) => ({ name: entry.name, staged: entry.staged })),
            outputs: [],
          };
        }
        throw error;
      }
      return {
        runtime: runtimeLabel(assets.version),
        exitCode: outcome.exitCode,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        outputTruncated: outcome.truncated,
        timedOut: false,
        durationMs: Date.now() - started,
        inputs: staged.map((entry) => ({ name: entry.name, staged: entry.staged })),
        outputs: outcome.outputs.map((entry) => ({ name: entry.name, data: Buffer.from(entry.base64, "base64") })),
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function runtimeLabel(version: string): string {
  return version ? `Pyodide ${version}` : "Pyodide";
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ExecutionTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
