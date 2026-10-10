import { readFile } from "node:fs/promises";
import { compileModule } from "svelte/compiler";
import ts from "typescript";
import { describe, expect, it } from "vitest";

async function loadMessages() {
  const source = await readFile(new URL("../app/src/lib/rig/stores/messageStore.svelte.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  const compiled = compileModule(js, { generate: "server" }).js.code
    .replace("'svelte/internal/server'", JSON.stringify(import.meta.resolve("svelte/internal/server")))
    .replace(/(["'])\.\.\/format\1/, JSON.stringify(new URL("../app/src/lib/rig/format.ts", import.meta.url).href));
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}#${crypto.randomUUID()}`);
}

describe("chat timeline", () => {
  it("keeps follow-up messages after the previous reply and tools", async () => {
    const store = await loadMessages();
    store.addUserMessage("chat", "hi");
    store.handleEvent({ type: "message.started", sessionId: "chat", seq: 3, data: { message: { id: "reply", role: "assistant", content: "Hello" } } });
    store.handleEvent({ type: "tool.started", sessionId: "chat", seq: 5, data: {} });
    store.addUserMessage("chat", "follow-up");
    const messages = store.bySession("chat").sort((a: { seq: number }, b: { seq: number }) => a.seq - b.seq);
    expect(messages.map((message: { content: string }) => message.content)).toEqual(["hi", "Hello", "follow-up"]);
    expect(messages[2].seq).toBeGreaterThan(5);
    expect(new Set(messages.map((message: { id: string }) => message.id)).size).toBe(3);
  });
  it("restores a saved chat once and places new turns after history", async () => {
    const store = await loadMessages();
    const history = [
      { role: "user", content: "The user is refining the poster.\nUser message:\nMake it blue" },
      { role: "assistant", content: [{ type: "thinking", thinking: "reasoning" }, { type: "text", text: "Done" }] },
    ];
    store.restoreMessages("saved", history);
    store.restoreMessages("saved", history);
    store.addUserMessage("saved", "Thanks");
    expect(store.bySession("saved").map((message: { content: string }) => message.content)).toEqual(["Make it blue", "Done", "Thanks"]);
    expect(store.bySession("saved")[2].seq).toBeGreaterThan(store.bySession("saved")[1].seq);
  });
});

async function loadProjectStore(sendCommand: (name: string, params?: Record<string, unknown>) => Promise<unknown>) {
  const readyCallbacks: Array<() => void | Promise<void>> = [];
  const notices: Array<{ message: string }> = [];
  const pending = new Set<Promise<unknown>>();
  let sessionCount = 0;
  const harness = {
    sendCommand(name: string, params?: Record<string, unknown>) {
      const request = sendCommand(name, params);
      pending.add(request);
      void request.then(() => pending.delete(request), () => pending.delete(request));
      return request;
    },
    getBridge: () => ({
      onReady: (callback: () => void | Promise<void>) => readyCallbacks.push(callback),
      onWorkerExit: () => {},
      onEvent: () => {},
    }),
    openProjectDir: async () => {},
    waitForReady: async () => {},
    notificationStore: { push: (notice: { message: string }) => notices.push(notice) },
    sessionStore: {
      activeSessionId: "project-chat",
      statusOf: () => "idle",
      resume: async () => false,
      select: (id: string) => { harness.sessionStore.activeSessionId = id; },
      newSession: async () => ({ id: `chat-${++sessionCount}` }),
    },
    messageStore: {},
    modelStore: { selectedModel: "auto" },
    isFormaDomainEvent: () => false,
  };
  const key = `forma-project-test-${crypto.randomUUID()}`;
  const globals = globalThis as unknown as Record<string, unknown>;
  globals[key] = harness;
  const shim = `const harness = globalThis[${JSON.stringify(key)}];
` + Object.keys(harness).map((name) => `export const ${name} = harness.${name};`).join("\n");
  const shimUrl = `data:text/javascript;base64,${Buffer.from(shim).toString("base64")}`;
  const source = await readFile(new URL("../app/src/lib/forma/projectStore.svelte.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  const compiled = compileModule(js, { generate: "server" }).js.code
    .replace(/(['"])svelte\/internal\/server\1/, JSON.stringify(import.meta.resolve("svelte/internal/server")))
    .replace(/(['"])\.\/types\1/, JSON.stringify(new URL("../app/src/lib/forma/types.ts", import.meta.url).href))
    .replace(/(['"])\.\.\/rig\/[^'"]+\1/g, JSON.stringify(shimUrl));
  const module = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}#${crypto.randomUUID()}`);
  return {
    store: module.projectStore,
    notices,
    get sessionCount() { return sessionCount; },
    async reconnect() {
      await Promise.all(readyCallbacks.map((callback) => callback()));
      await new Promise(setImmediate);
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
        await new Promise(setImmediate);
      }
    },
    close() { delete globals[key]; },
  };
}

describe("project conversation lifecycle", () => {
  it.each(["saved", "missing"])("ignores a late %s conversation result after closing the project", async (result) => {
    const dir = "C:\\Forma-test\\projects\\closed-project";
    const project = { id: "closed-project", formatVersion: 1, name: "Closed project", settings: {}, context: [], pages: [], conversation: { sessionIds: [] } };
    let finish!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    const conversationResult = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    let writes = 0;
    const harness = await loadProjectStore(async (name) => {
      if (name === "project.setConversation" && ++writes === 2) return conversationResult;
      if (name === "project.open" || name === "project.setConversation") return { project: { dir, project } };
      if (name === "project.list") return { home: "C:\\Forma-test\\projects", projects: [{ dir, project }] };
      return {};
    });
    try {
      await harness.store.openProject(dir);
      const chat = harness.store.newChat();
      await new Promise(setImmediate);
      expect(writes).toBe(2);
      await harness.store.closeProject();
      if (result === "saved") finish({ project: { dir, project } });
      else fail(new Error(`No project found in "${dir}"`));
      await chat;
      expect(harness.store.current).toBeNull();
      expect(harness.notices).toEqual([]);
    } finally {
      finish({ project: { dir, project } });
      harness.close();
    }
  });

  it("does not record a conversation in a missing project after the worker reconnects", async () => {
    const dir = "C:\\Forma-test\\projects\\removed-project";
    const project = { id: "removed-project", formatVersion: 1, name: "Removed project", prompt: "A brief", settings: {}, context: [], pages: [], conversation: { sessionIds: [] } };
    let missing = false;
    const harness = await loadProjectStore(async (name) => {
      if (name === "project.open" || name === "project.setConversation") {
        if (missing) throw Object.assign(new Error(`No project found in "${dir}"`), { details: { dir, reason: "project-not-found" } });
        return { project: { dir, project } };
      }
      if (name === "project.list") return { home: "C:\\Forma-test\\projects", projects: missing ? [] : [{ dir, project }] };
      return {};
    });
    try {
      await harness.store.openProject(dir);
      expect(harness.sessionCount).toBe(1);
      missing = true;
      await harness.reconnect();
      expect(harness.notices.filter((notice) => notice.message.startsWith("Could not record the conversation"))).toEqual([]);
      expect(harness.store.current).toBeNull();
      expect(harness.sessionCount).toBe(1);
    } finally {
      harness.close();
    }
  });
});
