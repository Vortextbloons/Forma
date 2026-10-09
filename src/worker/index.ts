#!/usr/bin/env node

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { CancellationError, createLogger, createRuntime } from "rig";
import { defaultRigConfig, resolveRigConfig } from "rig/config";
import { RigEventBus } from "rig/events";
import { parseIpcLine } from "rig/ipc";
import { createSessionsFacade } from "rig/sessions";
import type { SessionsFacadeOptions } from "rig/sessions";
import formaAgent from "../agent.ts";
import { WorkerWriter } from "./io.ts";
import { WorkerAgentHost } from "./host.ts";
import { PendingRunRegistry } from "./runs.ts";
import {
  buildDispatcher,
  dispatchCommand,
  isCommandFrame,
  type RuntimeInstance,
  type SessionHandle,
} from "./commands.ts";
import { resultOk } from "./results.ts";
import { repairSessionIndex } from "../projects/sessions.ts";

interface WorkerArgs {
  project: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

function parseArgs(argv: string[]): { ok: true; args: WorkerArgs } | { ok: false; message: string } {
  let project: string | undefined;
  let logLevel: WorkerArgs["logLevel"] = "info";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--project": {
        project = argv[i + 1];
        i += 1;
        break;
      }
      case "--log-level": {
        const value = argv[i + 1];
        if (!value || !(LOG_LEVELS as readonly string[]).includes(value)) {
          return { ok: false, message: `invalid --log-level "${value ?? ""}"` };
        }
        logLevel = value as WorkerArgs["logLevel"];
        i += 1;
        break;
      }
      default:
        return { ok: false, message: `unknown argument "${arg}"` };
    }
  }
  if (!project) return { ok: false, message: "missing required --project <dir>" };
  return { ok: true, args: { project: resolve(project), logLevel } };
}

async function readRigVersion(): Promise<string> {
  try {
    const require = createRequire(import.meta.url);
    const path = require.resolve("rig/package.json");
    const pkg = JSON.parse(await readFile(path, "utf8")) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch {}
  return "0.2.0";
}

async function resolveProjectId(dir: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      name?: unknown;
    };
    if (typeof pkg.name === "string" && pkg.name.length > 0) return pkg.name;
  } catch {}
  return basename(dir);
}

function redirectConsoleToStderr(): void {
  const toStderr = (...args: unknown[]): void => {
    process.stderr.write(args.map((arg) => String(arg)).join(" ") + "\n");
  };
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
}

async function main(): Promise<void> {
  redirectConsoleToStderr();
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`forma worker: ${parsed.message}\n`);
    process.exit(2);
  }
  const { project, logLevel } = parsed.args;
  const logger = createLogger({ level: logLevel, name: "forma-worker" });
  const writer = new WorkerWriter();
  const rigVersion = await readRigVersion();

  try {
    process.chdir(project);
  } catch (error) {
    process.stderr.write(`forma worker: cannot chdir to "${project}": ${String(error)}\n`);
    process.exit(1);
  }

  writer.write({
    v: 1,
    type: "hello",
    pid: process.pid,
    rigVersion,
    nodeVersion: process.version,
  });

  try {
    await repairSessionIndex(project).catch((error: unknown) => {
      logger.warn(`[worker] session index repair failed: ${String(error)}`);
    });
    await run(project, logLevel, { logger, writer, rigVersion });
  } catch (error) {
    logger.error("[worker] fatal init failure:", error);
    writer.write({ v: 1, type: "error", message: String(error), fatal: true });
    await writer.flush();
    process.exit(1);
  }
}

interface BootDeps {
  logger: ReturnType<typeof createLogger>;
  writer: WorkerWriter;
  rigVersion: string;
}

async function run(projectDir: string, logLevel: WorkerArgs["logLevel"], deps: BootDeps): Promise<void> {
  const { logger, writer, rigVersion } = deps;

  const bus = new RigEventBus({ projectId: await resolveProjectId(projectDir) });
  const host = new WorkerAgentHost({ bus, logger });
  const runs = new PendingRunRegistry();

  const config = resolveRigConfig({
    ...defaultRigConfig(),
    workspace: "shared",
    logLevel,
  });

  const runtime: RuntimeInstance = await createRuntime({
    cwd: projectDir,
    model: "auto",
    host,
    bus,
    logger,
    config,
    agent: formaAgent,
  });

  const sessionsOptions: SessionsFacadeOptions = { cwd: runtime.projectDir, host };
  await runtime.attachSessionsFactory((sessionsDeps) =>
    createSessionsFacade(sessionsDeps, sessionsOptions),
  );

  const capabilities = await runtime.capabilities();

  bus.subscribe((event) => {
    writer.write({ v: 1, type: "event", event });
    runs.settleFromEvent(event);
  });

  const getOrCreateSession = async (sessionId?: string): Promise<SessionHandle> => {
    if (sessionId) {
      const existing = runtime.sessions.get(sessionId);
      if (!existing) {
        throw new Error(`Unknown session "${sessionId}"`);
      }
      return existing;
    }
    return runtime.session ?? (await runtime.sessions.create({ name: "Default" }));
  };

  const dispatcher = buildDispatcher({
    runtime,
    host,
    bus,
    logger,
    selectedModel: "auto",
    runs,
    getOrCreateSession,
    defaultSessionId: () => runtime.session?.id,
  });

  writer.write({
    v: 1,
    type: "ready",
    projectId: runtime.projectId,
    projectDir: runtime.projectDir,
    agentName: runtime.agent.name,
    capabilities: {
      git: capabilities.git,
      worktrees: capabilities.worktrees,
      desktop: capabilities.desktop,
      web: capabilities.web,
      mcp: capabilities.mcp,
      subagents: capabilities.subagents,
      models: capabilities.models.length,
      providers: capabilities.providers,
    },
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("[worker] shutting down");
    host.rejectAll(new CancellationError("Worker is shutting down"));
    runs.rejectAll(new CancellationError("Worker is shutting down"));
    try {
      await runtime.close();
    } catch (error) {
      logger.error(`[worker] runtime close failed: ${String(error)}`);
    }
    await writer.flush();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("close", () => void shutdown());
  rl.on("line", (line) => {
    void handleLine(line, { writer, dispatcher, shutdown });
  });
}

interface LoopDeps {
  writer: WorkerWriter;
  dispatcher: ReturnType<typeof buildDispatcher>;
  shutdown: () => Promise<void>;
}

async function handleLine(line: string, deps: LoopDeps): Promise<void> {
  let frame: unknown;
  try {
    frame = parseIpcLine(line);
  } catch (error) {
    deps.writer.write({
      v: 1,
      type: "error",
      message: `Malformed JSON line: ${String(error)}`,
      fatal: false,
    });
    return;
  }
  if (frame === null) return;
  if (!isCommandFrame(frame)) {
    deps.writer.write({
      v: 1,
      type: "error",
      message: "Received a non-command frame; ignoring",
      fatal: false,
    });
    return;
  }
  const command = frame;
  if (command.name === "shutdown") {
    deps.writer.write(resultOk(command.id));
    await deps.shutdown();
    return;
  }
  deps.writer.write(await dispatchCommand(deps.dispatcher, command));
}

void main();
