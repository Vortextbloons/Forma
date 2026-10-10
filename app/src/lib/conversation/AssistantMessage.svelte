<script lang="ts">
  import Thinking from "./Thinking.svelte";
  import CodeBlock from "../components/CodeBlock.svelte";
  import { modelStore } from "../rig/stores/modelStore.svelte";
  import type { MessageEntry } from "../rig/stores/messageStore.svelte";

  interface Segment {
    type: "text" | "code";
    text: string;
    language?: string;
  }

  let { entry }: { entry: MessageEntry } = $props();

  const streaming = $derived(entry.status === "streaming");
  const segments = $derived(parseSegments(entry.content));
  const modelLabel = $derived.by(() => {
    const ref = entry.model;
    if (!ref) return undefined;
    const info = modelStore.infoFor(ref);
    const id = info?.id ?? (ref.includes("/") ? ref.slice(ref.indexOf("/") + 1) : ref);
    const name = info?.name;
    if (name && name !== ref && !name.includes("/")) return name;
    return id;
  });

  function parseSegments(content: string): Segment[] {
    const segments: Segment[] = [];
    let text: string[] = [];
    let code: string[] | null = null;
    let language: string | undefined;

    function flushText(): void {
      if (text.length > 0) segments.push({ type: "text", text: text.join("\n") });
      text = [];
    }

    for (const line of content.split("\n")) {
      const fence = /^\s*```(\S*)\s*$/.exec(line);
      if (code === null) {
        if (fence) {
          flushText();
          code = [];
          language = fence[1] || undefined;
        } else {
          text.push(line);
        }
      } else if (fence) {
        segments.push({ type: "code", text: code.join("\n"), language });
        code = null;
        language = undefined;
      } else {
        code.push(line);
      }
    }

    if (code !== null) segments.push({ type: "code", text: code.join("\n"), language });
    else flushText();
    return segments;
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
      {#each segments as segment}
        {#if segment.type === "code"}
          <CodeBlock code={segment.text} language={segment.language} />
        {:else}
          <span>{segment.text}</span>
        {/if}
      {/each}
      {#if streaming}<span class="muted">▍</span>{/if}
    {:else if streaming}
      <span class="muted">…</span>
    {:else}
      <span class="muted">(no text)</span>
    {/if}
  </div>
</div>
