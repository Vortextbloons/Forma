<script lang="ts">
  import { tick } from "svelte";
  import Icon from "../components/Icon.svelte";
  import ModelPicker from "../models/ModelPicker.svelte";
  import ThinkingPicker from "../models/ThinkingPicker.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { modelStore } from "../rig/stores/modelStore.svelte";
  import { providerStore } from "../rig/stores/providerStore.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { effectiveSize } from "../../../../src/projects/size.ts";
  import { elementSelectionScript } from "../../../../src/rendering/selection.ts";

  let {
    pageId,
    mode = "main",
    onsubmit,
    onwheel,
  }: { pageId: string; mode?: "main" | "thumb"; onsubmit?: () => void; onwheel?: (deltaY: number) => void } = $props();

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);
  const html = $derived(projectStore.composed[pageId]?.html ?? null);

  let width = $state(0);
  let height = $state(0);
  let frame = $state<HTMLIFrameElement>();
  let popup = $state<HTMLDivElement>();
  let commentInput = $state<HTMLTextAreaElement>();
  let comment = $state("");
  let modelMenuOpen = $state(false);
  let modelWrap: HTMLDivElement | undefined = $state();
  let anchor = $state<{ x: number; y: number; bottom: number; selector: string } | null>(null);
  let windowWidth = $state(0);
  let windowHeight = $state(0);
  let popupWidth = $state(360);
  let popupHeight = $state(190);
  const selected = $derived(projectStore.selectedElement);
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
  const feedbackOpen = $derived(mode === "main" && anchor !== null && selected?.pageId === pageId && selected.selector === anchor.selector);
  const running = $derived(projectStore.run !== null || ["running", "waiting", "approval"].includes(sessionStore.statusOf(sessionStore.activeSessionId)));
  const popupLeft = $derived(anchor ? Math.max(12, Math.min(anchor.x, windowWidth - popupWidth - 12)) : 12);
  const popupTop = $derived.by(() => {
    if (!anchor) return 12;
    const below = anchor.bottom + 10;
    const above = anchor.y - popupHeight - 10;
    const spaceBelow = windowHeight - 12 - below;
    const spaceAbove = anchor.y - 10 - 12;
    const top = spaceBelow >= popupHeight || spaceBelow >= spaceAbove ? below : above;
    return Math.max(12, Math.min(top, windowHeight - popupHeight - 12));
  });
  const selectableHtml = $derived(html ? html.replace("</body>", `${elementSelectionScript(pageId)}</body>`) : "");

  async function selectElement(event: MessageEvent): Promise<void> {
    if (mode !== "main" || !frame || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (data?.type === "forma:page-wheel" && data.pageId === pageId && typeof data.deltaY === "number") {
      const stage = frame.closest(".preview-stage");
      if (stage && projectStore.zoom !== "fit" && (stage.scrollHeight > stage.clientHeight || stage.scrollWidth > stage.clientWidth)) return;
      onwheel?.(data.deltaY);
      return;
    }
    if (data?.type !== "forma:element-selected" || data.pageId !== pageId) return;
    if (typeof data.selector !== "string" || typeof data.html !== "string" || typeof data.text !== "string") return;
    const bounds = data.bounds;
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every((value) => typeof value === "number" && Number.isFinite(value))) return;
    const frameRect = frame.getBoundingClientRect();
    const frameScale = size ? frameRect.width / size.width : 1;
    projectStore.selectElement({ pageId, selector: data.selector, html: data.html, text: data.text });
    anchor = { x: frameRect.x + bounds.x * frameScale, y: frameRect.y + bounds.y * frameScale, bottom: frameRect.y + (bounds.y + bounds.height) * frameScale, selector: data.selector };
    comment = "";
    modelMenuOpen = false;
    await tick();
    commentInput?.focus();
  }

  function closeFeedback(): void {
    if (!feedbackOpen) return;
    anchor = null;
    modelMenuOpen = false;
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
    modelMenuOpen = false;
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

  function stageWheel(event: WheelEvent): void {
    if (event.ctrlKey || !onwheel || project?.settings.output !== "slides") return;
    const stage = event.currentTarget as HTMLElement;
    if (projectStore.zoom !== "fit" && (stage.scrollHeight > stage.clientHeight || stage.scrollWidth > stage.clientWidth)) return;
    onwheel(event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? stage.clientHeight : 1));
  }

  function syncSelection(): void {
    const selected = projectStore.selectedElement;
    frame?.contentWindow?.postMessage({ type: "forma:selection", selector: selected?.pageId === pageId ? selected.selector : null }, "*");
  }

  $effect(syncSelection);

  $effect(() => {
    if (!modelMenuOpen) return;
    const close = (event: PointerEvent): void => {
      if (modelWrap && !modelWrap.contains(event.target as Node)) modelMenuOpen = false;
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  });

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
  <div class="preview-stage" bind:clientWidth={width} bind:clientHeight={height} onscroll={closeFeedback} onwheel={stageWheel}>
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
    <div class="feedback-toolbar">
      <div class="composer-menu-wrap" bind:this={modelWrap}>
        <button
          class="composer-model"
          type="button"
          aria-expanded={modelMenuOpen}
          aria-haspopup="true"
          onclick={() => (modelMenuOpen = !modelMenuOpen)}
        >
          <Icon name="zap" size={13} />
          <span class="composer-model-stack">
            <span class="composer-model-provider">{providerLabel}</span>
            <span class="composer-model-name">{modelLabel}</span>
          </span>
          <Icon name="chevron-down" size={12} />
        </button>
        {#if modelMenuOpen}
          <div class="composer-menu" role="menu" aria-label="Model settings">
            <ModelPicker />
          </div>
        {/if}
      </div>
      <ThinkingPicker />
      <button class="btn btn-accent feedback-apply" type="submit" disabled={!comment.trim() || running || !sessionStore.activeSessionId}>Apply change</button>
    </div>
    </form>
  </div>
{/if}

<style>
  .element-feedback {
    position: fixed;
    z-index: 1000;
    width: min(360px, calc(100vw - 24px));
    padding: 14px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-2);
    font-family: var(--font-ui);
  }

  .feedback-heading {
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

  .feedback-toolbar {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 8px;
  }

  .feedback-apply {
    padding: 4px 8px;
    font-size: 12px;
    white-space: nowrap;
    margin-left: auto;
  }
</style>
