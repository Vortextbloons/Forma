<script lang="ts">
  import Collapsible from "../../components/Collapsible.svelte";
  import ToolHeader from "../../components/ToolHeader.svelte";
  import { asRecord, asString } from "../format";
  import { subagentStore } from "../stores/subagentStore.svelte";
  import type { ToolRendererProps } from "./registry";

  let { sessionId, tool }: ToolRendererProps = $props();

  const input = $derived(tool ? asRecord(tool.input) : {});
  const task = $derived(asString(input.task));
  const subagentName = $derived(
    typeof input.name === "string"
      ? input.name
      : typeof input.agentName === "string"
        ? input.agentName
        : undefined,
  );

  const live = $derived(
    subagentName ? subagentStore.bySession(sessionId).filter((s) => s.name === subagentName) : [],
  );
  const latest = $derived(live[live.length - 1]);

  const output = $derived(tool ? asRecord(tool.output) : {});
  const resultText = $derived(
    typeof output.result === "string" ? output.result : undefined,
  );
  const hasResult = $derived(tool?.output !== undefined && !tool?.error);
</script>

{#if tool}
  <div class="tool-card">
    <ToolHeader name={tool.toolName} status={latest?.status ?? tool.status} durationMs={latest?.durationMs ?? tool.durationMs} />
    <div class="tool-body">
      {#if subagentName}
        <div><span class="muted">agent: </span><span class="mono">{subagentName}</span></div>
      {/if}
      {#if task}
        <div style="margin-top:2px;word-break:break-word">{task}</div>
      {/if}
      {#if latest?.message}
        <div class="muted" style="margin-top:4px">{latest.message}</div>
      {/if}
      {#if tool.error}
        <div class="error-text mono" style="margin-top:6px">
          [{tool.error.code}] {tool.error.message}
        </div>
      {/if}
    </div>
    {#if latest && latest.recentTools.length > 0}
      <Collapsible title="recent tools" defaultOpen={false}>
        <div class="tool-body" style="display:flex;flex-wrap:wrap;gap:4px">
          {#each latest.recentTools as name (name)}
            <span class="chip mono">{name}</span>
          {/each}
        </div>
      </Collapsible>
    {/if}
    {#if hasResult}
      <Collapsible title="result" defaultOpen={false}>
        <pre class="pre">{resultText ?? JSON.stringify(tool.output, null, 2)}</pre>
      </Collapsible>
    {/if}
  </div>
{/if}
