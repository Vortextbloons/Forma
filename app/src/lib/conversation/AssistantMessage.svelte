<script lang="ts">
  import Thinking from "./Thinking.svelte";
  import type { MessageEntry } from "../rig/stores/messageStore.svelte";

  let { entry }: { entry: MessageEntry } = $props();

  const streaming = $derived(entry.status === "streaming");
</script>

<div class="msg msg-assistant">
  <div class="msg-meta">
    <span style="font-weight:600">Assistant</span>
    {#if entry.model}<span class="chip">{entry.model}</span>{/if}
    {#if streaming}
      <span class="spinner"></span>
    {/if}
  </div>
  {#if entry.thinking}
    <Thinking entry={entry.thinking} />
  {/if}
  <div class="msg-bubble">
    {#if entry.content !== ""}
      {entry.content}{#if streaming}<span class="muted">▍</span>{/if}
    {:else if streaming}
      <span class="muted">…</span>
    {:else}
      <span class="muted">(no text)</span>
    {/if}
  </div>
</div>
