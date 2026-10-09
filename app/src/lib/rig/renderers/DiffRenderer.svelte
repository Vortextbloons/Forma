<script lang="ts">
  import Collapsible from "../../components/Collapsible.svelte";
  import ToolHeader from "../../components/ToolHeader.svelte";
  import { asRecord, asString, parseDiff } from "../format";
  import type { ToolRendererProps } from "./registry";

  let { tool }: ToolRendererProps = $props();

  const input = $derived(tool ? asRecord(tool.input) : {});
  const output = $derived(tool ? asRecord(tool.output) : {});
  const diffText = $derived(
    typeof output.diff === "string" && output.diff !== ""
      ? output.diff
      : typeof input.diff === "string" && input.diff !== ""
        ? input.diff
        : "",
  );
  const path = $derived(
    typeof output.path === "string"
      ? output.path
      : typeof input.path === "string"
        ? input.path
        : "",
  );
  const lines = $derived(diffText === "" ? [] : parseDiff(diffText));
  const long = $derived(lines.length > 200);

  function visible(): { type: string; text: string }[] {
    if (!long) return lines;
    return lines.slice(0, 200);
  }
</script>

{#if tool}
  <div class="tool-card">
    <ToolHeader name={tool.toolName} status={tool.status} durationMs={tool.durationMs} />
    <div class="tool-body">
      {#if path}
        <div class="mono" style="word-break:break-word">{path}</div>
      {/if}
      {#if tool.error}
        <div class="error-text mono" style="margin-top:6px">
          [{tool.error.code}] {tool.error.message}
        </div>
      {/if}
      {#if !tool.error && diffText === ""}
        <span class="muted">{tool.status === "running" ? "generating diff…" : "no diff"}</span>
      {/if}
    </div>
    {#if lines.length > 0}
      <Collapsible title={`diff · ${lines.length} lines`} defaultOpen={!long}>
        <pre class="pre" style="max-height:420px">
{#each visible() as line}<span class="diff-line diff-{line.type}">{line.text}</span>
{/each}{#if long}
… ({lines.length - 200} more lines)
{/if}</pre>
      </Collapsible>
    {/if}
  </div>
{/if}
