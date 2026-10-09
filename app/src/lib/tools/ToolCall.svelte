<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import StatusBadge from "../components/StatusBadge.svelte";
  import { getToolRenderer } from "../rig/renderers/registry";
  import { asRecord, asString, basename, formatDuration, truncate } from "../rig/format";
  import type { ToolCallEntry } from "../rig/stores/toolStore.svelte";

  let { sessionId, tool }: { sessionId: string; tool: ToolCallEntry } = $props();

  const Renderer = $derived(getToolRenderer(tool.toolName));
  const active = $derived(tool.status === "running");
  let open = $derived(active);
  const summary = $derived.by(() => {
    const input = asRecord(tool.input);
    const value = input.command ?? input.query ?? input.path ?? input.file ?? input.task ?? input.prompt;
    if (typeof value !== "string" || value.trim() === "") return "";
    const text = input.path !== undefined || input.file !== undefined ? basename(value) : asString(value);
    return truncate(text.replace(/\s+/g, " "), 92);
  });
</script>

<div class="tool-call-shell" class:tool-call-open={open}>
  <button class="tool-call-summary" type="button" onclick={() => (open = !open)} aria-expanded={open}>
    <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
    <span class="tool-call-name">{tool.toolName}</span>
    {#if summary}<span class="tool-call-input">{summary}</span>{/if}
    <span class="composer-spacer"></span>
    <StatusBadge status={tool.status} />
    {#if tool.durationMs !== undefined}
      <span class="tool-call-duration">{formatDuration(tool.durationMs)}</span>
    {/if}
  </button>
  {#if open}
    <div class="tool-call-detail">
      <Renderer {sessionId} {tool} />
    </div>
  {/if}
</div>
