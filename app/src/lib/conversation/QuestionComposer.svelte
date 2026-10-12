<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import DesignProposalCard from "./DesignProposalCard.svelte";
  import { projectStore } from "../forma/projectStore.svelte";
  import { sendCommand } from "../rig/bridge";
  import { openUrl } from "../rig/native";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";
  import type { InteractionState } from "../rig/stores/messageStore.svelte";
  import type { QuestionInteraction, QuestionOption } from "../rig/types";
  import type { DesignProposal } from "../../../../src/tools/design.ts";
  import { designProfileSchema } from "../../../../src/projects/design.ts";

  let { sessionId, pending }: { sessionId: string; pending: InteractionState } = $props();

  const interaction = $derived(pending.interaction as QuestionInteraction);
  const options = $derived(interaction.options ?? []);
  const multiple = $derived(interaction.multiple === true);
  const allowCustom = $derived(interaction.allowCustom === true || options.length === 0);
  const secret = $derived((interaction as { secret?: boolean }).secret === true);
  const authUrl = $derived((interaction as { authUrl?: string }).authUrl);
  const authInfo = $derived((interaction as { authInfo?: string }).authInfo);
  const proposal = $derived.by(() => {
    const candidate = (interaction as { designProposal?: DesignProposal }).designProposal;
    if (!candidate) return undefined;
    const parsed = designProfileSchema.safeParse(candidate.profile);
    return parsed.success ? { ...candidate, profile: parsed.data } : undefined;
  });
  const hint = $derived(proposal ? "" : multiple ? "select all that apply" : options.length > 0 ? "choose one" : "");

  let selected = $state<string[]>([]);
  let customText = $state("");
  let rootEl = $state<HTMLDivElement | undefined>();
  let inputEl = $state<HTMLInputElement | undefined>();

  $effect(() => {
    (inputEl ?? rootEl?.querySelector<HTMLButtonElement>(".qcomposer-option"))?.focus();
  });

  function resolve(result: string | string[]): void {
    if (pending.status !== "pending") return;
    void sendCommand("resolveInteraction", {
      sessionId,
      interactionId: interaction.id,
      kind: "question",
      result,
    }).catch(() => {
      notificationStore.push({ type: "error", sessionId, message: "Failed to send your answer" });
    });
  }

  function choose(option: QuestionOption): void {
    if (multiple) {
      selected = selected.includes(option.value)
        ? selected.filter((value) => value !== option.value)
        : [...selected, option.value];
    } else {
      resolve(option.value);
    }
  }

  function submitCustom(): void {
    const text = customText.trim();
    if (!text) return;
    resolve(multiple ? [...selected, text] : text);
  }

  function confirmMulti(): void {
    if (selected.length > 0) resolve([...selected]);
  }
</script>

