





import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  createTestRuntime,
  waitForEvent,
  fauxAssistantMessage,
} from "rig/testing";

describe("forma agent", () => {
  it("defines the agent and completes a scripted run", async () => {
    const runtime = await createTestRuntime({
      cwd: join(import.meta.dirname, ".."),
      agent: "./src/agent.ts",
      responses: [
        fauxAssistantMessage("Hello from the scripted model", { stopReason: "stop" }),
      ],
    });
    try {
      expect(runtime.agent.name).toBe("forma");

      await runtime.prompt("say hello");
      const message = await waitForEvent(runtime, "message.completed", (event) =>
        event.data.message.role === "assistant",
      );
      expect(message.data.message.content).toContain("Hello from the scripted model");
    } finally {
      await runtime.close();
    }
  }, 60_000);
});
