










import type { Component } from "svelte";
import type { ToolCallEntry } from "../stores/toolStore.svelte";
import type { InteractionState } from "../stores/messageStore.svelte";
import GenericToolRenderer from "./GenericToolRenderer.svelte";

export interface ToolRendererProps {
  sessionId: string;
  tool?: ToolCallEntry;
  interaction?: InteractionState;
}

export type ToolRendererComponent = Component<ToolRendererProps>;

export const GENERIC_RENDERER_NAME = "generic";

const registry = new Map<string, ToolRendererComponent>();


const ALIASES: Record<string, string> = {
  bash: "shell",
  powershell: "shell",
  cmd: "shell",
  run_command: "shell",
  exec: "shell",
  read: "file_read",
  read_file: "file_read",
  view: "file_read",
  grep: "file_read",
  ls: "file_read",
  find: "file_read",
  write: "file_edit",
  write_file: "file_edit",
  edit: "file_edit",
  edit_file: "file_edit",
  patch: "file_edit",
  websearch: "web_search",
  search_web: "web_search",
  question: "ask_user_question",
  ask_user: "ask_user_question",
  ask_question: "ask_user_question",
  propose_design: "ask_user_question",
  delegate: "subagent",
  run_agent: "subagent",
  subagent_run: "subagent",
  git_diff: "diff",
  emit_artifact: "artifact",
};

export function registerToolRenderer(name: string, component: ToolRendererComponent): void {
  registry.set(name, component);
}

export function registerToolRendererAlias(alias: string, target: string): void {
  ALIASES[alias] = target;
}

export function getToolRenderer(name: string): ToolRendererComponent {
  const exact = registry.get(name);
  if (exact) return exact;
  const target = ALIASES[name];
  if (target) {
    const viaAlias = registry.get(target);
    if (viaAlias) return viaAlias;
  }
  return registry.get(GENERIC_RENDERER_NAME) ?? GenericToolRenderer;
}
