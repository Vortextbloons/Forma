<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import Collapsible from "../components/Collapsible.svelte";
  import ContextTextDialog from "./ContextTextDialog.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { pickFiles, openUrl } from "../rig/native";
  import { formatFileSize } from "./types";
  import type { ContextItem } from "./types";

  let importing = $state(false);
  let noteOpen = $state(false);
  let noteDraft = $state("");
  let noteName = $state("");
  let viewingId = $state<string | null>(null);
  let actionsEl = $state<HTMLElement | null>(null);

  function onWindowPointerDown(event: PointerEvent): void {
    if (!noteOpen) return;
    if (actionsEl && event.target instanceof Node && actionsEl.contains(event.target)) return;
    noteOpen = false;
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") noteOpen = false;
  }

  const project = $derived(projectStore.current?.project);
  const sources = $derived(project?.sources ?? []);

  async function add(): Promise<void> {
    const paths = await pickFiles("Add reference images and documents");
    if (paths.length === 0) return;
    importing = true;
    try {
      await projectStore.importContext(paths, "optional");
    } finally {
      importing = false;
    }
  }

  async function addNote(): Promise<void> {
    const text = noteDraft.trim();
    if (!text) return;
    await projectStore.importNote(text, "content-source", noteName.trim() || undefined);
    noteDraft = "";
    noteName = "";
    noteOpen = false;
  }

  function remove(id: string): void {
    void projectStore.removeContext(id);
  }

  function sourceFor(item: ContextItem) {
    return item.sourceId ? sources.find((source) => source.id === item.sourceId) : undefined;
  }

  function extractionLabel(item: ContextItem): string {
    if (!item.extraction) return "";
    const kind =
      item.extraction.kind === "ocr" ? "OCR" : item.extraction.kind === "mixed" ? "Text + OCR" : "Text";
    return `${item.extraction.pages} page${item.extraction.pages === 1 ? "" : "s"} · ${kind}`;
  }
</script>

<div class="assets-panel">
  <h2>References</h2>
  <p class="muted small">Add images the AI can use in your artwork and information to draw from. Forma chooses what fits your brief.</p>
  <div class="assets-actions" bind:this={actionsEl}>
    <button class="btn btn-accent" type="button" disabled={importing} onclick={() => void add()}>
      {#if importing}
        <span class="spinner"></span> Importing…
      {:else}
        <Icon name="plus" size={13} /> Add files
      {/if}
    </button>
    <button class="btn" type="button" aria-expanded={noteOpen} onclick={() => (noteOpen = !noteOpen)}>
      <Icon name="pencil" size={13} /> Add information
    </button>
    {#if noteOpen}
      <div class="note-form">
        <input
          class="input"
          type="text"
          placeholder="Title (optional)"
          bind:value={noteName}
          aria-label="Information title"
        />
        <textarea
          class="input textarea"
          rows="4"
          placeholder="Add facts, background, or key messages for the AI to draw from…"
          bind:value={noteDraft}
          aria-label="Reference information"
        ></textarea>
        <div class="note-form-foot">
          <button class="btn btn-accent" type="button" disabled={noteDraft.trim() === ""} onclick={() => void addNote()}>
            Add information
          </button>
        </div>
      </div>
    {/if}
  </div>
  <p class="muted small">
    PNG, JPEG, WebP, SVG, PDF, TXT, Markdown. Files are copied into the project.
  </p>

  {#if project && project.context.length > 0}
    {#each project.context as item (item.id)}
      <div class="asset-item">
        <div class="asset-head">
          <Icon name="file" size={13} />
          <span class="asset-name" title={item.name}>{item.name}</span>
          <button
            class="icon-btn"
            type="button"
            title="Remove"
            aria-label="Remove {item.name}"
            onclick={() => remove(item.id)}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
        <div class="asset-meta">
          <span class="muted small">{item.mime.startsWith("image/") ? "Image" : "Information"}</span>
          <span class="muted small">{formatFileSize(item.size)}</span>
        </div>
        <div class="asset-status">
          {#if item.status === "processing"}
            <span class="muted small"><span class="spinner"></span> Extracting text…</span>
          {:else if item.status === "error"}
            <span class="error-text small" title={item.error ?? ""}>
              <Icon name="alert" size={12} /> {item.error ?? "Extraction failed"}
            </span>
          {:else if item.extraction}
            <span class="muted small">{extractionLabel(item)}</span>
            <button class="status-link" type="button" onclick={() => (viewingId = item.id)}>View text</button>
          {/if}
        </div>
        {#if sourceFor(item)}
          {@const source = sourceFor(item)!}
          <div class="asset-source muted small">
            <Icon name="link" size={11} />
            {#if source.authorUrl}
              <button class="link-btn" type="button" onclick={() => void openUrl(source.authorUrl!)}>
                {source.author ?? "Photographer"}
              </button>
            {/if}
            {#if source.url}
              <span>·</span>
              <button class="link-btn" type="button" onclick={() => void openUrl(source.url!)}>Pexels</button>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  {:else}
    <p class="muted small">No references yet. Add images, documents, or information to give Forma a starting point.</p>
  {/if}

  <div class="sources-section">
    <Collapsible title="Sources">
      {#if sources.length === 0}
        <p class="muted small">Research links and photo provenance appear here.</p>
      {:else}
        <ul class="sources-list">
          {#each sources as source (source.id)}
            <li class="source-row">
              <span class="source-kind">{source.kind === "photo" ? "Photo" : "Web"}</span>
              {#if source.url}
                <button class="link-btn source-title" type="button" title={source.url} onclick={() => void openUrl(source.url!)}>
                  {source.title}
                </button>
              {:else}
                <span class="source-title">{source.title}</span>
              {/if}
              {#if source.author}
                <span class="muted small">
                  by
                  {#if source.authorUrl}
                    <button class="link-btn" type="button" onclick={() => void openUrl(source.authorUrl!)}>{source.author}</button>
                  {:else}
                    {source.author}
                  {/if}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </Collapsible>
  </div>
</div>

{#if viewingId}
  <ContextTextDialog id={viewingId} onclose={() => (viewingId = null)} />
{/if}

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />
