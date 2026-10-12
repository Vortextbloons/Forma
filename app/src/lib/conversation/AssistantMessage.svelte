<script lang="ts">
  import Thinking from "./Thinking.svelte";
  import { renderMarkdown } from "../rig/markdown";
  import { openUrl } from "../rig/native";
  import { modelStore } from "../rig/stores/modelStore.svelte";
  import type { MessageEntry } from "../rig/stores/messageStore.svelte";

  let { entry }: { entry: MessageEntry } = $props();

  const streaming = $derived(entry.status === "streaming");
  const html = $derived(renderMarkdown(entry.content));
  const modelLabel = $derived.by(() => {
    const ref = entry.model;
    if (!ref) return undefined;
    const info = modelStore.infoFor(ref);
    const id = info?.id ?? (ref.includes("/") ? ref.slice(ref.indexOf("/") + 1) : ref);
    const name = info?.name;
    if (name && name !== ref && !name.includes("/")) return name;
    return id;
  });

  function externalLinks(node: HTMLElement): { destroy(): void } {
    function onClick(event: MouseEvent): void {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      event.preventDefault();
      void openUrl(href);
    }
    node.addEventListener("click", onClick);
    return { destroy: () => node.removeEventListener("click", onClick) };
  }
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
      <div class="md" use:externalLinks>{@html html}</div>
      {#if streaming}<span class="muted">▍</span>{/if}
    {:else if streaming}
      <span class="typing" role="status" aria-label="Responding">
        <span></span>
        <span></span>
        <span></span>
      </span>
    {:else}
      <span class="muted">(no text)</span>
    {/if}
  </div>
</div>

<style>
  .typing {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 1.1em;
  }

  .typing span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: typing-dot 1.2s ease-in-out infinite;
  }

  .typing span:nth-child(2) {
    animation-delay: 0.15s;
  }

  .typing span:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes typing-dot {
    0%,
    70%,
    100% {
      opacity: 0.25;
      transform: scale(0.8);
    }
    35% {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
