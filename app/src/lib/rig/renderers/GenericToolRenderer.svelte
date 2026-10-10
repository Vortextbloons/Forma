<script lang="ts">
  import Collapsible from "../../components/Collapsible.svelte";
  import CodeBlock from "../../components/CodeBlock.svelte";
  import ToolHeader from "../../components/ToolHeader.svelte";
  import ToolProgress from "../../tools/ToolProgress.svelte";
  import { prettyJson } from "../format";
  import type { ToolRendererProps } from "./registry";

  let { tool }: ToolRendererProps = $props();

  const inputText = $derived(tool ? prettyJson(tool.input) : "");
  const outputText = $derived(
    tool && tool.output !== undefined ? prettyJson(tool.output) : "",
  );
  const outputLanguage = $derived(typeof tool?.output === "string" ? undefined : "json");
  const hasInput = $derived(tool !== undefined && Object.keys(tool.input).length > 0);
  const hasOutput = $derived(tool?.output !== undefined);
  const isRunning = $derived(tool?.status === "running");
</script>

{#if tool}
  <div class="tool-card">
    <ToolHeader name={tool.toolName} status={tool.status} durationMs={tool.durationMs} />
    <div class="tool-body">
      {#if tool.progress?.message}
        <ToolProgress {tool} />
      {/if}
      {#if tool.error}
        <div class="error-text mono">[{tool.error.code}] {tool.error.message}</div>
      {/if}
      {#if !hasInput && !hasOutput && !tool.error}
        <span class="muted">{isRunning ? "working…" : "no data"}</span>
      {/if}
    </div>
    {#if hasInput}
      <Collapsible title="input" defaultOpen={false}>
        <CodeBlock code={inputText} language="json" />
      </Collapsible>
    {/if}
    {#if hasOutput}
      <Collapsible title="output" defaultOpen={false}>
        <CodeBlock code={outputText} language={outputLanguage} />
      </Collapsible>
    {/if}
  </div>
{/if}
