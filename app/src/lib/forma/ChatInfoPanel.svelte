<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { DENSITY_LABELS, OUTPUT_LABELS, STYLE_LABELS } from "./types";
  import { formatDimensions } from "./sizes";
  import { effectiveSize } from "../../../../src/projects/size.ts";

  const project = $derived(projectStore.current?.project);
  const isSlides = $derived(project?.settings.output === "slides");
  const size = $derived(project ? effectiveSize(project.settings) : null);
  const ratio = $derived(size ? ratioOf(size) : null);

  let nameDraft = $derived(project?.name ?? "");
  let promptDraft = $derived(project?.prompt ?? "");

  function ratioOf(size: { width: number; height: number; unit: string }): string | null {
    if (size.unit !== "px" || !size.width || !size.height) return null;
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const d = gcd(size.width, size.height);
    const w = size.width / d;
    const h = size.height / d;
    if (w > 40 || h > 40) return `${(size.width / size.height).toFixed(2)}:1`;
    return `${w}:${h}`;
  }

  function saveName(): void {
    const name = nameDraft.trim();
    if (project && name && name !== project.name) {
      projectStore.updateBrief({ name });
    } else if (project) {
      nameDraft = project.name;
    }
  }

  function savePrompt(): void {
    if (project && promptDraft !== project.prompt) {
      projectStore.updateBrief({ prompt: promptDraft });
    }
  }

  function openDesign(): void {
    window.dispatchEvent(new CustomEvent("forma:open-design", { detail: { view: "settings" } }));
  }
</script>

<aside class="chat-info-panel" aria-label="Project information">
  {#if project}
    <div class="info-block">
      <span class="info-eyebrow" id="brief-heading">Brief</span>
      <div class="name-field">
        <input
          class="chat-info-title"
          type="text"
          placeholder="Project name"
          bind:value={nameDraft}
          onblur={saveName}
          onkeydown={(event) => {
            if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
          }}
          aria-label="Project name"
        />
        <Icon name="pencil" size={12} />
      </div>
      <textarea
        class="chat-info-brief"
        rows="4"
        placeholder="Describe what Forma should make — audience, tone, must-haves…"
        bind:value={promptDraft}
        oninput={savePrompt}
        aria-label="Project brief"
      ></textarea>
    </div>

    <div class="info-block">
      <span class="info-eyebrow">Specifications</span>
      <div class="spec-card">
        {#if isSlides}
          <div class="spec-row">
            <span class="spec-label">Slides</span>
            <span class="spec-value spec-mono">{project.outline?.length ?? (project.pages.length || "Auto")}</span>
          </div>
        {:else}
          <div class="spec-row">
            <span class="spec-label">{OUTPUT_LABELS[project.settings.output]}</span>
            <span class="spec-value spec-mono">{project.pages.length} {project.pages.length === 1 ? "page" : "pages"}</span>
          </div>
        {/if}
        <div class="spec-row">
          <span class="spec-label">Canvas</span>
          <span class="spec-value">
            <span class="spec-mono">{formatDimensions(project.settings)}</span>
            {#if ratio}<span class="spec-chip">{ratio}</span>{/if}
          </span>
        </div>
        <button class="spec-row spec-row-edit" type="button" title="Edit in Design" onclick={openDesign}>
          <span class="spec-label">Style</span>
          <span class="spec-value">
            {STYLE_LABELS[project.settings.style]}
            <Icon name="pencil" size={11} />
          </span>
        </button>
        <button class="spec-row spec-row-edit" type="button" title="Edit in Design" onclick={openDesign}>
          <span class="spec-label">Density</span>
          <span class="spec-value">
            {DENSITY_LABELS[project.settings.density]}
            <Icon name="pencil" size={11} />
          </span>
        </button>
      </div>
    </div>

    <div class="save-status" class:save-error={projectStore.saveStatus === "error"} role="status">
      {#if projectStore.saveStatus === "saving"}
        <span class="spinner"></span>
        Saving…
      {:else if projectStore.saveStatus === "error"}
        <Icon name="alert" size={13} />
        Save failed
      {:else}
        <Icon name="check" size={13} />
        All changes saved
      {/if}
    </div>
  {/if}
</aside>

<style>
  .chat-info-panel {
    display: flex;
    width: 264px;
    flex-shrink: 0;
    flex-direction: column;
    gap: 20px;
    overflow-y: auto;
    padding: 20px 18px 16px;
    border-right: 1px solid var(--border);
  }
  .info-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .info-eyebrow {
    font: 700 10px var(--font-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .name-field {
    position: relative;
  }
  .name-field :global(svg) {
    position: absolute;
    top: 50%;
    right: 8px;
    color: var(--muted);
    opacity: 0;
    transform: translateY(-50%);
    transition: opacity 0.14s;
    pointer-events: none;
  }
  .name-field:hover :global(svg),
  .name-field:focus-within :global(svg) {
    opacity: 1;
  }
  .chat-info-title {
    width: 100%;
    padding: 5px 26px 5px 2px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font: 600 16px/1.3 var(--font-display);
    cursor: text;
  }
  .chat-info-title:hover {
    background: var(--surface-2);
  }
  .chat-info-title:focus {
    border-color: var(--accent);
    background: var(--surface);
    outline: none;
  }
  .chat-info-brief {
    min-height: 96px;
    padding: 9px 11px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font-size: 12.5px;
    line-height: 1.6;
    resize: vertical;
  }
  .chat-info-brief:focus {
    border-color: var(--accent);
    outline: none;
  }
  .spec-card {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    overflow: hidden;
  }
  .spec-row {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 38px;
    padding: 0 12px;
    border: 0;
    font: inherit;
    text-align: right;
  }
  .spec-row + .spec-row {
    border-top: 1px solid var(--border);
  }
  .spec-label {
    flex-shrink: 0;
    color: var(--muted);
    font-size: 11.5px;
    font-weight: 600;
  }
  .spec-value {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .spec-mono {
    font: 600 12px var(--font-mono);
  }
  .spec-chip {
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--muted);
    font: 500 10px var(--font-mono);
  }
  .spec-row-edit {
    cursor: pointer;
    background: transparent;
    transition: background 0.14s;
  }
  .spec-row-edit:hover {
    background: var(--surface-2);
  }
  .spec-row-edit :global(svg) {
    color: var(--muted);
    opacity: 0;
    transition: opacity 0.14s;
  }
  .spec-row-edit:hover :global(svg),
  .spec-row-edit:focus-visible :global(svg) {
    opacity: 1;
  }
  .spec-row-edit:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .save-status {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: auto;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 11.5px;
  }
  .save-status :global(svg) {
    flex-shrink: 0;
  }
  .save-status .spinner {
    width: 11px;
    height: 11px;
    color: var(--muted);
  }
  .save-status.save-error {
    color: var(--danger);
  }
</style>
