<script lang="ts">
  import Messages from "../conversation/Messages.svelte";
  import Composer from "../conversation/Composer.svelte";
  import QuestionComposer from "../conversation/QuestionComposer.svelte";
  import Icon from "../components/Icon.svelte";
  import PagePreview from "./PagePreview.svelte";
  import DesignMashup from "./DesignMashup.svelte";
  import { messageStore } from "../rig/stores/messageStore.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { projectStore } from "./projectStore.svelte";
  import type { ChatTarget } from "./projectStore.svelte";

  const sessionId = $derived(sessionStore.activeSessionId);
  const project = $derived(projectStore.current?.project);
  const pages = $derived(project?.pages ?? []);
  const selectedElement = $derived(projectStore.selectedElement);
  const isPoster = $derived(project?.settings.output === "poster");
  const showRail = $derived(pages.length > 0);
  const designApproved = $derived(project?.settings.designApproved ?? false);
  const designProfile = $derived(project?.settings.designProfile);
  const designLabel = $derived(designApproved ? (project?.settings.designName ?? "Custom") : "AI chooses");

  const targetPageId = $derived(projectStore.refineTargetPageId);
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
  const activeQuestion = $derived.by(() => {
    if (sessionId === null || sessionStore.statusOf(sessionId) !== "waiting") return undefined;
    const pending = messageStore.pendingInteractions(sessionId).find((state) => state.interaction.kind === "question");
    return pending ? { sessionId, state: pending } : undefined;
  });
  const chatIds = $derived([...(project?.conversation.sessionIds ?? [])].reverse());

  function chatTitle(id: string): string {
    const first = messageStore.bySession(id).find((message) => message.role === "user");
    if (first?.content) return first.content;
    if (first?.images?.length) return "Images";
    return `Chat ${chatIds.length - chatIds.indexOf(id)}`;
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

  let thumbTimer: number | undefined;

  function onThumbClick(pageId: string): void {
    if (isPoster) {
      previewPageId = pageId;
      return;
    }
    window.clearTimeout(thumbTimer);
    thumbTimer = window.setTimeout(() => {
      projectStore.toggleRefineTarget(pageId);
      projectStore.selectPage(pageId);
    }, 250);
  }

  function onThumbDblClick(pageId: string): void {
    window.clearTimeout(thumbTimer);
    previewPageId = pageId;
  }

  const target = $derived<ChatTarget>(
    selectedElement
      ? { scope: "page", pageId: selectedElement.pageId, element: selectedElement }
      : targetPageId && !isPoster
        ? { scope: "page", pageId: targetPageId }
        : { scope: "project" },
  );
</script>

<div class="chat-panel" class:has-rail={showRail}>
  <div class="chat-body">
  <div class="chat-header" bind:this={historyEl}>
    <strong>Chat</strong>
    {#if project}
      <button class="btn btn-sm btn-ghost chat-design" type="button" title="Change project design" onclick={() => window.dispatchEvent(new CustomEvent("forma:open-design"))}>
        {#if designApproved && designProfile}
          <DesignMashup profile={designProfile} height={16} width={34} />
        {:else}
          <span class="chat-design-empty" aria-hidden="true"></span>
        {/if}
        {designLabel}
      </button>
    {/if}
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
    {#if activeQuestion}
      <div class="chat-question-slot">
        <QuestionComposer sessionId={activeQuestion.sessionId} pending={activeQuestion.state} />
      </div>
    {:else}
      <Composer {target} />
    {/if}
  {/key}
  </div>
  {#if showRail}
    <aside class="chat-slide-rail" aria-label={isPoster ? "Poster" : "Slides"}>
      {#each pages as pageId, i (pageId)}
        <div class="chat-slide-item">
          <button
            class="chat-slide-thumb"
            class:active={targetPageId === pageId}
            type="button"
            aria-pressed={targetPageId === pageId || undefined}
            aria-label={isPoster ? `Open preview for the poster: ${titleOf(pageId)}` : `Select slide ${i + 1}: ${titleOf(pageId)}`}
            onclick={() => onThumbClick(pageId)}
            ondblclick={() => onThumbDblClick(pageId)}
          >
            <PagePreview {pageId} mode="thumb" />
            {#if !isPoster}<span class="chat-slide-num">{i + 1}</span>{/if}
          </button>
          {#if !isPoster}
            <button
              class="icon-btn chat-slide-delete"
              type="button"
              title="Delete"
              aria-label={`Delete slide ${i + 1}`}
              onclick={() => void projectStore.deletePage(pageId)}
            >
              <Icon name="trash" size={12} />
            </button>
          {/if}
        </div>
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
  .chat-design {
    gap: 8px;
    flex-shrink: 0;
  }
  .chat-design-empty {
    width: 22px;
    height: 12px;
    border: 1.5px dashed var(--border-strong);
    border-radius: 999px;
  }
  .element-feedback-hint {
    margin: 0;
    padding: 8px 14px;
    flex-shrink: 0;
  }
</style>
