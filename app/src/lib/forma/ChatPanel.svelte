<script lang="ts">
  import Messages from "../conversation/Messages.svelte";
  import Composer from "../conversation/Composer.svelte";
  import Icon from "../components/Icon.svelte";
  import PagePreview from "./PagePreview.svelte";
  import { messageStore } from "../rig/stores/messageStore.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { projectStore } from "./projectStore.svelte";
  import type { ChatTarget } from "./projectStore.svelte";

  const sessionId = $derived(sessionStore.activeSessionId);
  const project = $derived(projectStore.current?.project);
  const pages = $derived(project?.pages ?? []);
  const selectedId = $derived(projectStore.selectedPageId);
  const selectedElement = $derived(projectStore.selectedElement);
  const isPoster = $derived(project?.settings.output === "poster");
  const showRail = $derived(pages.length > 0);

  const scope = $derived(projectStore.refineScope);
  const empty = $derived(messageStore.bySession(sessionId ?? "").length === 0);
  let historyOpen = $state(false);
  let historyEl = $state<HTMLElement | null>(null);
  let previewPageId = $state<string | null>(null);
  let switching = $state(false);

  function onWindowPointerDown(event: PointerEvent): void {
    if (!historyOpen) return;
    if (historyEl && event.target instanceof Node && historyEl.contains(event.target)) return;
    historyOpen = false;
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      historyOpen = false;
      previewPageId = null;
    }
  }

  function titleOf(pageId: string): string {
    const index = pages.indexOf(pageId);
    return project?.pageMeta[pageId]?.title || (isPoster ? "Poster" : `Slide ${index + 1}`);
  }

  const artworkRunning = $derived(projectStore.run !== null);
  const running = $derived(artworkRunning || ["running", "waiting", "approval"].includes(sessionStore.statusOf(sessionId)));
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
    selectedElement
      ? { scope: "page", pageId: selectedElement.pageId, element: selectedElement }
      : scope === "page" && selectedId && !isPoster
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

<div class="chat-panel" class:has-rail={showRail}>
  <div class="chat-body">
  <div class="chat-header" bind:this={historyEl}>
    <strong>Chat</strong>
    <span class="spacer"></span>
    <button class="btn btn-ghost" type="button" aria-expanded={historyOpen} aria-controls="chat-history" onclick={() => (historyOpen = !historyOpen)}>
      Previous chats
      <Icon name="chevron-down" size={12} />
    </button>
    <button class="icon-btn" type="button" title="New chat" aria-label="New chat" disabled={artworkRunning || switching} onclick={() => void changeChat()}>
      <Icon name="plus" size={16} />
    </button>
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
  </div>
  <div class="chat-target">
    <span>{pages.length > 0 ? "Working on" : "Project"}</span>
    {#if selectedElement}
      <strong class="selected-element" title={selectedElement.selector}>Selected element: {selectedElement.text || "Shape"}</strong>
      <button class="icon-btn" type="button" aria-label="Clear selected element" title="Clear selected element" onclick={() => projectStore.selectElement(null)}><Icon name="x" size={14} /></button>
    {:else if pages.length > 0 && !isPoster}
      <div class="segmented segmented-small" role="group" aria-label="Refinement target">
        <button
          type="button"
          class:active={scope === "page"}
          aria-pressed={scope === "page"}
          disabled={!selectedId}
          onclick={() => projectStore.setRefineScope("page")}
        >Selected slide</button>
        <button
          type="button"
          class:active={scope === "project"}
          aria-pressed={scope === "project"}
          onclick={() => projectStore.setRefineScope("project")}
        >Entire presentation</button>
      </div>
    {:else}
      <strong>{targetLabel}</strong>
    {/if}

  </div>
  {#if selectedElement}
    <p class="element-feedback-hint muted small">Describe the change below. AI will apply your feedback to this element.</p>
  {:else if pages.length > 0}
    <p class="element-feedback-hint muted small">Click an element in the preview to give AI feedback.</p>
  {/if}
  {#if empty && project}
    <div class="chat-welcome">
      <span class="creation-kicker">{isPoster ? "POSTER STUDIO" : "PRESENTATION STUDIO"}</span>
      <h1>{project.name}</h1>
      <p>{project.prompt}</p>
      <span class="muted small">Ask Forma to build from your brief, or choose Plan in the composer to work through ideas first.</span>
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
    <Composer {target} />
  {/key}
  </div>
  {#if showRail}
    <aside class="chat-slide-rail" aria-label={isPoster ? "Poster" : "Slides"}>
      {#each pages as pageId, i (pageId)}
        <button
          class="chat-slide-thumb"
          class:active={selectedId === pageId}
          type="button"
          aria-label={isPoster ? `Open preview for the poster: ${titleOf(pageId)}` : `Open preview for slide ${i + 1}: ${titleOf(pageId)}`}
          onclick={() => (previewPageId = pageId)}
        >
          <PagePreview {pageId} mode="thumb" />
          {#if !isPoster}<span class="chat-slide-num">{i + 1}</span>{/if}
        </button>
      {/each}
    </aside>
  {/if}
  {#if previewPageId}
    <div
      class="chat-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${isPoster ? "Poster" : "Slide"} preview: ${titleOf(previewPageId)}`}
      tabindex="-1"
      onclick={(event) => {
        if (event.target === event.currentTarget) previewPageId = null;
      }}
      onkeydown={(event) => {
        if (event.key === "Escape") previewPageId = null;
      }}
    >
      <button class="icon-btn chat-lightbox-close" type="button" aria-label="Close preview" onclick={() => (previewPageId = null)}>
        <Icon name="x" size={16} />
      </button>
      <div class="chat-lightbox-stage">
        <PagePreview pageId={previewPageId} onsubmit={() => (previewPageId = null)} />
      </div>
      <p class="chat-lightbox-caption">{titleOf(previewPageId)}</p>
    </div>
  {/if}
</div>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<style>
  .selected-element {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .element-feedback-hint {
    margin: 0;
    padding: 8px 14px;
    flex-shrink: 0;
  }
</style>
