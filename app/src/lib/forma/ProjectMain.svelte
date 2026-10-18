<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import OutlineEditor from "./OutlineEditor.svelte";
  import PagePreview from "./PagePreview.svelte";
  import EditCanvas from "./EditCanvas.svelte";
  import PageIcon from "./PageIcon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { editStore } from "./editStore.svelte";
  import { DENSITY_LABELS, OUTPUT_LABELS, STYLE_LABELS, countLabel } from "./types";
  import { effectiveSize } from "../../../../src/projects/size.ts";

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);
  const pages = $derived(project?.pages ?? []);
  const selectedPageId = $derived(projectStore.selectedPageId);
  const selectedIndex = $derived(
    selectedPageId ? pages.indexOf(selectedPageId) : -1,
  );
  const hasOutline = $derived((project?.outline?.length ?? 0) > 0);
  const run = $derived(projectStore.run);
  const generating = $derived(run !== null);
  const editMode = $derived(editStore.editMode);

  let nameDraft = $derived(project?.name ?? "");
  let promptDraft = $derived(project?.prompt ?? "");

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

  const meta = $derived.by(() => {
    if (!project) return "";
    const settings = project.settings;
    const parts = [
      STYLE_LABELS[settings.style],
      DENSITY_LABELS[settings.density],
      settings.output === "slides"
        ? ((project.outline?.length ?? project.pages.length) > 0 ? `${project.outline?.length ?? project.pages.length} slides` : "Slides")
        : settings.posterKind === "digital"
          ? "Digital poster"
          : "Print poster",
    ];
    if (project.context.length > 0) parts.push(countLabel(project.context.length, "context item"));
    return parts.join(" · ");
  });

  const pageTitle = $derived.by(() => {
    if (!selectedPageId || !project) return "";
    return project.pageMeta[selectedPageId]?.title ?? "";
  });

  let wheelAccum = 0;
  let wheelLocked = false;
  let wheelTimeout: ReturnType<typeof setTimeout> | undefined;

  function wheelStep(deltaY: number): void {
    if (project?.settings.output !== "slides" || pages.length < 2) return;
    if (!wheelLocked) {
      wheelAccum += deltaY;
      if (Math.abs(wheelAccum) >= 100) {
        const next = selectedIndex + (wheelAccum > 0 ? 1 : -1);
        if (next >= 0 && next < pages.length) void editStore.selectPage(pages[next]!);
        wheelLocked = true;
        wheelAccum = 0;
      }
    }
    clearTimeout(wheelTimeout);
    wheelTimeout = setTimeout(() => {
      wheelLocked = false;
      wheelAccum = 0;
    }, 200);
  }
</script>

<main class="project-main">
  {#if project && size && pages.length > 0 && selectedPageId && selectedIndex >= 0}
    <section class="stage" style={`--page-ratio:${(size.width / size.height).toFixed(4)}`}>
      <div class="stage-toolbar">
        <div class="mode-switch" role="group" aria-label="Artwork mode">
          <button type="button" class:active={!editMode} aria-pressed={!editMode} onclick={() => void editStore.exit()}>Preview</button>
          <button
            type="button"
            class:active={editMode}
            aria-pressed={editMode}
            disabled={generating || projectStore.exporting}
            onclick={() => void editStore.enter()}
          >Edit</button>
        </div>
        <span class="spacer"></span>
        {#if editMode}
          <button class="icon-btn" type="button" title="Undo" aria-label="Undo" disabled={!editStore.canUndo() || editStore.paused} onclick={() => editStore.undo()}>
            <Icon name="undo" size={16} />
          </button>
          <button class="icon-btn" type="button" title="Redo" aria-label="Redo" disabled={!editStore.canRedo() || editStore.paused} onclick={() => editStore.redo()}>
            <Icon name="redo" size={16} />
          </button>
        {/if}
      </div>
      {#if editMode}
        {#key selectedPageId}
          <EditCanvas pageId={selectedPageId} onwheel={wheelStep} />
        {/key}
      {:else}
        <PagePreview pageId={selectedPageId} onwheel={wheelStep} />
      {/if}
      {#if project.settings.output === "slides"}
        <div class="stage-navigation">
          <button class="icon-btn" type="button" aria-label="Previous slide" title="Previous slide" disabled={selectedIndex === 0} onclick={() => void editStore.selectPage(pages[selectedIndex - 1]!)}>
            <Icon name="arrow-left" size={16} />
          </button>
          <p class="stage-caption">
            Slide {selectedIndex + 1} of {pages.length}{pageTitle ? ` · ${pageTitle}` : ""}
          </p>
          <button class="icon-btn" type="button" aria-label="Next slide" title="Next slide" disabled={selectedIndex === pages.length - 1} onclick={() => void editStore.selectPage(pages[selectedIndex + 1]!)}>
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
      {/if}
    </section>

    {#if projectStore.needsImageModel}
      <div class="stage-banner">
        <Icon name="alert" size={14} />
        <span>The selected model cannot read the images in this project.</span>
        <button
          class="btn btn-ghost"
          type="button"
          onclick={() => window.dispatchEvent(new CustomEvent("rig:open-provider-settings"))}
        >Choose a model</button>
      </div>
    {/if}
    {#if projectStore.needsDesignApply}
      <div class="stage-banner">
        <Icon name="message" size={14} />
        <span>Design settings changed since the artwork was made.</span>
        <button
          class="btn btn-ghost"
          type="button"
          disabled={generating}
          onclick={() => void projectStore.applyDesign()}
        >Apply to artwork</button>
      </div>
    {/if}
  {:else if project && hasOutline}
    <OutlineEditor />
  {:else if project && size}
    <section class="brief">
      <header class="brief-head">
        <PageIcon width={size.width} height={size.height} size={20} />
        <span class="brief-kicker">{OUTPUT_LABELS[project.settings.output]}</span>
      </header>

      <input
        class="brief-name"
        type="text"
        placeholder="Project name"
        bind:value={nameDraft}
        onblur={saveName}
        onkeydown={(event) => {
          if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
        }}
        aria-label="Project name"
      />

      <textarea
        class="brief-prompt"
        rows="5"
        placeholder="Describe what Forma should make — audience, tone, must-haves…"
        bind:value={promptDraft}
        oninput={savePrompt}
        aria-label="Project brief"
      ></textarea>

      <p class="brief-summary muted small">{meta}</p>

      <p class="brief-hint muted small">Open chat to plan the project or build from this brief.</p>
    </section>
  {/if}
</main>

<style>
  .stage-toolbar {
    display: flex;
    align-self: stretch;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .mode-switch {
    display: flex;
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }

  .mode-switch button {
    appearance: none;
    min-width: 72px;
    padding: 6px 12px;
    border: 0;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    line-height: 18px;
    color: var(--muted);
    background: transparent;
    cursor: pointer;
  }

  .mode-switch button:hover:not(:disabled):not(.active) {
    color: var(--text);
    background: var(--surface-2);
  }

  .mode-switch button.active {
    color: var(--accent-contrast);
    background: var(--accent);
    box-shadow: var(--shadow-1);
  }

  .mode-switch button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .mode-switch button:disabled:not(.active) {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
