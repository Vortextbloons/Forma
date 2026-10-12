#!/usr/bin/env node

import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  CancellationError,
  createLogger,
  createRuntime,
  ProtocolError,
  RuntimeError,
  serializeError,
} from "rig";
import { defaultRigConfig, resolveRigConfig } from "rig/config";
import { RigEventBus } from "rig/events";
import { parseIpcLine } from "rig/ipc";
import { createSessionsFacade } from "rig/sessions";
import formaAgent from "../agent.ts";
import { WorkerWriter } from "./io.ts";
import { WorkerAgentHost } from "./host.ts";
import { PendingRunRegistry } from "./runs.ts";
import { createFormaEventSink } from "../forma/events.ts";
import { projectRuns, setFormaEnv } from "../forma/runtime.ts";
import { closeOcrWorker } from "../extraction/ocr.ts";
import { closeBrowser } from "../rendering/browser.ts";
import { closeDdgsHelpers } from "../search/ddgs.ts";
import { clearSessionTools } from "../tools/lazy.ts";
import {
  buildDispatcher,
  dispatchCommand,
  isCommandFrame,
  type CommandFrame,
  type CommandHandler,
  type RuntimeInstance,
  type SessionHandle,
  type WorkerContext,
} from "./commands.ts";
import { resultErr, resultOk } from "./results.ts";
import { repairSessionIndex } from "../projects/sessions.ts";
import { PROJECT_FILE } from "../projects/schema.ts";

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
    await run(project, logLevel, { logger, writer });
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
}

type CreateRuntimeOptions = Parameters<typeof createRuntime>[0];
type SharedModelRuntime = NonNullable<CreateRuntimeOptions["modelRuntime"]>;

interface Workspace {
  projectDir: string;
  projectId: string;
  agentName: string;
  capabilities: Awaited<ReturnType<RuntimeInstance["capabilities"]>>;
  runtime: RuntimeInstance;
  dispatcher: Record<string, CommandHandler>;
  host: WorkerAgentHost;
  runs: PendingRunRegistry;
}

