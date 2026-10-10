<script lang="ts">
  import Thinking from "./Thinking.svelte";
  import { modelStore } from "../rig/stores/modelStore.svelte";
  import type { MessageEntry } from "../rig/stores/messageStore.svelte";

  let { entry }: { entry: MessageEntry } = $props();

  const streaming = $derived(entry.status === "streaming");
  const modelLabel = $derived(
    entry.model ? (modelStore.infoFor(entry.model)?.name ?? entry.model) : undefined,
  );
</script>

<div class="msg msg-assistant">
  <div class="msg-meta">
    <span class="msg-meta-role">Assistant</span>
    {#if modelLabel}
      <span class="msg-meta-model">{modelLabel}</span>
    {/if}
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
