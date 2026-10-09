<script lang="ts">
  import Messages from "../conversation/Messages.svelte";
  import Composer from "../conversation/Composer.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { projectStore } from "./projectStore.svelte";

  const sessionId = $derived(sessionStore.activeSessionId);
  const target = $derived(
    projectStore.current?.project.settings.output === "poster" ? "Poster" : "Entire presentation",
  );
</script>

<div class="chat-panel">
  <div class="chat-target">Refining <strong>{target}</strong></div>
  {#if sessionId}
    <Messages {sessionId} />
  {:else}
    <div class="chat-preparing">
      <span class="spinner"></span> Preparing conversation…
    </div>
  {/if}
  <Composer />
</div>
