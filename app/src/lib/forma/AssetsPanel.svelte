<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import ContextTextDialog from "./ContextTextDialog.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { pickFiles, openUrl } from "../rig/native";
  import { CONTEXT_ROLE_LABELS, CONTEXT_ROLE_OPTIONS, formatFileSize } from "./types";
  import type { ContextItem, ContextRole } from "./types";

  let importing = $state(false);
  let noteOpen = $state(false);
  let noteDraft = $state("");
  let noteName = $state("");
  let noteRole = $state<ContextRole>("content-source");
  let viewingId = $state<string | null>(null);

  const project = $derived(projectStore.current?.project);
  const sources = $derived(project?.sources ?? []);

  async function add(): Promise<void> {
    const paths = await pickFiles("Add assets and context");
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
    await projectStore.importNote(text, noteRole, noteName.trim() || undefined);
    noteDraft = "";
    noteName = "";
    noteOpen = false;
  }

  function changeRole(id: string, value: string): void {
    void projectStore.updateContext(id, { role: value as ContextRole });
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
  <div class="assets-actions">
    <button class="btn btn-accent" type="button" disabled={importing} onclick={() => void add()}>
      {#if importing}
        <span class="spinner"></span> Importing…
      {:else}
        <Icon name="plus" size={13} /> Add files
      {/if}
    </button>
    <button class="btn" type="button" onclick={() => (noteOpen = !noteOpen)}>
      <Icon name="pencil" size={13} /> Add note
    </button>
  </div>
  <p class="muted small">
    PNG, JPEG, WebP, SVG, PDF, TXT, Markdown. Files are copied into the project.
  </p>

  {#if noteOpen}
    <div class="note-form">
      <input
        class="input"
        type="text"
        placeholder="Note name (optional)"
        bind:value={noteName}
        aria-label="Note name"
      />
      <textarea
        class="input textarea"
        rows="4"
        placeholder="Paste notes or facts to use in the artwork…"
        bind:value={noteDraft}
        aria-label="Note text"
      ></textarea>
      <div class="note-form-foot">
        <select class="select" bind:value={noteRole} aria-label="Note role">
          {#each CONTEXT_ROLE_OPTIONS as role (role)}
            <option value={role}>{CONTEXT_ROLE_LABELS[role]}</option>
          {/each}
        </select>
        <button class="btn btn-accent" type="button" disabled={noteDraft.trim() === ""} onclick={() => void addNote()}>
          Add note
        </button>
      </div>
    </div>
  {/if}

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
          <select
            class="select"
            aria-label="Role for {item.name}"
            value={item.role}
            onchange={(event) => changeRole(item.id, event.currentTarget.value)}
          >
            {#each CONTEXT_ROLE_OPTIONS as role (role)}
              <option value={role}>{CONTEXT_ROLE_LABELS[role]}</option>
            {/each}
          </select>
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
    <p class="muted small">No assets or context yet.</p>
  {/if}

  <div class="sources-section">
    <h3 class="sources-title">Sources</h3>
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
  </div>
</div>

{#if viewingId}
  <ContextTextDialog id={viewingId} onclose={() => (viewingId = null)} />
{/if}
