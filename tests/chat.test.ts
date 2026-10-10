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