async function run(projectDir: string, logLevel: WorkerArgs["logLevel"], deps: BootDeps): Promise<void> {
  const { logger, writer } = deps;

  const config = resolveRigConfig({
    ...defaultRigConfig(),
    workspace: "shared",
    capabilities: { question: true, todo: true },
    logLevel,
  });

  let active: Workspace | undefined;
  let switching: Promise<void> | undefined;
  let sharedModelRuntime: SharedModelRuntime | undefined;

  const activate = async (dir: string): Promise<void> => {
    const target = resolve(dir);
    const previous = active;

    await repairSessionIndex(target).catch((error: unknown) => {
      logger.warn(`[worker] session index repair failed: ${String(error)}`);
    });

    const bus = new RigEventBus({ projectId: await resolveProjectId(target) });
    const host = new WorkerAgentHost({ bus, logger });
    const runs = new PendingRunRegistry();

    const runtime: RuntimeInstance = await createRuntime({
      cwd: target,
      model: "auto",
      host,
      bus,
      logger,
      config,
      agent: formaAgent,
      ...(sharedModelRuntime ? { modelRuntime: sharedModelRuntime } : { modelRefresh: true }),
    });
    sharedModelRuntime ??= (runtime.pi as { modelRuntime: SharedModelRuntime }).modelRuntime;

    await runtime.attachSessionsFactory((sessionsDeps) =>
      createSessionsFacade(sessionsDeps, { cwd: runtime.projectDir, host }),
    );

    const capabilities = await runtime.capabilities();

    const formaEvents = createFormaEventSink((message) => writer.write(message), runtime.projectId);
    setFormaEnv({ projectDir: runtime.projectDir, events: formaEvents, host });

    if (previous) {
      previous.host.rejectAll(new CancellationError("Project switched"));
      previous.runs.rejectAll(new CancellationError("Project switched"));
      projectRuns.clear();
      clearSessionTools();
      try {
        await previous.runtime.close();
      } catch (error) {
        logger.error(`[worker] runtime close failed: ${String(error)}`);
      }
    }

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

    const ctx: WorkerContext = {
      runtime,
      host,
      bus,
      logger,
      selectedModel: "auto",
      runs,
      formaEvents,
      getOrCreateSession,
      defaultSessionId: () => runtime.session?.id,
    };

    active = {
      projectDir: runtime.projectDir,
      projectId: runtime.projectId,
      agentName: runtime.agent.name,
      capabilities,
      runtime,
      dispatcher: buildDispatcher(ctx),
      host,
      runs,
    };

    writeReady(writer, active);
  };

  await activate(projectDir);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("[worker] shutting down");
    active?.host.rejectAll(new CancellationError("Worker is shutting down"));
    active?.runs.rejectAll(new CancellationError("Worker is shutting down"));
    await closeBrowser().catch(() => undefined);
    await closeOcrWorker().catch(() => undefined);
    closeDdgsHelpers();
    try {
      await active?.runtime.close();
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
    void (async () => {
      while (switching) await switching;
      const command = parseCommandFrame(line, writer);
      if (!command) return;
      if (command.name === "shutdown") {
        writer.write(resultOk(command.id));
        await shutdown();
        return;
      }
      if (command.name === "workspace.switch") {
        const dir = asDir(command.params);
        if (!dir) {
          writer.write(
            resultErr(
              command.id,
              serializeError(
                new ProtocolError(`Missing or invalid parameter "dir" (expected non-empty string)`),
              ),
            ),
          );
          return;
        }
        let settleSwitch!: () => void;
        switching = new Promise<void>((settle) => (settleSwitch = settle));
        try {
          const target = resolve(dir);
          const projectFile = await stat(join(target, PROJECT_FILE)).catch(() => undefined);
          if (!projectFile) {
            throw new RuntimeError(`No project found in "${target}"`, {
              details: { dir: target, reason: "project-not-found" },
            });
          }
          await activate(target);
          writer.write(resultOk(command.id));
        } catch (error) {
          writer.write(resultErr(command.id, serializeError(error)));
        } finally {
          settleSwitch();
          switching = undefined;
        }
        return;
      }
      const dispatcher = active?.dispatcher;
      if (!dispatcher) return;
      writer.write(await dispatchCommand(dispatcher, command));
    })();
  });
}

function writeReady(writer: WorkerWriter, workspace: Workspace): void {
  writer.write({
    v: 1,
    type: "ready",
    projectId: workspace.projectId,
    projectDir: workspace.projectDir,
    agentName: workspace.agentName,
    capabilities: {
      git: workspace.capabilities.git,
      worktrees: workspace.capabilities.worktrees,
      desktop: workspace.capabilities.desktop,
      web: workspace.capabilities.web,
      mcp: workspace.capabilities.mcp,
      subagents: workspace.capabilities.subagents,
      models: workspace.capabilities.models.length,
      providers: workspace.capabilities.providers,
    },
  });
}

function asDir(params: Record<string, unknown> | undefined): string | undefined {
  const dir = params?.dir;
  return typeof dir === "string" && dir.length > 0 ? dir : undefined;
}

function parseCommandFrame(line: string, writer: WorkerWriter): CommandFrame | undefined {
  let frame: unknown;
  try {
    frame = parseIpcLine(line);
  } catch (error) {
    writer.write({
      v: 1,
      type: "error",
      message: `Malformed JSON line: ${String(error)}`,
      fatal: false,
    });
    return undefined;
  }
  if (frame === null) return undefined;
  if (!isCommandFrame(frame)) {
    writer.write({
      v: 1,
      type: "error",
      message: "Received a non-command frame; ignoring",
      fatal: false,
    });
    return undefined;
  }
  return frame;
}

void main();
