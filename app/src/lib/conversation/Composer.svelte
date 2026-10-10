<script lang="ts">
  import ModelPicker from "../models/ModelPicker.svelte";
  import ThinkingPicker from "../models/ThinkingPicker.svelte";
  import Icon from "../components/Icon.svelte";
  import ContextIndicator from "./ContextIndicator.svelte";
  import { sendCommand } from "../rig/bridge";
  import { messageStore } from "../rig/stores/messageStore.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";
  import { modelStore } from "../rig/stores/modelStore.svelte";
  import { providerStore } from "../rig/stores/providerStore.svelte";
  import { projectStore } from "../forma/projectStore.svelte";
  import type { ChatTarget } from "../forma/projectStore.svelte";

  let { target = { scope: "project" } as ChatTarget }: { target?: ChatTarget } = $props();

  let draft = $state("");
  let busy = $state(false);
  let menuOpen = $state(false);
  let menuWrap: HTMLDivElement | undefined = $state();
  let textarea: HTMLTextAreaElement | undefined = $state();

  const sessionId = $derived(sessionStore.activeSessionId);
  const mode = $derived(projectStore.current?.project.mode === "plan" ? "plan" : "build");
  const running = $derived(busy || projectStore.run !== null || ["running", "waiting", "approval"].includes(sessionStore.statusOf(sessionId)));
  const canSend = $derived(sessionId !== null && draft.trim() !== "" && !running);
  const modelLabel = $derived(
    modelStore.selectedModel === "auto"
      ? "Auto model"
      : (modelStore.selectedInfo()?.name ?? modelStore.selectedModel),
  );
  const providerLabel = $derived.by(() => {
    if (modelStore.selectedModel === "auto") return "Auto";
    const provider = modelStore.selectedInfo()?.provider;
    if (!provider) return "Provider";
    return providerStore.providers.find((p) => p.id === provider)?.name ?? provider;
  });

  $effect(() => {
    const el = textarea;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  });

  $effect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent): void => {
      if (menuWrap && !menuWrap.contains(event.target as Node)) menuOpen = false;
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  });

  async function submit(): Promise<void> {
    const text = draft.trim();
    const sid = sessionId;
    if (!text || !sid || running) return;
    draft = "";
    if (projectStore.current) {
      busy = true;
      try {
        await projectStore.sendRefine(text, target, mode);
      } finally {
        busy = false;
      }
      return;
    }
    messageStore.addUserMessage(sid, text);
    busy = true;
    try {
      await sendCommand("prompt", { sessionId: sid, prompt: text }, { timeoutMs: 0 });
    } catch (err) {
      notificationStore.push({
        type: "error",
        sessionId: sid,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      busy = false;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }
</script>

<div class="composer">
  {#if projectStore.current}
    <div class="composer-mode-row">
      <div class="segmented segmented-small" role="group" aria-label="Work mode">
        <button type="button" class:active={mode === "plan"} aria-pressed={mode === "plan"} disabled={running} onclick={() => projectStore.updateBrief({ mode: "plan" })}>Plan</button>
        <button type="button" class:active={mode === "build"} aria-pressed={mode === "build"} disabled={running} onclick={() => projectStore.updateBrief({ mode: "create" })}>Build</button>
      </div>
      <button class="btn btn-ghost" type="button" onclick={() => window.dispatchEvent(new CustomEvent("forma:open-references"))}>
        <Icon name="plus" size={13} /> References
      </button>
      <span class="muted small">{mode === "plan" ? "Discuss ideas and make a plan. Artwork stays unchanged." : "Create and edit artwork. No plan needed."}</span>
    </div>
  {/if}
  <textarea
    class="input textarea composer-textarea"
    placeholder={sessionId
      ? projectStore.current
        ? mode === "plan" ? "Explore an idea or plan a change…" : "Describe what to build or change…"
        : "Describe a task…"
      : "Preparing conversation…"}
    rows="1"
    bind:this={textarea}
    bind:value={draft}
    onkeydown={onKeydown}
    disabled={sessionId === null}
    aria-label="Message the agent"
  ></textarea>
  <div class="composer-toolbar">
    <div class="composer-menu-wrap" bind:this={menuWrap}>
      <button
        class="composer-model"
        type="button"
        aria-expanded={menuOpen}
        aria-haspopup="true"
        onclick={() => (menuOpen = !menuOpen)}
      >
        <Icon name="zap" size={13} />
        <span class="composer-model-stack">
          <span class="composer-model-provider">{providerLabel}</span>
          <span class="composer-model-name">{modelLabel}</span>
        </span>
        <Icon name="chevron-down" size={12} />
      </button>
      {#if menuOpen}
        <div class="composer-menu" role="menu" aria-label="Model settings">
          <ModelPicker onselect={() => (menuOpen = false)} />
        </div>
      {/if}
    </div>
    <ThinkingPicker />
    <span class="composer-spacer"></span>
    <ContextIndicator />
    {#if running}
      <button class="btn" type="button" onclick={() => void projectStore.stopGeneration()} aria-label="Stop response">
        <Icon name="x" size={14} /> Stop
      </button>
    {:else}
      <button class="btn btn-accent" type="button" onclick={() => void submit()} disabled={!canSend} aria-label="Send">
        <Icon name="send" size={14} />
        Send
      </button>
    {/if}
  </div>
</div>
