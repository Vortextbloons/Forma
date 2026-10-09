<script lang="ts">
  import type { ThinkingEntry } from "../rig/stores/messageStore.svelte";
  import Icon from "../components/Icon.svelte";

  let { entry }: { entry: ThinkingEntry } = $props();

  let open = $state(true);
  $effect(() => {
    if (entry.complete) open = false;
  });
</script>

{#if entry.content !== "" || !entry.complete}
  <div class="thinking">
    <button class="thinking-head" type="button" onclick={() => (open = !open)} aria-expanded={open}>
      <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
      <span>{entry.complete ? "thinking" : "thinking…"}</span>
    </button>
    {#if open}
      <div class="thinking-body">{entry.content || "…"}</div>
    {/if}
  </div>
{/if}
