<script lang="ts">
  import { tick } from "svelte";
  import Icon from "../components/Icon.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { effectiveSize } from "../../../../src/projects/size.ts";
  import { elementSelectionScript } from "../../../../src/rendering/selection.ts";

  let {
    pageId,
    mode = "main",
    onsubmit,
  }: { pageId: string; mode?: "main" | "thumb"; onsubmit?: () => void } = $props();

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);
  const html = $derived(projectStore.composed[pageId]?.html ?? null);

  let width = $state(0);
  let height = $state(0);
  let frame = $state<HTMLIFrameElement>();
  let popup = $state<HTMLDivElement>();
  let commentInput = $state<HTMLTextAreaElement>();
  let comment = $state("");
  let anchor = $state<{ x: number; y: number; bottom: number; selector: string } | null>(null);
  let windowWidth = $state(0);
  let windowHeight = $state(0);
  let popupWidth = $state(360);
  let popupHeight = $state(190);
  const selected = $derived(projectStore.selectedElement);
  const feedbackOpen = $derived(mode === "main" && anchor !== null && selected?.pageId === pageId && selected.selector === anchor.selector);
  const running = $derived(projectStore.run !== null || ["running", "waiting", "approval"].includes(sessionStore.statusOf(sessionStore.activeSessionId)));
  const popupLeft = $derived(anchor ? Math.max(12, Math.min(anchor.x, windowWidth - popupWidth - 12)) : 12);
  const popupTop = $derived(anchor ? Math.max(12, Math.min(anchor.bottom + 10 + popupHeight <= windowHeight - 12 ? anchor.bottom + 10 : anchor.y - popupHeight - 10, windowHeight - popupHeight - 12)) : 12);
  const selectableHtml = $derived(html ? html.replace("</body>", `${elementSelectionScript(pageId)}</body>`) : "");

  async function selectElement(event: MessageEvent): Promise<void> {
    if (mode !== "main" || !frame || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (data?.type !== "forma:element-selected" || data.pageId !== pageId) return;
    if (typeof data.selector !== "string" || typeof data.html !== "string" || typeof data.text !== "string") return;
    const bounds = data.bounds;
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every((value) => typeof value === "number" && Number.isFinite(value))) return;
    const frameRect = frame.getBoundingClientRect();
    const frameScale = size ? frameRect.width / size.width : 1;
    projectStore.selectElement({ pageId, selector: data.selector, html: data.html, text: data.text });
    anchor = { x: frameRect.x + bounds.x * frameScale, y: frameRect.y + bounds.y * frameScale, bottom: frameRect.y + (bounds.y + bounds.height) * frameScale, selector: data.selector };
    comment = "";
    await tick();
    commentInput?.focus();
  }

  function closeFeedback(): void {
    if (!feedbackOpen) return;
    anchor = null;
    projectStore.selectElement(null);
    frame?.focus();
  }

  function outsideFeedback(event: PointerEvent): void {
    if (feedbackOpen && event.target instanceof Node && popup && !popup.contains(event.target)) anchor = null;
  }

  async function applyFeedback(): Promise<void> {
    const message = comment.trim();
    const element = selected;
    if (!message || !element || running || !sessionStore.activeSessionId) return;
    const request = projectStore.sendRefine(message, { scope: "page", pageId: element.pageId, element }, "build");
    anchor = null;
    comment = "";
    projectStore.selectElement(null);
    onsubmit?.();
    await request;
  }

  function feedbackKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeFeedback();
    } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.target === commentInput) {
      event.preventDefault();
      void applyFeedback();
    }
  }

  function syncSelection(): void {
    const selected = projectStore.selectedElement;
    frame?.contentWindow?.postMessage({ type: "forma:selection", selector: selected?.pageId === pageId ? selected.selector : null }, "*");
  }

  $effect(syncSelection);

  $effect(() => {
    void projectStore.composePage(pageId);
  });

  const scale = $derived.by(() => {
    if (!size) return 1;
    if (mode === "thumb") {
      if (!width || !height) return 0;
      return Math.min(width / size.width, height / size.height);
    }
    const zoom = projectStore.zoom;
    if (zoom !== "fit") return zoom / 100;
    if (!width || !height) return 0;
    return Math.min(width / size.width, height / size.height);
  });

  const framedWidth = $derived(size ? size.width * scale : 0);
  const framedHeight = $derived(size ? size.height * scale : 0);
