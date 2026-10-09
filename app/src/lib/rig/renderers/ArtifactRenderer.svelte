<script lang="ts">
  import ToolHeader from "../../components/ToolHeader.svelte";
  import Icon from "../../components/Icon.svelte";
  import { asRecord, asString, basename, truncate } from "../format";
  import type { ToolRendererProps } from "./registry";

  let { tool }: ToolRendererProps = $props();

  const input = $derived(tool ? asRecord(tool.input) : {});
  const type = $derived(asString(input.type ?? "text"));
  const title = $derived(
    typeof input.title === "string" ? input.title : typeof input.path === "string" ? basename(input.path) : `${type} artifact`,
  );
  const path = $derived(typeof input.path === "string" ? input.path : undefined);
  const url = $derived(typeof input.url === "string" ? input.url : undefined);
  const content = $derived(
    typeof input.content === "string" ? input.content : typeof input.diff === "string" ? input.diff : "",
  );
</script>

{#if tool}
  <div class="tool-card">
    <ToolHeader name={tool.toolName} status={tool.status} durationMs={tool.durationMs} />
    <div class="tool-body">
      <div style="display:flex;align-items:center;gap:6px">
        <Icon name={type === "url" ? "link" : type === "diff" ? "code" : "file"} size={14} />
        <span style="font-weight:600">{truncate(title, 120)}</span>
      </div>
      {#if path}
        <div class="muted mono" style="margin-top:2px">{path}</div>
      {/if}
      {#if url}
        <div class="muted mono" style="margin-top:2px">{url}</div>
      {/if}
      {#if tool.error}
        <div class="error-text mono" style="margin-top:6px">
          [{tool.error.code}] {tool.error.message}
        </div>
      {/if}
    </div>
    {#if content !== ""}
      <pre class="pre" style="max-height:200px">{truncate(content, 1200)}</pre>
    {/if}
  </div>
{/if}
