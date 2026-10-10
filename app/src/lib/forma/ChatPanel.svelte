<script lang="ts">
  import Messages from "../conversation/Messages.svelte";
  import Composer from "../conversation/Composer.svelte";
  import Icon from "../components/Icon.svelte";
  import { messageStore } from "../rig/stores/messageStore.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { projectStore } from "./projectStore.svelte";
  import type { ChatTarget } from "./projectStore.svelte";

  const sessionId = $derived(sessionStore.activeSessionId);
  const project = $derived(projectStore.current?.project);
  const pages = $derived(project?.pages ?? []);
  const selectedId = $derived(projectStore.selectedPageId);
  const isPoster = $derived(project?.settings.output === "poster");

  let scope = $state<"page" | "project">("project");
  const mode = $derived(project?.mode === "create" ? "build" : "plan");
  const empty = $derived(messageStore.bySession(sessionId ?? "").length === 0);
  let historyOpen = $state(false);
  let switching = $state(false);
  const running = $derived(projectStore.run !== null || ["running", "waiting", "approval"].includes(sessionStore.statusOf(sessionId)));
  const chatIds = $derived([...(project?.conversation.sessionIds ?? [])].reverse());

  function chatTitle(id: string): string {
    const first = messageStore.bySession(id).find((message) => message.role === "user");
    return first?.content ?? `Chat ${chatIds.length - chatIds.indexOf(id)}`;
  }

  async function changeChat(id?: string): Promise<void> {
    switching = true;
    try {
      if (id) await projectStore.selectChat(id);
      else await projectStore.newChat();
      historyOpen = false;
    } finally {
      switching = false;
    }
  }

  const target = $derived<ChatTarget>(
    scope === "page" && selectedId && !isPoster
      ? { scope: "page", pageId: selectedId }
      : { scope: "project" },
  );

  const targetLabel = $derived.by(() => {
    if (isPoster) return "Poster";
    if (pages.length === 0) return "Project brief";
    if (scope === "page" && selectedId) {
      const index = pages.indexOf(selectedId);
      return index >= 0 ? `Slide ${index + 1}` : "Entire presentation";
    }
    return "Entire presentation";
  });
</script>

<div class="chat-panel">
  <div class="chat-header">
    <strong>Chat</strong>
    <span class="spacer"></span>
    <button class="btn btn-ghost" type="button" aria-expanded={historyOpen} aria-controls="chat-history" onclick={() => (historyOpen = !historyOpen)}>
      Previous chats
      <Icon name="chevron-down" size={12} />
    </button>
    <button class="icon-btn" type="button" title="New chat" aria-label="New chat" disabled={running || switching} onclick={() => void changeChat()}>
      <Icon name="plus" size={16} />
    </button>
  </div>
  {#if historyOpen}
    <div class="chat-history" id="chat-history" aria-label="Previous chats">
      {#each chatIds as id (id)}
        <button type="button" class:active={id === sessionId} aria-current={id === sessionId ? "true" : undefined} disabled={running || switching} onclick={() => void changeChat(id)}>
          <span>{chatTitle(id)}</span>
          {#if id === sessionId}<span class="small muted">Current</span>{/if}
        </button>
      {/each}
      {#if chatIds.length === 0}<p class="small muted">Your conversations will appear here.</p>{/if}
    </div>
  {/if}
  <div class="chat-target">
    <span>{pages.length > 0 ? "Working on" : "Project"}</span>
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
  <p class="work-mode-hint">{mode === "plan" ? "Plan ideas and outlines. Artwork stays unchanged." : "Ask Forma to create or change the artwork."}</p>
  {#if project && pages.length === 0}
    <div class="project-actions-bar">
      <button class="btn" type="button" disabled={running} onclick={() => void projectStore.plan()}><Icon name="message" size={14} /> {project.outline?.length ? "Revise plan" : "Plan project"}</button>
      <button class="btn btn-accent" type="button" disabled={running} onclick={() => void projectStore.generate()}><Icon name="zap" size={14} /> Build project</button>
    </div>
  {/if}
  {#if empty && project}
    <div class="chat-welcome">
      <span class="creation-kicker">{isPoster ? "POSTER STUDIO" : "PRESENTATION STUDIO"}</span>
      <h1>{project.name}</h1>
      <p>{project.prompt}</p>
      <span class="muted small">Your brief is ready. Talk through an idea, plan the project, or start building.</span>
    </div>
  {/if}
  {#if sessionId}
    <Messages {sessionId} />
  {:else}
    <div class="chat-preparing">
      <span class="spinner"></span> Preparing conversation…
    </div>
  {/if}
  {#key sessionId}
    <Composer {target} {mode} />
  {/key}
</div>
