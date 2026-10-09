<script lang="ts">
  import UserMessage from "./UserMessage.svelte";
  import AssistantMessage from "./AssistantMessage.svelte";
  import InteractionCard from "./InteractionCard.svelte";
  import ToolCall from "../tools/ToolCall.svelte";
  import ApprovalRequest from "../permissions/ApprovalRequest.svelte";
  import { messageStore } from "../rig/stores/messageStore.svelte";
  import { toolStore } from "../rig/stores/toolStore.svelte";
  import { permissionStore } from "../rig/stores/permissionStore.svelte";
  import type { MessageEntry } from "../rig/stores/messageStore.svelte";
  import type { ToolCallEntry } from "../rig/stores/toolStore.svelte";
  import type { InteractionState } from "../rig/stores/messageStore.svelte";
  import type { ApprovalRequestEntry } from "../rig/stores/permissionStore.svelte";

  let { sessionId }: { sessionId: string } = $props();

  type TimelineItem =
    | { kind: "message"; entry: MessageEntry; seq: number }
    | { kind: "tool"; entry: ToolCallEntry; seq: number }
    | { kind: "interaction"; state: InteractionState; seq: number }
    | { kind: "approval"; request: ApprovalRequestEntry; seq: number };

  const timeline = $derived(buildTimeline(sessionId));

  function buildTimeline(sessionId: string): TimelineItem[] {
    const items: TimelineItem[] = [
      ...messageStore.bySession(sessionId).map((entry) => ({
        kind: "message" as const,
        entry,
        seq: entry.seq,
      })),
      ...toolStore.bySession(sessionId).map((entry) => ({
        kind: "tool" as const,
        entry,
        seq: entry.seq,
      })),
      ...messageStore.allInteractions(sessionId).map((state) => ({
        kind: "interaction" as const,
        state,
        seq: state.seq,
      })),
      ...permissionStore.bySession(sessionId).map((request, i) => ({
        kind: "approval" as const,
        request,
        seq: 1_000_000_000 + i,
      })),
    ];
    return items.sort((a, b) => a.seq - b.seq);
  }

  let container: HTMLDivElement | undefined = $state();

  $effect(() => {
    const len = timeline.length;
    const el = container;
    if (el) el.scrollTop = el.scrollHeight;
    void len;
  });

  function itemSeqKey(item: TimelineItem): string {
    if (item.kind === "message") return `m:${item.entry.id}`;
    if (item.kind === "tool") return `t:${item.entry.toolCallId}`;
    if (item.kind === "interaction") return `i:${item.state.interaction.id}`;
    return `a:${item.request.requestId}`;
  }
</script>

<div class="scroll messages-scroll" bind:this={container}>
  <div class="messages-timeline">
    {#if timeline.length === 0}
      <div class="messages-empty">
        <div class="messages-empty-inner">
          <div class="messages-empty-mark">›_</div>
          <div class="messages-empty-title">Chat about this project</div>
          <div class="messages-empty-copy">Ask a question or describe a change you want to make.</div>
        </div>
      </div>
    {/if}
    {#each timeline as item (itemSeqKey(item))}
      {#if item.kind === "message"}
        {#if item.entry.role === "user"}
          <UserMessage entry={item.entry} />
        {:else}
          <AssistantMessage entry={item.entry} />
        {/if}
      {:else if item.kind === "tool"}
        <ToolCall sessionId={sessionId} tool={item.entry} />
      {:else if item.kind === "interaction"}
        <InteractionCard sessionId={sessionId} state={item.state} />
      {:else}
        <ApprovalRequest sessionId={sessionId} request={item.request} />
      {/if}
    {/each}
  </div>
</div>
