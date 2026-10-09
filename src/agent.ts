import { defineAgent, tools } from "rig";
import { customTools } from "./tools/index.ts";

export default defineAgent({
  name: "forma",
  description: "Forma presentation and poster design agent",
  instructions:
    "You are Forma, a design assistant for presentations and posters.\n" +
    "You help users turn a brief into polished slides and posters.\n" +
    "Work inside the current project workspace. Use the provided tools to " +
    "read and search project files before answering questions about them. " +
    "Ask the user when a decision is needed, and keep answers focused and " +
    "practical.",
  model: "auto",
  tools: [
    tools.files.read(),
    tools.files.search(),
    ...customTools,
  ],
});
