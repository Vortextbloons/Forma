<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { editStore } from "./editStore.svelte";
  import { cssPixelSize, effectiveSize } from "../../../../src/projects/size.ts";
  import { elementEditScript } from "../../../../src/rendering/editScript.ts";
  import { isEditFrameMessage, type EditCommandMessage } from "../../../../src/rendering/editContract.ts";

  let { pageId, onwheel }: { pageId: string; onwheel?: (deltaY: number) => void } = $props();

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? cssPixelSize(effectiveSize(project.settings)) : null);

  let width = $state(0);
  let height = $state(0);
  let frame = $state<HTMLIFrameElement>();
  let srcdoc = $state("");
  let frameRev = $state("");

  const paused = $derived(editStore.paused);
  const saveFailure = $derived(editStore.saveFailure);

  $effect(() => {
    const key = `${pageId}:${editStore.frameKey(pageId)}`;
    void rebuild(key);
  });

  async function rebuild(key: string): Promise<void> {
    const session = await editStore.ensureSession(pageId);
    if (!session || `${pageId}:${editStore.frameKey(pageId)}` !== key) return;
    const html = await projectStore.composePage(pageId);
    if (!html || `${pageId}:${editStore.frameKey(pageId)}` !== key) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#d6a85f";
    srcdoc = html.replace("</body>", `${elementEditScript(pageId, session.rev, accent)}</body>`);
    frameRev = session.rev;
    editStore.noteFrameBuilt(pageId, session.rev);
  }

  async function handleMessage(event: MessageEvent): Promise<void> {
    if (!frame || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!isEditFrameMessage(data) || data.pageId !== pageId) return;
    if (data.type === "forma:page-wheel") {
      const stage = frame.closest(".preview-stage");
      if (stage && projectStore.zoom !== "fit" && (stage.scrollHeight > stage.clientHeight || stage.scrollWidth > stage.clientWidth)) return;
      onwheel?.(data.deltaY);
      return;
    }
    editStore.handleFrameMessage(data);
    if (data.type === "forma:edit-ready") postToFrame({ type: "forma:edit-pause", rev: frameRev, paused });
  }

  function postToFrame(message: EditCommandMessage): void {
    frame?.contentWindow?.postMessage(message, "*");
  }

  $effect(() => {
    postToFrame({ type: "forma:edit-pause", rev: frameRev, paused });
  });

  $effect(() => {
    editStore.attachFrame(postToFrame, pageId);
    return () => editStore.attachFrame(null, pageId);
  });

  function keydown(event: KeyboardEvent): void {
    if (!editStore.editMode || paused) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
    if (event.key === "Escape") {
      editStore.clearSelection();
      return;
    }
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) editStore.redo();
      else editStore.undo();
      return;
    }
    if (meta && event.key.toLowerCase() === "y") {
      event.preventDefault();
      editStore.redo();
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    editStore.nudge(dx, dy);
  }

  const scale = $derived.by(() => {
    if (!size) return 1;
    const zoom = projectStore.zoom;
    if (zoom !== "fit") return zoom / 100;
    if (!width || !height) return 0;
    return Math.min(width / size.width, height / size.height);
  });

  const framedWidth = $derived(size ? size.width * scale : 0);
  const framedHeight = $derived(size ? size.height * scale : 0);
</script>

<svelte:window onmessage={handleMessage} onkeydown={keydown} />

<div class="edit-canvas">
  <div class="preview-stage edit-stage" bind:clientWidth={width} bind:clientHeight={height}>
    {#if srcdoc}
      <div class="preview-frame-wrap" style={`width:${framedWidth}px;height:${framedHeight}px;`}>
        <iframe
          bind:this={frame}
          class="page-frame"
          style={`width:${size?.width ?? 0}px;height:${size?.height ?? 0}px;transform:scale(${scale});`}
          {srcdoc}
          sandbox="allow-scripts"
          tabindex="-1"
          title="Artwork editor"
        ></iframe>
      </div>
    {:else}
      <div class="preview-loading"><span class="spinner"></span> Rendering…</div>
    {/if}
    {#if paused}
      <div class="edit-veil" role="status">
        <span class="spinner"></span>
        {projectStore.run ? "Forma is working — editing paused" : "Exporting — editing paused"}
      </div>
    {/if}
  </div>

  {#if saveFailure}
    <div class="stage-banner edit-save-banner">
      <Icon name="alert" size={14} />
      <span>Save failed — {saveFailure}</span>
      <button class="btn btn-ghost" type="button" onclick={() => void editStore.retrySave()}>Retry</button>
      <button class="btn btn-ghost" type="button" onclick={() => void editStore.discardDraft()}>Discard draft</button>
    </div>
  {/if}
</div>

<style>
  .edit-canvas {
    display: flex;
    flex: 1;
    min-height: 0;
    width: 100%;
    flex-direction: column;
  }

  .edit-stage {
    position: relative;
  }

  .edit-veil {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: color-mix(in srgb, var(--canvas) 55%, transparent);
    color: var(--muted);
    font-size: 12px;
    cursor: progress;
  }

  .edit-save-banner {
    flex-shrink: 0;
  }
</style>
