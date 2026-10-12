<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import DesignMashup from "../forma/DesignMashup.svelte";
  import DesignPreview from "../forma/DesignPreview.svelte";
  import { sendCommand } from "../rig/bridge";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";
  import type { QuestionInteraction } from "../rig/types";
  import type { DesignProposal } from "../../../../src/tools/design.ts";
  import { designProfileSchema } from "../../../../src/projects/design.ts";

  let { sessionId, interaction }: { sessionId: string; interaction: QuestionInteraction } = $props();

  let open = $state(false);
  let customText = $state("");
  let sending = $state(false);

  const proposal = $derived.by(() => {
    const candidate = (interaction as { designProposal?: DesignProposal }).designProposal;
    if (!candidate) return undefined;
    const parsed = designProfileSchema.safeParse(candidate.profile);
    return parsed.success ? { ...candidate, profile: parsed.data } : undefined;
  });
  const options = $derived(interaction.options ?? []);
  const approveValue = $derived(options.find((option) => option.value === "approve" || option.label === "Approve design")?.value ?? "approve");
  const rejectValue = $derived(options.find((option) => option.value === "reject" || option.label === "Keep current design")?.value ?? "reject");
  const allowCustom = $derived(interaction.allowCustom === true);
  const resolvable = $derived(interaction.id !== "" && !sending);

  async function resolve(result: string): Promise<void> {
    if (!resolvable) return;
    try {
      await sendCommand("resolveInteraction", {
        sessionId,
        interactionId: interaction.id,
        kind: "question",
        result,
      });
      open = false;
      customText = "";
    } catch {
      notificationStore.push({ type: "error", sessionId, message: "Failed to send your answer" });
    }
  }

  function submitCustom(): void {
    const text = customText.trim();
    if (text) void resolve(text);
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (open && event.key === "Escape") open = false;
  }
</script>

{#if proposal}
  <button class="proposal-card" type="button" onclick={() => (open = true)}>
    <DesignMashup profile={proposal.profile} height={22} width={44} />
    <span class="proposal-card-text">
      <strong>{proposal.name}</strong>
      <span class="muted small">Design proposal — click to review</span>
    </span>
    <Icon name="chevron-right" size={14} />
  </button>
{/if}

{#if open && proposal}
  <div
    class="modal-overlay"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) open = false;
    }}
  >
    <div class="modal proposal-modal" role="dialog" aria-modal="true" aria-label="Design proposal" tabindex="-1">
      <div class="modal-head">
        <span class="modal-title">Design proposal</span>
        <button class="icon-btn" type="button" title="Close" aria-label="Close proposal" onclick={() => (open = false)}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div class="modal-body proposal-body">
        <DesignPreview profile={proposal.profile} name={proposal.name} rationale={proposal.rationale} />
        <div class="proposal-actions">
          <button class="btn btn-accent" type="button" disabled={!resolvable} onclick={() => void resolve(approveValue)}>Approve design</button>
          <button class="btn" type="button" disabled={!resolvable} onclick={() => void resolve(rejectValue)}>Keep current design</button>
        </div>
        {#if allowCustom}
          <div class="proposal-feedback">
            <input
              class="input"
              placeholder={interaction.placeholder ?? "Describe what you want changed…"}
              bind:value={customText}
              onkeydown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitCustom();
                }
              }}
            />
            <button class="btn" type="button" disabled={!resolvable || customText.trim() === ""} onclick={submitCustom}>Send</button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<svelte:window onkeydown={onWindowKeydown} />

<style>
  .proposal-card {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .proposal-card:hover {
    border-color: var(--border-strong);
    background: var(--surface-3);
  }
  .proposal-card-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .proposal-card-text strong {
    font-size: 13.5px;
  }
  .proposal-card :global(svg) {
    flex-shrink: 0;
    color: var(--faint);
  }
  .proposal-card:hover :global(svg) {
    color: var(--accent);
  }
  .proposal-modal {
    width: min(560px, calc(100vw - 48px));
  }
  .proposal-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .proposal-actions {
    display: flex;
    gap: 8px;
  }
  .proposal-feedback {
    display: flex;
    gap: 8px;
  }
  .proposal-feedback .input {
    flex: 1;
    min-width: 0;
  }
</style>