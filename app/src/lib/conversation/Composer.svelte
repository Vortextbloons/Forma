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

  let draft = $state("");
  let busy = $state(false);
  let menuOpen = $state(false);
  let menuWrap: HTMLDivElement | undefined = $state();
  let textarea: HTMLTextAreaElement | undefined = $state();

  const sessionId = $derived(sessionStore.activeSessionId);
  const canSend = $derived(sessionId !== null && draft.trim() !== "" && !busy);
  const modelLabel = $derived(modelStore.selectedInfo()?.name ?? "Auto model");

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
    if (!text || !sid || busy) return;
    messageStore.addUserMessage(sid, text);
    draft = "";
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
  <textarea
    class="input textarea composer-textarea"
    placeholder={sessionId ? "Describe a task…" : "Create or select a session first"}
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
        title="Model and reasoning"
        onclick={() => (menuOpen = !menuOpen)}
      >
        <Icon name="zap" size={13} />
        <span>{modelLabel}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {#if menuOpen}
        <div class="composer-menu" role="menu" aria-label="Model settings">
          <ModelPicker />
          <ThinkingPicker />
        </div>
      {/if}
    </div>
    <span class="composer-spacer"></span>
    <ContextIndicator />
    <button class="btn btn-accent" type="button" onclick={() => void submit()} disabled={!canSend} aria-label="Send">
      <Icon name="send" size={14} />
      Send
    </button>
  </div>
</div>
