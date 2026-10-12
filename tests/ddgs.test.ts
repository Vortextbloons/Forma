import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeDdgsHelpers,
  resolveDdgsCommand,
  searchDdgsImages,
  searchDdgsText,
  type DdgsCommand,
} from "../src/search/ddgs.ts";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, existsSync: vi.fn(original.existsSync) };
});

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "forma-ddgs-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function fixture(name: string, source: string): Promise<DdgsCommand> {
  const dir = await mkdtemp(join(root, name));
  const script = join(dir, "fixture.mjs");
  await writeFile(script, source);
  return { python: process.execPath, script };
}

function okSource(results: unknown, delayMs = 0): string {
  const payload = JSON.stringify(JSON.stringify({ ok: true, results }));
  return [
    'let input = "";',
    'process.stdin.on("data", (chunk) => (input += chunk));',
    'process.stdin.on("end", () => {',
    `  setTimeout(() => process.stdout.write(${payload} + "\\n"), ${delayMs});`,
    "});",
  ].join("\n");
}

function startLogSource(log: string, delayMs: number): string {
  return [
    'import { appendFileSync } from "node:fs";',
    'let input = "";',
    'process.stdin.on("data", (chunk) => (input += chunk));',
    'process.stdin.on("end", () => {',
    `  appendFileSync(${JSON.stringify(log)}, "start\\n");`,
    `  setTimeout(() => process.stdout.write(${JSON.stringify(JSON.stringify({ ok: true, results: [] }))} + "\\n"), ${delayMs});`,
    "});",
  ].join("\n");
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

describe("ddgs subprocess adapter", () => {
  it("uses the development runtime when Node has no bundled Python", () => {
    vi.stubEnv("FORMA_DDGS_PYTHON", undefined);
    const bundled = join(dirname(process.execPath), "ddgs", "python.exe");
    try {
      vi.mocked(existsSync).mockReturnValueOnce(false);
      expect(resolveDdgsCommand().python).toBe(
        fileURLToPath(new URL("../desktop/bin/ddgs/Scripts/python.exe", import.meta.url)),
      );
      vi.mocked(existsSync).mockReturnValueOnce(true);
      expect(resolveDdgsCommand().python).toBe(bundled);
      vi.stubEnv("FORMA_DDGS_PYTHON", "custom-python.exe");
      expect(resolveDdgsCommand().python).toBe("custom-python.exe");
    } finally {
      vi.mocked(existsSync).mockClear();
      vi.unstubAllEnvs();
    }
  });
  it("returns normalized text and image results", async () => {
    const text = await fixture(
      "ok-text",
      okSource([{ title: "T", url: "https://example.com/a", snippet: "S" }]),
    );
    await expect(searchDdgsText("query", 3, undefined, text)).resolves.toEqual([
      { title: "T", url: "https://example.com/a", snippet: "S" },
    ]);
    const images = await fixture(
      "ok-images",
      okSource([{ title: "P", imageUrl: "https://example.com/p.jpg", width: 10, height: 20 }]),
    );
    await expect(searchDdgsImages("query", 3, undefined, images)).resolves.toEqual([
      { title: "P", imageUrl: "https://example.com/p.jpg", width: 10, height: 20 },
    ]);
  });

  it("reports helper failures and malformed output", async () => {
    const failed = await fixture(
      "failed",
      [
        'let input = "";',
        'process.stdin.on("data", (chunk) => (input += chunk));',
        'process.stdin.on("end", () => {',
        '  process.stdout.write(JSON.stringify({ ok: false, error: "no results" }) + "\\n");',
        "  process.exit(1);",
        "});",
      ].join("\n"),
    );
    await expect(searchDdgsText("query", 1, undefined, failed)).rejects.toThrow(/no results/);

    const malformed = await fixture("malformed", 'process.stdout.write("not json\\n");');
    await expect(searchDdgsText("query", 1, undefined, malformed)).rejects.toThrow(
      /malformed output/,
    );

    const badResults = await fixture("bad-results", okSource([{ title: 5 }]));
    await expect(searchDdgsText("query", 1, undefined, badResults)).rejects.toThrow(
      /malformed results/,
    );

    const crashed = await fixture("crashed", "process.exit(3);");
    await expect(searchDdgsText("query", 1, undefined, crashed)).rejects.toThrow(/no result/);
  });

  it("enforces the overall deadline", async () => {
    const hang = await fixture("hang", "setInterval(() => {}, 1000);");
    await expect(searchDdgsText("query", 1, undefined, { ...hang, deadlineMs: 250 })).rejects.toThrow(
      /timed out/,
    );
  });

  it("cancels active helpers and skips queued cancelled requests", async () => {
    const activeLog = join(root, "active.log");
    const active = await fixture("active", startLogSource(activeLog, 10_000));
    const controller = new AbortController();
    const pending = searchDdgsText("first", 1, controller.signal, active);
    await waitForFile(activeLog);
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);

    const slowLog = join(root, "slow.log");
    const queuedLog = join(root, "queued.log");
    const slow = await fixture("slow", startLogSource(slowLog, 300));
    const queued = await fixture("queued", startLogSource(queuedLog, 0));
    const first = searchDdgsText("slow", 1, undefined, slow);
    const second = searchDdgsText("queued", 1, AbortSignal.abort(), queued);
    await first;
    await expect(second).rejects.toThrow(/cancelled/);
    expect(existsSync(queuedLog)).toBe(false);
  });

  it("terminates active helpers on shutdown", async () => {
    const log = join(root, "shutdown.log");
    const hang = await fixture("shutdown", startLogSource(log, 10_000));
    const pending = searchDdgsText("shutdown", 1, undefined, hang);
    await waitForFile(log);
    closeDdgsHelpers();
    await expect(pending).rejects.toThrow(/no result/);
  });
});
