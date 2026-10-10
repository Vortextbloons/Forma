<script lang="ts">
  import PageIcon from "./PageIcon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { DENSITY_LABELS, OUTPUT_LABELS, STYLE_LABELS, countLabel } from "./types";
  import { effectiveSize } from "../../../../src/projects/size.ts";
  import { sendCommand } from "../rig/bridge";
  import { messageStore } from "../rig/stores/messageStore.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";

  let { page = null }: { page: number | null } = $props();

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);
  const sessionId = $derived(sessionStore.activeSessionId);
  const generating = $derived.by(() => {
    const status = sessionStore.statusOf(sessionId);
    return status === "running" || status === "waiting" || status === "approval";
  });

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

  async function startGeneration(): Promise<void> {
    const current = project;
    if (!current || !sessionId || generating) return;
    const brief = promptDraft.trim();
    if (!brief) return;
    const ask =
      current.mode === "plan"
        ? `Draft the outline for this project based on the brief:\n\n${brief}`
        : `Create the ${current.settings.output === "poster" ? "poster" : "slides"} for this project from the brief:\n\n${brief}`;
    messageStore.addUserMessage(sessionId, ask);
    try {
      await sendCommand("prompt", { sessionId, prompt: ask }, { timeoutMs: 0 });
    } catch (err) {
      notificationStore.push({
        type: "error",
        sessionId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const actionLabel = $derived.by(() => {
    if (!project) return "";
    if (generating) return "Forma is working…";
    if (project.mode === "plan" && !project.outline) return "Draft the outline";
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
    if (page === null || !project) return "";
    return project.outline?.[page]?.title ?? "";
  });
</script>

<main class="project-main">
  {#if project && size && page !== null && page < project.pages.length}
    <section
      class="stage"
      style={`--page-ratio:${(size.width / size.height).toFixed(4)}`}
    >
      <div class="stage-page">
        <span class="stage-placeholder">
          <PageIcon width={size.width} height={size.height} size={28} />
          <strong>{project.settings.output === "poster" ? "Poster" : `Slide ${page + 1}`}</strong>
          <span>Artwork appears here as it is generated.</span>
        </span>
      </div>
      {#if project.settings.output === "slides"}
        <p class="stage-caption">
          Slide {page + 1} of {project.pages.length}{pageTitle ? ` · ${pageTitle}` : ""}
        </p>
      {/if}
    </section>
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
        disabled={generating || promptDraft.trim() === "" || sessionId === null}
        onclick={() => void startGeneration()}
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
