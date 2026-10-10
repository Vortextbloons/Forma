<script lang="ts">
  import Messages from "../conversation/Messages.svelte";
  import Composer from "../conversation/Composer.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { projectStore } from "./projectStore.svelte";
  import type { ChatTarget } from "./projectStore.svelte";

  const sessionId = $derived(sessionStore.activeSessionId);
  const project = $derived(projectStore.current?.project);
  const pages = $derived(project?.pages ?? []);
  const selectedId = $derived(projectStore.selectedPageId);
  const isPoster = $derived(project?.settings.output === "poster");

  let scope = $state<"page" | "project">("project");

  const target = $derived<ChatTarget>(
    scope === "page" && selectedId && !isPoster
      ? { scope: "page", pageId: selectedId }
      : { scope: "project" },
  );

  const targetLabel = $derived.by(() => {
    if (isPoster) return "Poster";
    if (pages.length === 0) return "Planning";
    if (scope === "page" && selectedId) {
      const index = pages.indexOf(selectedId);
      return index >= 0 ? `Slide ${index + 1}` : "Entire presentation";
    }
    return "Entire presentation";
  });
</script>

<div class="chat-panel">
  <div class="chat-target">
    <span>Refining</span>
    {#if pages.length > 0 && !isPoster}
      <div class="segmented segmented-small" role="group" aria-label="Refinement target">
        <button
          type="button"
          class:active={scope === "page"}
          aria-pressed={scope === "page"}
          disabled={!selectedId}
          onclick={() => (scope = "page")}
        >Selected slide</button>
        <button
          type="button"
          class:active={scope === "project"}
          aria-pressed={scope === "project"}
          onclick={() => (scope = "project")}
        >Entire presentation</button>
      </div>
    {:else}
      <strong>{targetLabel}</strong>
    {/if}
  </div>
  {#if sessionId}
    <Messages {sessionId} />
  {:else}
    <div class="chat-preparing">
      <span class="spinner"></span> Preparing conversation…
    </div>
  {/if}
  <Composer {target} />
</div>
