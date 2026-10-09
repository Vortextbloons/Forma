<script lang="ts">
  import { modelStore } from "../rig/stores/modelStore.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { usageStore } from "../rig/stores/usageStore.svelte";

  const usage = $derived(usageStore.bySession(sessionStore.activeSessionId));
  const model = $derived(modelStore.selectedInfo());
  const used = $derived(usage?.total ?? ((usage?.input ?? 0) + (usage?.output ?? 0)));
  const limit = $derived(model?.contextWindow ?? 0);
  const percent = $derived(limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0);

  function compactTokens(value: number): string {
    if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}m`;
    if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
    return String(value);
  }
</script>

<div class="context-indicator-wrap">
  <button
    class="context-indicator"
    class:context-indicator-warning={percent >= 80}
    type="button"
    style={`--context-used: ${percent * 3.6}deg`}
    aria-label={limit > 0 ? `Context window ${percent}% full` : "Context usage unavailable"}
    aria-describedby="context-usage-popover"
  >
    <span></span>
  </button>
  <div class="context-popover" id="context-usage-popover" role="tooltip">
    <span>Context window:</span>
    {#if limit > 0}
      <strong>{percent}% full</strong>
      <b>{compactTokens(used)} / {compactTokens(limit)} tokens used</b>
    {:else}
      <strong>Unavailable</strong>
      <b>The selected model did not report a limit</b>
    {/if}
  </div>
</div>
