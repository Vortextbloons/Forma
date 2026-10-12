<script lang="ts">
  import { sendCommand } from "../rig/bridge";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";
  import type { InteractionState } from "../rig/stores/messageStore.svelte";

  let { sessionId, state }: { sessionId: string; state: InteractionState } = $props();

  const interaction = $derived(state.interaction);

  function resolve(result: boolean): void {
    void sendCommand("resolveInteraction", {
      sessionId,
      interactionId: interaction.id,
      kind: interaction.kind,
      result,
    }).catch(() => {
      notificationStore.push({ type: "error", sessionId, message: "Failed to send your answer" });
    });
  }
</script>

{#if interaction.kind === "confirmation"}
  <div class="question-card">
    <div class="question-body">
      <div class="question-text" style="font-weight:600">{interaction.title}</div>
      {#if interaction.message}
        <div class="question-text muted">{interaction.message}</div>
      {/if}
      <div style="display:flex;gap:8px">
        <button class="btn btn-accent" type="button" onclick={() => resolve(true)}>confirm</button>
        <button class="btn" type="button" onclick={() => resolve(false)}>cancel</button>
      </div>
    </div>
  </div>
{/if}
