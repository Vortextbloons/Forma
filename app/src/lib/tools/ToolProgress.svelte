<script lang="ts">
  import type { ToolCallEntry } from "../rig/stores/toolStore.svelte";

  let { tool }: { tool: ToolCallEntry } = $props();

  const pct = $derived(
    tool.progress?.current !== undefined && tool.progress?.total
      ? Math.min(100, Math.round((tool.progress.current / tool.progress.total) * 100))
      : undefined,
  );
</script>

{#if tool.progress?.message}
  <div class="muted" style="font-size:12px">{tool.progress.message}</div>
{/if}
{#if pct !== undefined}
  <div class="progress-track" style="margin-top:4px" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
    <div class="progress-fill" style="width:{pct}%"></div>
  </div>
  <div class="muted" style="font-size:11px;margin-top:2px">
    {tool.progress?.current} / {tool.progress?.total}
  </div>
{/if}
