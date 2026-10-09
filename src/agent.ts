import { defineAgent, tools } from "rig";
import { customTools } from "./tools/index.ts";

export default defineAgent({
  name: "forma",
  description: "forma agent built on Rig",
  instructions:
    "You are the forma agent.\n" +
    "Work inside the project workspace. Prefer the provided tools over " +
    "guesswork: read/search files before editing, ask the user when a " +
    "decision is needed, and keep a todo list for multi-step work.",
  model: "auto",
  tools: [
    tools.files.read(),
    tools.files.search(),
    ...customTools,
  ],
});
