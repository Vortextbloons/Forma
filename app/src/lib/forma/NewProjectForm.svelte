<script lang="ts">
  import DesignSettingsForm from "./DesignSettingsForm.svelte";
  import DesignProfileForm from "./DesignProfileForm.svelte";
  import DesignMashup from "./DesignMashup.svelte";
  import Icon from "../components/Icon.svelte";
  import PageIcon from "./PageIcon.svelte";
  import ConnectionCard from "./ConnectionCard.svelte";
  import { defaultProjectSettings } from "./defaults";
  import { defaultDesignProfile } from "../../../../src/projects/design.ts";
  import { projectStore } from "./projectStore.svelte";
  import type { OutputKind, ProjectSettings } from "./types";

  let { onOpenLibrary }: { onOpenLibrary: () => void } = $props();

  let name = $state("");
  let prompt = $state("");
  let kind = $state<OutputKind>("slides");
  let settings = $state<ProjectSettings>(defaultProjectSettings("slides"));
  let creating = $state(false);
  let error = $state("");
  let showOptions = $state(false);
  let showPalette = $state(false);

  const profile = $derived(settings.designProfile ?? defaultDesignProfile());
  const designLabel = $derived(settings.designApproved ? settings.designName : "AI chooses");

  function setKind(next: OutputKind): void {
    kind = next;
    settings = { ...settings, output: next };
  }

  async function submit(): Promise<void> {
    if (creating) return;
    error = "";
    if (!name.trim() || !prompt.trim()) {
      error = "Add a project title and a brief overview.";
      return;
    }
    creating = true;
    try {
      await projectStore.createProject({
        name: name.trim(),
        prompt: prompt.trim(),
        mode: "create",
        settings,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      creating = false;
    }
  }
</script>

<form class="new-project" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
  <div class="creation-heading">
    <span class="creation-kicker">YOUR NEXT IDEA</span>
    <h1 class="start-prompt">Give it shape.</h1>
    <p class="muted">Start with a brief. Build right away or make a plan first.</p>
  </div>
  <div class="creation-grid">
    <section class="creation-brief" aria-label="Project brief">
      <label class="field">
        <span class="field-label">Project title</span>
        <input class="input start-title" placeholder="e.g. The next chapter" bind:value={name} required />
      </label>
      <label class="field">
        <span class="field-label">Overview</span>
        <textarea class="textarea start-brief" rows="3" placeholder="What are we making, who is it for, and what should it say?" bind:value={prompt} required></textarea>
      </label>

      <ConnectionCard />

      {#if error}
        <p class="error-text">{error}</p>
      {/if}

      <button class="btn btn-accent create-button" type="submit" disabled={creating}>
        {#if creating}
          <span class="spinner"></span> Creating…
        {:else}
          Create project <Icon name="chevron-right" size={15} />
        {/if}
      </button>
      <button class="btn open-button" type="button" onclick={onOpenLibrary}>
        <Icon name="folder" size={14} /> Open project
      </button>
      <p class="creation-note muted small">Nothing builds until you ask. Planning is optional.</p>
    </section>
    <section class="creation-controls" aria-label="Project options">
      <div class="field">
        <span class="field-label">Format</span>
        <div class="format-tiles" role="group" aria-label="Output format">
          <button
            type="button"
            class="format-tile"
            class:active={kind === "slides"}
            aria-pressed={kind === "slides"}
            onclick={() => setKind("slides")}
          >
            <span class="format-shape"><PageIcon width={1920} height={1080} size={40} /></span>
            <span class="format-name">Slides</span>
            <em>A story, one slide at a time</em>
          </button>
          <button
            type="button"
            class="format-tile"
            class:active={kind === "poster"}
            aria-pressed={kind === "poster"}
            onclick={() => setKind("poster")}
          >
            <span class="format-shape"><PageIcon width={1080} height={1350} size={40} /></span>
            <span class="format-name">Poster</span>
            <em>One composition. A clear message.</em>
          </button>
        </div>
      </div>

      <DesignSettingsForm section="chooser" {settings} onchange={(next) => (settings = next)} />

      <div class="field">
        <span class="field-label">Design</span>
        <button class="palette-entry" type="button" aria-haspopup="dialog" onclick={() => (showPalette = true)}>
          <DesignMashup {profile} height={28} width={64} />
          <span class="palette-entry-name">{designLabel}</span>
          <Icon name="chevron-right" size={14} />
        </button>
      </div>

      <button class="btn options-button" type="button" onclick={() => (showOptions = true)}>
        <Icon name="gear" size={14} /> More options
      </button>

    </section>
  </div>
</form>

{#if showOptions}
  <div
    class="modal-overlay"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) showOptions = false;
    }}
  >
    <div class="modal options-modal" role="dialog" aria-modal="true" aria-label="Design options" tabindex="-1">
      <div class="modal-head">
        <span class="modal-title">Design options</span>
        <button class="icon-btn" type="button" title="Close" aria-label="Close design options" onclick={() => (showOptions = false)}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div class="modal-body options-modal-body">
        <DesignSettingsForm section="editor" {settings} onchange={(next) => (settings = next)} />
        <DesignProfileForm section="editor" {settings} onchange={(next) => (settings = next)} disabled={creating} />
      </div>
    </div>
  </div>
{/if}

{#if showPalette}
  <div
    class="modal-overlay"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) showPalette = false;
    }}
  >
    <div class="modal options-modal" role="dialog" aria-modal="true" aria-label="Design palette" tabindex="-1">
      <div class="modal-head">
        <span class="modal-title">Design palette</span>
        <button class="icon-btn" type="button" title="Close" aria-label="Close design palette" onclick={() => (showPalette = false)}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div class="modal-body options-modal-body">
        <DesignProfileForm section="full" {settings} onchange={(next) => (settings = next)} disabled={creating} />
      </div>
    </div>
  </div>
{/if}

<svelte:window onkeydown={(event) => { if (event.key === "Escape") { showOptions = false; showPalette = false; } }} />

<style>
  .options-modal-body {
    flex-direction: column;
  }
  .palette-entry {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-2);
    cursor: pointer;
    text-align: left;
    transition: background .14s, border-color .14s;
  }
  .palette-entry:hover {
    background: var(--surface-3);
    border-color: var(--border-strong);
  }
  .palette-entry-name {
    flex: 1;
    color: var(--text);
    font-size: 13px;
    font-weight: 650;
  }
</style>
