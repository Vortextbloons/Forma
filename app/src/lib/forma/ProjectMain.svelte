<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import OutlineEditor from "./OutlineEditor.svelte";
  import PagePreview from "./PagePreview.svelte";
  import PageIcon from "./PageIcon.svelte";
  import { projectStore } from "./projectStore.svelte";
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

  let nameDraft = $state("");
  let promptDraft = $state("");
  let loadedDir = "";

  $effect(() => {
    const snapshot = projectStore.current;
    if (snapshot && snapshot.dir !== loadedDir) {
      loadedDir = snapshot.dir;
      nameDraft = snapshot.project.name;
      promptDraft = snapshot.project.prompt;
    }
  });

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

  function setMode(mode: "plan" | "create"): void {
    if (project && mode !== project.mode) {
      projectStore.updateBrief({ mode });
    }
  }

  function start(): void {
    if (!project || generating) return;
    if (project.mode === "plan") void projectStore.plan();
    else void projectStore.generate();
  }

  const actionLabel = $derived.by(() => {
    if (!project) return "";
    if (generating) return "Forma is working…";
    if (project.mode === "plan") return "Draft the outline";
    return project.settings.output === "poster" ? "Create the poster" : "Create the slides";
  });

  const meta = $derived.by(() => {
    if (!project) return "";
    const settings = project.settings;
    const parts = [
      STYLE_LABELS[settings.style],
      DENSITY_LABELS[settings.density],
      settings.output === "slides"
        ? `${settings.slideCount} slides`
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
</script>

<main class="project-main">
  {#if project && size && pages.length > 0 && selectedPageId && selectedIndex >= 0}
    <section class="stage" style={`--page-ratio:${(size.width / size.height).toFixed(4)}`}>
      <PagePreview pageId={selectedPageId} />
      {#if project.settings.output === "slides"}
        <p class="stage-caption">
          Slide {selectedIndex + 1} of {pages.length}{pageTitle ? ` · ${pageTitle}` : ""}
        </p>
      {/if}
    </section>

    {#if projectStore.needsImageModel}
      <div class="stage-banner">
        <Icon name="alert" size={14} />
        <span>The selected model cannot read the image references in this project.</span>
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

      <div class="mode-choices" role="radiogroup" aria-label="How to work">
        <button
          type="button"
          class="mode-choice"
          class:active={project.mode === "plan"}
          role="radio"
          aria-checked={project.mode === "plan"}
          onclick={() => setMode("plan")}
        >
          <span class="mode-dot" aria-hidden="true"></span>
          <span class="mode-text">
            <strong>Plan first</strong>
            <span>Propose an outline to edit before any artwork.</span>
          </span>
        </button>
        <button
          type="button"
          class="mode-choice"
          class:active={project.mode === "create"}
          role="radio"
          aria-checked={project.mode === "create"}
          onclick={() => setMode("create")}
        >
          <span class="mode-dot" aria-hidden="true"></span>
          <span class="mode-text">
            <strong>Create directly</strong>
            <span>Make the artwork straight from the brief.</span>
          </span>
        </button>
      </div>

      <p class="brief-summary muted small">{meta}</p>

      <button
        class="btn btn-accent brief-action"
        type="button"
        disabled={generating || promptDraft.trim() === ""}
        onclick={start}
      >
        {#if generating}
          <span class="spinner"></span>
        {/if}
        {actionLabel}
      </button>
      <p class="brief-hint muted small">Forma works in the chat beside you — follow along and refine there.</p>
    </section>
  {/if}
</main>