</script>

<svelte:window onmessage={selectElement} onpointerdown={outsideFeedback} onresize={closeFeedback} bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} />

{#if size && mode === "thumb"}
  <div
    class="page-thumb-frame"
    style={`--thumb-ratio:${size.width}/${size.height};`}
    bind:clientWidth={width}
    bind:clientHeight={height}
  >
    {#if html}
      <iframe
        class="page-frame"
        style={`width:${size.width}px;height:${size.height}px;transform:scale(${scale});`}
        srcdoc={html}
        sandbox="allow-scripts"
        tabindex="-1"
        aria-hidden="true"
        title="Slide thumbnail"
      ></iframe>
    {:else}
      <span class="page-thumb-empty"></span>
    {/if}
  </div>
{:else if size}
  <div class="preview-stage" bind:clientWidth={width} bind:clientHeight={height} onscroll={closeFeedback}>
    {#if html}
      <div class="preview-frame-wrap" style={`width:${framedWidth}px;height:${framedHeight}px;`}>
        <iframe
          bind:this={frame}
          onload={syncSelection}
          class="page-frame"
          style={`width:${size.width}px;height:${size.height}px;transform:scale(${scale});`}
          srcdoc={selectableHtml}
          sandbox="allow-scripts"
          tabindex="-1"
          title="Artwork preview — click an element to give AI feedback"
        ></iframe>
      </div>
    {:else}
      <div class="preview-loading"><span class="spinner"></span> Rendering…</div>
    {/if}
  </div>
{/if}

{#if feedbackOpen}
  <div
    class="element-feedback"
    role="dialog"
    tabindex="-1"
    aria-label="Give AI feedback on selected element"
    style={`left:${popupLeft}px;top:${popupTop}px;`}
    bind:this={popup}
    bind:offsetWidth={popupWidth}
    bind:offsetHeight={popupHeight}
    onkeydown={feedbackKeydown}
  >
    <form onsubmit={(event) => { event.preventDefault(); void applyFeedback(); }}>
    <div class="feedback-heading">
      <Icon name="message" size={15} />
      <strong>Change this element</strong>
      <button class="icon-btn" type="button" aria-label="Dismiss element feedback" onclick={closeFeedback}><Icon name="x" size={14} /></button>
    </div>
    <p class="feedback-element" title={selected?.text}>{selected?.text || "Selected shape"}</p>
    <textarea bind:this={commentInput} bind:value={comment} aria-label="Describe your change" placeholder="Make it green…" rows="3" disabled={running}></textarea>
    <div class="feedback-actions">
      <span>{running ? "AI is working…" : "Enter to send · Shift+Enter for a new line"}</span>
      <button class="btn btn-accent" type="submit" disabled={!comment.trim() || running || !sessionStore.activeSessionId}>Apply change</button>
    </div>
    </form>
  </div>
{/if}

<style>
  .element-feedback {
    position: fixed;
    z-index: 1000;
    width: min(360px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
    overflow-y: auto;
    padding: 14px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-2);
    font-family: var(--font-ui);
  }

  .feedback-heading,
  .feedback-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .feedback-heading strong {
    flex: 1;
    font-size: 13px;
  }

  .feedback-element {
    margin: 4px 0 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 12px;
  }

  textarea {
    display: block;
    width: 100%;
    min-height: 76px;
    resize: vertical;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface-2);
    color: var(--text);
    font: 13px/1.5 var(--font-ui);
  }

  textarea:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .feedback-actions {
    justify-content: space-between;
    margin-top: 12px;
  }

  .feedback-actions span {
    color: var(--muted);
    font-size: 10px;
    max-width: 170px;
  }
</style>
