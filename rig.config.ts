import { defineConfig } from "rig";

export default defineConfig({
  agent: "./src/agent.ts",
  workspace: "auto",
  desktop: { enabled: true, name: "forma" },
  capabilities: {
    question: true,
    todo: true,
  },
  logLevel: "info",
});
