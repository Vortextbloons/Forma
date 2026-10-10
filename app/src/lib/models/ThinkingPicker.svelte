<script module lang="ts">
  import { THINKING_LEVELS } from "../rig/types";
  import type { ThinkingLevel } from "../rig/types";

  const LABELS: Record<ThinkingLevel, string> = {
    off: "Off",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
    max: "Maximum",
  };
</script>

<script lang="ts">
  import { modelStore } from "../rig/stores/modelStore.svelte";

  function onSelect(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!(THINKING_LEVELS as readonly string[]).includes(value)) return;
    void modelStore.setThinkingLevel(value as ThinkingLevel);
  }
</script>

{#if modelStore.selectedInfo()?.reasoning}
  <select
    class="select thinking-select"
    aria-label="Reasoning effort"
    title="Reasoning effort"
    value={modelStore.thinkingLevel}
    onchange={onSelect}
  >
    {#each THINKING_LEVELS as level (level)}
      <option value={level}>{LABELS[level]}</option>
    {/each}
  </select>
{/if}