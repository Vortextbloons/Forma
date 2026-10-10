<script lang="ts">
  import type { MessageEntry } from "../rig/stores/messageStore.svelte";
  import Icon from "../components/Icon.svelte";

  let { entry }: { entry: MessageEntry } = $props();
</script>

<div class="msg msg-user">
  <div class="msg-bubble">
    {#if entry.element}
      <div class="element-edit-context">
        <span class="element-edit-label"><Icon name="message" size={13} /> Element edit</span>
        <span class="element-edit-text" title={entry.element.text}>{entry.element.text || "Selected shape"}</span>
      </div>
    {/if}
    {entry.content}
  </div>
</div>

<style>
  .element-edit-context {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 9px;
    padding-bottom: 9px;
    border-bottom: 1px solid var(--border-strong);
  }

  .element-edit-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
    font-size: 11px;
    font-weight: 650;
  }

  .element-edit-text {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 12px;
  }
</style>
