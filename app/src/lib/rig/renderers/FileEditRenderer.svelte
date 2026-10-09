<script lang="ts">
  import Collapsible from "../../components/Collapsible.svelte";
  import ToolHeader from "../../components/ToolHeader.svelte";
  import { asRecord, asString, basename, prettyJson, truncate } from "../format";
  import type { ToolRendererProps } from "./registry";

  let { tool }: ToolRendererProps = $props();

  const input = $derived(tool ? asRecord(tool.input) : {});
  const path = $derived(
    typeof input.path === "string" ? input.path : tool ? `${tool.toolName} target` : "",
  );
  const oldString = $derived(typeof input.oldString === "string" ? input.oldString : undefined);
  const newString = $derived(typeof input.newString === "string" ? input.newString : undefined);

  const output = $derived(tool ? asRecord(tool.output) : {});
  const changed = $derived(output.changed === true || output.applied === true);
  const lines = $derived(
    typeof output.lines === "number"
      ? String(output.lines)
      : typeof output.lineCount === "number"
        ? String(output.lineCount)
        : undefined,
  );
  const summary = $derived(typeof output.summary === "string" ? output.summary : undefined);
  const hasDiff = $derived(
    typeof output.diff === "string" ||
      typeof input.diff === "string" ||
      (oldString !== undefined && newString !== undefined),
  );

  function isDone(): boolean {
    return tool?.status === "completed" || tool?.status === "failed" || tool?.status === "cancelled";
  }

  function diffText(): string {
    if (typeof output.diff === "string" && output.diff !== "") return output.diff;
    if (typeof input.diff === "string" && input.diff !== "") return input.diff;
    const out: string[] = [];
    if (oldString !== undefined) {
      out.push(`- ${oldString.split("\n")[0]}`);
    }
    if (newString !== undefined) {
      out.push(`+ ${newString.split("\n")[0]}`);
    }
    return out.join("\n");
  }
</script>

{#if tool}
  <div class="tool-card">
    <ToolHeader name={tool.toolName} status={tool.status} durationMs={tool.durationMs} />
    <div class="tool-body">
      <div class="mono" style="word-break:break-word">{truncate(basename(path), 120)}</div>
      {#if summary}
        <div style="margin-top:4px">{summary}</div>
      {/if}
      {#if tool.error}
        <div class="error-text mono" style="margin-top:6px">
          [{tool.error.code}] {tool.error.message}
        </div>
      {/if}
      {#if !isDone() && !tool.error}
        <span class="muted">{tool.status === "running" ? "applying…" : ""}</span>
      {/if}
      {#if changed}
        <div style="margin-top:6px">
          <span class="badge badge-completed">changed{lines ? ` · ${lines} lines` : ""}</span>
        </div>
      {/if}
    </div>
    {#if hasDiff}
      <Collapsible title="diff" defaultOpen={false}>
        <pre class="pre">{diffText()}</pre>
      </Collapsible>
    {/if}
    {#if tool.output !== undefined && !hasDiff}
      <Collapsible title="result" defaultOpen={false}>
        <pre class="pre">{prettyJson(tool.output)}</pre>
      </Collapsible>
    {/if}
  </div>
{/if}
