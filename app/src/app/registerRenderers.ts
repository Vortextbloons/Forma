



















































import type { Component } from "svelte";
import {
  registerToolRenderer,
  registerToolRendererAlias,
  type ToolRendererComponent,
  type ToolRendererProps,
} from "../lib/rig/renderers/registry";

import GenericToolRenderer from "../lib/rig/renderers/GenericToolRenderer.svelte";
import ShellRenderer from "../lib/rig/renderers/ShellRenderer.svelte";
import FileReadRenderer from "../lib/rig/renderers/FileReadRenderer.svelte";
import FileEditRenderer from "../lib/rig/renderers/FileEditRenderer.svelte";
import DiffRenderer from "../lib/rig/renderers/DiffRenderer.svelte";
import WebSearchRenderer from "../lib/rig/renderers/WebSearchRenderer.svelte";
import QuestionRenderer from "../lib/rig/renderers/QuestionRenderer.svelte";
import TodoRenderer from "../lib/rig/renderers/TodoRenderer.svelte";
import SubagentRenderer from "../lib/rig/renderers/SubagentRenderer.svelte";
import ArtifactRenderer from "../lib/rig/renderers/ArtifactRenderer.svelte";


export function registerDefaultRenderers(): void {
  registerToolRenderer("generic", GenericToolRenderer);
  registerToolRenderer("shell", ShellRenderer);
  registerToolRenderer("file_read", FileReadRenderer);
  registerToolRenderer("file_edit", FileEditRenderer);
  registerToolRenderer("diff", DiffRenderer);
  registerToolRenderer("web_search", WebSearchRenderer);
  registerToolRenderer("ask_user_question", QuestionRenderer);
  registerToolRenderer("todo", TodoRenderer);
  registerToolRenderer("subagent", SubagentRenderer);
  registerToolRenderer("artifact", ArtifactRenderer);


  registerToolRendererAlias("grep_search", "web_search");
  registerToolRendererAlias("run", "shell");
  registerToolRendererAlias("agent", "subagent");
}





export function registerCustomRenderer(
  name: string,
  component: Component<ToolRendererProps> | ToolRendererComponent,
): void {
  registerToolRenderer(name, component as ToolRendererComponent);
}