<div class="qcomposer" bind:this={rootEl} role="group" aria-label="Forma needs your input">
  <div class="qcomposer-head">
    <span class="qcomposer-eyebrow"><span class="qcomposer-pulse"></span>Forma asks</span>
    <span class="qcomposer-head-end">
      {#if hint}<span class="qcomposer-hint">{hint}</span>{/if}
      {#if sessionId}
        <button
          class="qcomposer-stop"
          type="button"
          title="Stop the run"
          aria-label="Stop the run"
          onclick={() => void projectStore.stopGeneration()}
        >
          <Icon name="stop" size={10} /> Stop
        </button>
      {/if}
    </span>
  </div>
  <p class="qcomposer-question">{interaction.question}</p>
  {#if proposal}
    <DesignProposalCard {sessionId} {interaction} />
  {/if}
  {#if authUrl || authInfo}
    <div class="qcomposer-auth">
      {#if authInfo}<span class="qcomposer-auth-info">{authInfo}</span>{/if}
      {#if authUrl}
        <div class="qcomposer-auth-actions">
          <button class="btn btn-sm" type="button" onclick={() => void openUrl(authUrl)}>Open sign-in page</button>
          <button class="btn btn-sm btn-ghost" type="button" onclick={() => resolve("")}>Cancel sign-in</button>
        </div>
      {/if}
    </div>
  {/if}
  {#if !proposal && options.length > 0}
    <div class="qcomposer-options">
      {#each options as option, index (option.value)}
        <button
          class="qcomposer-option"
          class:qcomposer-option-selected={selected.includes(option.value)}
          type="button"
          aria-pressed={multiple ? selected.includes(option.value) : undefined}
          onclick={() => choose(option)}
        >
          <span class="qcomposer-marker">
            {#if multiple && selected.includes(option.value)}
              <Icon name="check" size={12} />
            {:else if !multiple}
              {index + 1}
            {/if}
          </span>
          <span class="qcomposer-option-text">
            <span class="qcomposer-option-label">{option.label}</span>
            {#if option.description}<span class="qcomposer-option-desc">{option.description}</span>{/if}
          </span>
          {#if !multiple}
            <span class="qcomposer-option-go"><Icon name="chevron-right" size={14} /></span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
  {#if !proposal && allowCustom}
    <div class="qcomposer-custom">
      <input
        bind:this={inputEl}
        class="qcomposer-input"
        type={secret ? "password" : "text"}
        autocomplete="off"
        placeholder={interaction.placeholder ?? (options.length > 0 ? "Or type your own answer…" : "Type your answer…")}
        bind:value={customText}
        aria-label="Custom answer"
        onkeydown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submitCustom();
          }
        }}
      />
      <button
        class="qcomposer-send"
        type="button"
        aria-label="Send answer"
        disabled={customText.trim() === ""}
        onclick={submitCustom}
      >
        <Icon name="send" size={14} />
      </button>
    </div>
  {/if}
  {#if !proposal && multiple && options.length > 0}
    <div class="qcomposer-footer">
      <button class="btn btn-accent" type="button" disabled={selected.length === 0} onclick={confirmMulti}>
        Confirm{selected.length > 0 ? ` · ${selected.length}` : ""}
      </button>
    </div>
  {/if}
</div>

<style>
  .qcomposer {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 13px 15px 14px;
    border: 1px solid var(--border-strong);
    border-radius: 13px;
    background: color-mix(in srgb, var(--surface) 96%, transparent);
    animation: qcomposer-in 0.22s var(--ease-out, ease-out) both;
  }

  @keyframes qcomposer-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  .qcomposer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .qcomposer-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--accent);
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  .qcomposer-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    animation: qcomposer-pulse 1.6s ease-in-out infinite;
  }

  @keyframes qcomposer-pulse {
    50% {
      opacity: 0.3;
    }
  }

  .qcomposer-head-end {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  .qcomposer-hint {
    color: var(--faint);
    font: 600 10px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .qcomposer-stop {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--faint);
    font: 600 10px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .qcomposer-stop:hover {
    background: var(--surface-2);
    color: var(--danger);
  }

  .qcomposer-question {
    margin: 0;
    font: 600 16px/1.45 var(--font-display);
    letter-spacing: -0.01em;
  }

  .qcomposer-options {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .qcomposer-option {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-2);
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s,
      transform 0.15s;
  }

  .qcomposer-option:hover {
    border-color: var(--border-strong);
    background: var(--surface-3);
    transform: translateY(-1px);
  }

  .qcomposer-option-selected,
  .qcomposer-option-selected:hover {
    border-color: color-mix(in srgb, var(--accent) 65%, transparent);
    background: color-mix(in srgb, var(--accent) 10%, var(--surface-2));
  }

  .qcomposer-marker {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    color: var(--muted);
    font: 600 10.5px/1 var(--font-mono);
  }

  .qcomposer-option-selected .qcomposer-marker {
    border-color: transparent;
    background: var(--accent);
    color: var(--accent-contrast);
  }

  .qcomposer-option-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .qcomposer-option-label {
    font-size: 13.5px;
    font-weight: 600;
  }

  .qcomposer-option-desc {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .qcomposer-option-go {
    display: inline-flex;
    margin-left: auto;
    flex-shrink: 0;
    color: var(--faint);
  }

  .qcomposer-option:hover .qcomposer-option-go {
    color: var(--accent);
  }

  .qcomposer-custom {
    display: flex;
    gap: 8px;
  }

  .qcomposer-input {
    flex: 1;
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-2);
    color: var(--text);
    font-size: 13.5px;
  }

  .qcomposer-input::placeholder {
    color: var(--faint);
  }

  .qcomposer-input:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border-strong));
  }

  .qcomposer-send {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 38px;
    padding: 0;
    border: 0;
    border-radius: 9px;
    background: var(--accent);
    color: var(--accent-contrast);
    cursor: pointer;
    transition:
      transform 0.14s,
      opacity 0.14s;
  }

  .qcomposer-send:not(:disabled):hover {
    transform: translateY(-1px);
  }

  .qcomposer-send:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .qcomposer-footer {
    display: flex;
    justify-content: flex-end;
  }

  .qcomposer-auth {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .qcomposer-auth-info {
    color: var(--muted);
    font-size: 12.5px;
  }

  .qcomposer-auth-actions {
    display: flex;
    gap: 8px;
  }

  :global(.chat-full) .qcomposer {
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
  }
</style>
