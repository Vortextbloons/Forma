<script lang="ts">
  import ModelPicker from "../models/ModelPicker.svelte";
  import ThinkingPicker from "../models/ThinkingPicker.svelte";
  import Icon from "../components/Icon.svelte";
  import ContextIndicator from "./ContextIndicator.svelte";
  import { sendCommand } from "../rig/bridge";
  import { messageStore } from "../rig/stores/messageStore.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";

  let draft = $state("");
  let busy = $state(false);
  let textarea: HTMLTextAreaElement | undefined = $state();

  const sessionId = $derived(sessionStore.activeSessionId);
  const canSend = $derived(sessionId !== null && draft.trim() !== "" && !busy);

  $effect(() => {
    const el = textarea;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
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
    <ModelPicker />
    <ThinkingPicker />
    <span class="composer-spacer"></span>
    <span class="composer-hint">Enter to send · Shift+Enter for newline</span>
    <ContextIndicator />
    <button class="btn btn-accent" type="button" onclick={() => void submit()} disabled={!canSend} aria-label="Send">
      <Icon name="send" size={14} />
      Send
    </button>
  </div>
</div>
