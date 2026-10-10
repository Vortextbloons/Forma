<script lang="ts">
  import Collapsible from "../../components/Collapsible.svelte";
  import CodeBlock from "../../components/CodeBlock.svelte";
  import ToolHeader from "../../components/ToolHeader.svelte";
  import { asNumber, asRecord, asString, basename, truncate } from "../format";
  import { languageForPath } from "../highlight";
  import type { ToolRendererProps } from "./registry";

  let { tool }: ToolRendererProps = $props();

  const input = $derived(tool ? asRecord(tool.input) : {});
  const path = $derived(
    typeof input.path === "string" ? input.path : tool ? `${tool.toolName} file` : "",
  );

  const output = $derived(tool ? asRecord(tool.output) : {});
  const content = $derived(asString(output.content ?? output.text ?? output));
  const range = $derived(
    asNumber(input.offset) !== undefined || asNumber(input.limit) !== undefined
      ? `${asString(input.offset ?? 0)}..${asString(input.limit ?? "end")}`
      : undefined,
  );

  const isRunning = $derived(tool?.status === "running");
  const isLong = $derived(content.length > 600);

  function preview(): string {
    if (!isLong) return content;
    const lines = content.split(/\r?\n/);
    return lines.slice(0, 40).join("\n") + (lines.length > 40 ? `\n… (${lines.length - 40} more lines)` : "");
  }
</script>

{#if tool}
  <div class="tool-card">
    <ToolHeader name={tool.toolName} status={tool.status} durationMs={tool.durationMs} />
    <div class="tool-body">
      <div class="mono" style="word-break:break-word">{truncate(basename(path), 120)}</div>
      {#if range}
        <div class="muted" style="font-size:11px;margin-top:2px">lines {range}</div>
      {/if}
      {#if tool.error}
        <div class="error-text mono" style="margin-top:6px">
          [{tool.error.code}] {tool.error.message}
        </div>
      {/if}
      {#if !isRunning && !tool.error && content === ""}
        <span class="muted">(empty)</span>
      {/if}
    </div>
    {#if content !== ""}
      <Collapsible title="content" defaultOpen={!isLong}>
        <CodeBlock code={preview()} language={languageForPath(path)} />
      </Collapsible>
    {/if}
  </div>
{/if}
