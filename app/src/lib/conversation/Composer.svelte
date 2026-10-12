<script lang="ts">
  import ModelPicker from "../models/ModelPicker.svelte";
  import ThinkingPicker from "../models/ThinkingPicker.svelte";
  import Icon from "../components/Icon.svelte";
  import ContextIndicator from "./ContextIndicator.svelte";
  import DesignMashup from "../forma/DesignMashup.svelte";
  import { sendCommand } from "../rig/bridge";
  import { messageStore, IMAGE_ONLY_TEXT } from "../rig/stores/messageStore.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";
  import { modelStore } from "../rig/stores/modelStore.svelte";
  import { providerStore } from "../rig/stores/providerStore.svelte";
  import { projectStore } from "../forma/projectStore.svelte";
  import type { ChatTarget } from "../forma/projectStore.svelte";

  const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
  const IMAGE_EXTENSIONS: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
  const MAX_ATTACHMENTS = 6;
  const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
  const ATTACHMENT_MAX_DIMENSION = 1600;

  interface Attachment {
    id: number;
    name: string;
    mime: string;
    data: string;
    url: string;
  }

  let { target = { scope: "project" } as ChatTarget }: { target?: ChatTarget } = $props();

  let draft = $state("");
  let busy = $state(false);
  let menuOpen = $state(false);
  let attachMenuOpen = $state(false);
  let targetMenuOpen = $state(false);
  let attachments = $state<Attachment[]>([]);
  let dropActive = $state(false);
  let previewUrl = $state<string | null>(null);
  let menuWrap: HTMLDivElement | undefined = $state();
  let attachWrap: HTMLDivElement | undefined = $state();
  let targetWrap: HTMLDivElement | undefined = $state();
  let textarea: HTMLTextAreaElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let attachmentSeq = 0;

  const sessionId = $derived(sessionStore.activeSessionId);
  const mode = $derived(projectStore.current?.project.mode === "plan" ? "plan" : "build");
  const running = $derived(busy || projectStore.run !== null || ["running", "waiting", "approval"].includes(sessionStore.statusOf(sessionId)));
  const canSend = $derived(sessionId !== null && (draft.trim() !== "" || attachments.length > 0) && !running);
  const elementPageLabel = $derived.by(() => {
    const project = projectStore.current?.project;
    if (!project || !target.pageId) return "";
    if (project.settings.output === "poster") return "Poster";
    const index = project.pages.indexOf(target.pageId);
    const title = project.pageMeta[target.pageId]?.title;
    return `Slide ${index + 1}${title ? ` · ${title}` : ""}`;
  });
  const slideTarget = $derived.by(() => {
    const project = projectStore.current?.project;
    const pageId = projectStore.refineTargetPageId;
    if (!project || !pageId || project.settings.output !== "slides") return null;
    const index = project.pages.indexOf(pageId);
    if (index === -1) return null;
    return { pageId, index, title: project.pageMeta[pageId]?.title ?? "" };
  });
  const slideTargetLabel = $derived(
    slideTarget ? `Slide ${slideTarget.index + 1}${slideTarget.title ? ` · ${slideTarget.title}` : ""}` : "",
  );
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
  const designSettings = $derived(projectStore.current?.project.settings);
  const designApproved = $derived(designSettings?.designApproved ?? false);
  const designLabel = $derived(designApproved ? (designSettings?.designName ?? "Custom") : "AI chooses");
  const isSlides = $derived(projectStore.current?.project.settings.output === "slides");
  const slides = $derived(projectStore.current?.project.pages ?? []);

  $effect(() => {
    void draft;
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

  $effect(() => {
    if (!attachMenuOpen) return;
    const close = (event: PointerEvent): void => {
      if (attachWrap && !attachWrap.contains(event.target as Node)) attachMenuOpen = false;
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  });

  $effect(() => {
    if (!targetMenuOpen) return;
    const close = (event: PointerEvent): void => {
      if (targetWrap && !targetWrap.contains(event.target as Node)) targetMenuOpen = false;
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  });

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    attachMenuOpen = false;
    targetMenuOpen = false;
    previewUrl = null;
  }

  function pickSlideTarget(pageId: string | null): void {
    if (pageId) projectStore.toggleRefineTarget(pageId);
    else if (projectStore.refineTargetPageId) projectStore.toggleRefineTarget(projectStore.refineTargetPageId);
    targetMenuOpen = false;
  }

  function imageInputSupport(): boolean | undefined {
    if (modelStore.selectedModel === "auto") return undefined;
    const input = modelStore.selectedInfo()?.input;
    return Array.isArray(input) ? input.includes("image") : undefined;
  }

  function attachmentMime(file: File): string | undefined {
    if (IMAGE_TYPES.has(file.type)) return file.type;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    return IMAGE_EXTENSIONS[extension];
  }

  function toBase64(buffer: ArrayBuffer): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  async function prepareAttachment(file: File, mime: string): Promise<{ data: string; mime: string }> {
    if (file.size <= MAX_ATTACHMENT_BYTES) {
      return { data: toBase64(await file.arrayBuffer()), mime };
    }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, ATTACHMENT_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    if (!blob) throw new Error("the image could not be processed");
    return { data: toBase64(await blob.arrayBuffer()), mime: "image/webp" };
  }

  async function addFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    const images: Array<{ file: File; mime: string }> = [];
    for (const file of files) {
      const mime = attachmentMime(file);
      if (mime) images.push({ file, mime });
      else {
        notificationStore.push({
          type: "error",
          message: `"${file.name || "That file"}" is not a supported image. Attach PNG, JPEG, or WebP files.`,
        });
      }
    }
    const room = MAX_ATTACHMENTS - attachments.length;
    if (images.length > room) {
      notificationStore.push({ type: "error", message: `Attach up to ${MAX_ATTACHMENTS} images per message.` });
    }
    for (const { file, mime } of images.slice(0, Math.max(0, room))) {
      try {
        const prepared = await prepareAttachment(file, mime);
        attachments.push({
          id: ++attachmentSeq,
          name: file.name || "Attached image",
          mime: prepared.mime,
          data: prepared.data,
          url: `data:${prepared.mime};base64,${prepared.data}`,
        });
      } catch (error) {
        notificationStore.push({
          type: "error",
          message: `Could not attach "${file.name || "image"}": ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  function removeAttachment(id: number): void {
    attachments = attachments.filter((attachment) => attachment.id !== id);
  }

  function onFilePicked(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    void addFiles(files);
  }

  function onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && IMAGE_TYPES.has(item.type))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  }

  function acceptsFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes("Files") ?? false;
  }

  function onDragOver(event: DragEvent): void {
    if (!acceptsFiles(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
    dropActive = true;
  }

  function onDragLeave(event: DragEvent): void {
    if (event.relatedTarget instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    dropActive = false;
  }

  function onDrop(event: DragEvent): void {
    if (!acceptsFiles(event)) return;
    event.preventDefault();
    dropActive = false;
    void addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  async function submit(): Promise<void> {
    const text = draft.trim();
    const sid = sessionId;
    if ((!text && attachments.length === 0) || !sid || running) return;
    const images = attachments.map((attachment) => ({ data: attachment.data, mediaType: attachment.mime }));
    if (images.length > 0 && imageInputSupport() === false) {
      notificationStore.push({
        type: "error",
        message: "The selected model cannot read images. Choose an image-capable model, then send again.",
      });
      return;
    }
    await modelStore.flushPendingModel();
    if (projectStore.current) {
      busy = true;
      draft = "";
      attachments = [];
      try {
        await projectStore.sendRefine(text, target, mode, images);
      } finally {
        busy = false;
      }
      return;
    }
    messageStore.addUserMessage(sid, text, undefined, images.length ? images.map((image) => ({ data: image.data, mimeType: image.mediaType })) : undefined);
    busy = true;
    draft = "";
    attachments = [];
    try {
      await sendCommand("prompt", { sessionId: sid, prompt: text || IMAGE_ONLY_TEXT, ...(images.length ? { images } : {}) }, { timeoutMs: 0 });
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

<div
  class="composer"
  class:composer-drop-active={dropActive}
  role="group"
  aria-label="Message composer"
  data-file-drop-target="chat"
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  {#if target.element}
    <div class="selection-context" aria-live="polite">
      <div class="selection-context-heading">
        <Icon name="check" size={14} />
        <strong>Element selected</strong>
        <button class="icon-btn" type="button" aria-label="Remove selected element from message" title="Remove selection" onclick={() => projectStore.selectElement(null)}><Icon name="x" size={14} /></button>
      </div>
      <p class="selection-context-text" title={target.element.text}>{target.element.text || "Selected shape"}</p>
      <span class="selection-context-page">{elementPageLabel}</span>
    </div>
  {:else if slideTarget}
    <div class="selection-context" aria-live="polite">
      <div class="selection-context-heading">
        <Icon name="file" size={14} />
        <strong>Editing {slideTargetLabel} only</strong>
        <button class="icon-btn" type="button" aria-label="Edit all slides instead" title="Edit all slides" onclick={() => pickSlideTarget(null)}><Icon name="x" size={14} /></button>
      </div>
    </div>
  {/if}
  {#if attachments.length > 0}
    <div class="composer-attachments">
      {#each attachments as attachment (attachment.id)}
        <div class="composer-attachment">
          <button
            class="composer-attachment-thumb"
            type="button"
            title={attachment.name}
            aria-label={`Preview ${attachment.name}`}
            onclick={() => (previewUrl = attachment.url)}
          >
            <img src={attachment.url} alt={attachment.name} />
          </button>
          <button
            class="composer-attachment-remove"
            type="button"
            aria-label={`Remove ${attachment.name}`}
            title="Remove"
            onclick={() => removeAttachment(attachment.id)}
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      {/each}
    </div>
  {/if}
  <textarea
    class="input textarea composer-textarea"
    placeholder={sessionId
      ? projectStore.current
        ? target.element ? "Describe a change to this element…" : slideTarget ? "Describe a change to this slide…" : mode === "plan" ? "Explore an idea or plan a change…" : "Describe what to build or change…"
        : "Describe a task…"
      : "Preparing conversation…"}
    rows="1"
    bind:this={textarea}
    bind:value={draft}
    onkeydown={onKeydown}
    onpaste={onPaste}
    disabled={sessionId === null}
    aria-label="Message the agent"
  ></textarea>
  <div class="composer-toolbar">
    <div class="composer-menu-wrap" bind:this={attachWrap}>
      <button
        class="composer-attach"
        type="button"
        aria-expanded={attachMenuOpen}
        aria-haspopup="true"
        aria-label="Add attachment"
        title="Add attachment"
        onclick={() => (attachMenuOpen = !attachMenuOpen)}
      >
        <Icon name="plus" size={15} />
      </button>
      {#if attachMenuOpen}
        <div class="composer-menu composer-attach-menu" role="menu" aria-label="Add attachment">
          <button
            class="composer-menu-item"
            type="button"
            role="menuitem"
            onclick={() => {
              attachMenuOpen = false;
              fileInput?.click();
            }}
          >
            <Icon name="image" size={14} /> Attach images
          </button>
        </div>
      {/if}
    </div>
    {#if projectStore.current}
      <div class="segmented segmented-small" role="group" aria-label="Work mode" title={mode === "plan" ? "Discuss ideas and make a plan. Artwork stays unchanged." : "Create and edit artwork. No plan needed."}>
        <button type="button" class:active={mode === "plan"} aria-pressed={mode === "plan"} disabled={running} onclick={() => projectStore.updateBrief({ mode: "plan" })}>Plan</button>
        <button type="button" class:active={mode === "build"} aria-pressed={mode === "build"} disabled={running} onclick={() => projectStore.updateBrief({ mode: "create" })}>Build</button>
      </div>
    {/if}
    {#if projectStore.current && isSlides && slides.length > 0}
      <div class="composer-menu-wrap" bind:this={targetWrap}>
        <button
          class="composer-target"
          class:composer-target-active={slideTarget}
          type="button"
          aria-expanded={targetMenuOpen}
          aria-haspopup="true"
          title={slideTarget ? "This message will only change this slide" : "Messages can change the whole presentation"}
          onclick={() => (targetMenuOpen = !targetMenuOpen)}
        >
          <Icon name="file" size={13} />
          <span class="composer-target-label">{slideTarget ? slideTargetLabel : "All slides"}</span>
          <Icon name="chevron-down" size={12} />
        </button>
        {#if targetMenuOpen}
          <div class="composer-menu composer-target-menu" role="menu" aria-label="Slides this message can change">
            <button class="composer-menu-item" class:active={!slideTarget} type="button" role="menuitem" onclick={() => pickSlideTarget(null)}>All slides</button>
            {#each slides as pageId, i (pageId)}
              <button class="composer-menu-item" class:active={slideTarget?.pageId === pageId} type="button" role="menuitem" onclick={() => pickSlideTarget(pageId)}>
                {i + 1} · {projectStore.current.project.pageMeta[pageId]?.title || `Slide ${i + 1}`}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    <div class="composer-menu-wrap" bind:this={menuWrap}>
      <button
        class="composer-model"
        type="button"
        aria-expanded={menuOpen}
        aria-haspopup="true"
        onclick={() => (menuOpen = !menuOpen)}
      >
        <Icon name="zap" size={13} />
        <span class="composer-model-stack">
          <span class="composer-model-provider">{providerLabel}</span>
          <span class="composer-model-name">{modelLabel}</span>
        </span>
        <Icon name="chevron-down" size={12} />
      </button>
      {#if menuOpen}
        <div class="composer-menu" role="menu" aria-label="Model settings">
          <ModelPicker />
        </div>
      {/if}
    </div>
    <ThinkingPicker />
    <span class="composer-spacer"></span>
    {#if projectStore.current}
      <button class="btn btn-ghost" type="button" onclick={() => window.dispatchEvent(new CustomEvent("forma:open-references"))}>
        <Icon name="plus" size={13} /> Project materials
      </button>
      <button class="btn btn-ghost composer-design" type="button" title="Color palette and typography" onclick={() => window.dispatchEvent(new CustomEvent("forma:open-design", { detail: { view: "profile" } }))}>
        {#if designApproved && designSettings?.designProfile}
          <DesignMashup profile={designSettings.designProfile} height={18} width={40} />
        {:else}
          <span class="composer-design-empty" aria-hidden="true"></span>
        {/if}
        Design profile: {designLabel}
      </button>
    {/if}
    <ContextIndicator />
    {#if running}
      <button class="btn" type="button" onclick={() => void projectStore.stopGeneration()} aria-label="Stop response">
        <Icon name="x" size={14} /> Stop
      </button>
    {:else}
      <button class="btn btn-accent" type="button" onclick={() => void submit()} disabled={!canSend} aria-label="Send">
        <Icon name="send" size={14} />
        Send
      </button>
    {/if}
  </div>
  <input
    bind:this={fileInput}
    class="composer-file-input"
    type="file"
    accept="image/png,image/jpeg,image/webp"
    multiple
    onchange={onFilePicked}
  />
</div>

{#if previewUrl}
  <div
    class="composer-preview"
    role="dialog"
    aria-modal="true"
    aria-label="Attached image preview"
    tabindex="-1"
    onclick={(event) => {
      if (event.target === event.currentTarget) previewUrl = null;
    }}
    onkeydown={(event) => {
      if (event.key === "Escape") previewUrl = null;
    }}
  >
    <button class="icon-btn composer-preview-close" type="button" aria-label="Close preview" onclick={() => (previewUrl = null)}>
      <Icon name="x" size={16} />
    </button>
    <img src={previewUrl} alt="" />
  </div>
{/if}

<svelte:window onkeydown={onWindowKeydown} />

<style>
  .composer-design {
    gap: 9px;
  }
  .composer-target {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  .composer-target:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .composer-target-active,
  .composer-target-active:hover {
    border-color: color-mix(in srgb, var(--accent) 65%, var(--border));
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
    color: var(--accent);
  }
  .composer-target-label {
    max-width: 170px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .composer-target-menu {
    min-width: 220px;
    max-height: 280px;
    overflow-y: auto;
  }
  .composer-menu-item.active {
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
    color: var(--accent);
    font-weight: 700;
  }
  .composer-design-empty {
    width: 26px;
    height: 14px;
    border: 1.5px dashed var(--border-strong);
    border-radius: 999px;
  }
  .composer-attach {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }

  .composer-attach:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .composer-attach-menu {
    min-width: 150px;
    padding: 4px;
  }

  .composer-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 9px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .composer-menu-item:hover {
    background: var(--surface-2);
  }

  .composer-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 8px 8px 2px;
  }

  .composer-attachment {
    position: relative;
  }

  .composer-attachment-thumb {
    display: block;
    width: 64px;
    height: 64px;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    cursor: pointer;
  }

  .composer-attachment-thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .composer-attachment-remove {
    position: absolute;
    top: -7px;
    right: -7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
  }

  .composer-attachment-remove:hover {
    color: var(--text);
  }

  .composer-file-input {
    display: none;
  }

  .composer-drop-active,
  :global(.composer.file-drop-target-active) {
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
  }

  .composer-preview {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    background: rgb(0 0 0 / 0.6);
  }

  .composer-preview img {
    max-width: 100%;
    max-height: 100%;
    border-radius: 10px;
    background: var(--surface);
  }

  .composer-preview-close {
    position: absolute;
    top: 16px;
    right: 16px;
    background: var(--surface);
  }

  .selection-context {
    margin-bottom: 12px;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 65%, var(--border));
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  }

  .selection-context-heading {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--accent);
    font-size: 12px;
  }

  .selection-context-heading strong {
    flex: 1;
  }

  .selection-context-text {
    overflow: hidden;
    margin: 2px 0 0;
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow-wrap: anywhere;
  }

  .selection-context-page {
    color: var(--muted);
    font-size: 11px;
  }
</style>
