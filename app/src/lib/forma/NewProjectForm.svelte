<script lang="ts">
  import DesignSettingsForm from "./DesignSettingsForm.svelte";
  import Icon from "../components/Icon.svelte";
  import PageIcon from "./PageIcon.svelte";
  import ConnectionCard from "./ConnectionCard.svelte";
  import { defaultProjectSettings } from "./defaults";
  import { projectStore } from "./projectStore.svelte";
  import { pickFiles } from "../rig/native";
  import type { OutputKind, ProjectSettings } from "./types";

  let name = $state("");
  let prompt = $state("");
  let kind = $state<OutputKind>("slides");
  let settings = $state<ProjectSettings>(defaultProjectSettings("slides"));
  let staged = $state<Array<{ path: string; name: string }>>([]);
  let stagedOpen = $state(false);
  let assetsEl = $state<HTMLElement | null>(null);
  let creating = $state(false);
  let error = $state("");

  function setKind(next: OutputKind): void {
    kind = next;
    settings = { ...settings, output: next };
  }

  async function addAssets(): Promise<void> {
    const paths = await pickFiles("Add reference images and documents");
    let added = false;
    for (const path of paths) {
      if (staged.some((item) => item.path === path)) continue;
      staged = [...staged, { path, name: path.split(/[\\/]/).pop() ?? path }];
      added = true;
    }
    if (added) stagedOpen = true;
  }

  function removeStaged(path: string): void {
    staged = staged.filter((item) => item.path !== path);
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!stagedOpen) return;
    if (assetsEl && event.target instanceof Node && assetsEl.contains(event.target)) return;
    stagedOpen = false;
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") stagedOpen = false;
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
      if (staged.length > 0) {
        await projectStore.importContext(
          staged.map((item) => item.path),
          "optional",
        );
      }
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

      <div class="start-assets" bind:this={assetsEl}>
        <button class="btn btn-ghost" type="button" onclick={() => void addAssets()}>
          <Icon name="plus" size={14} /> Attach files
        </button>
        {#if staged.length > 0}
          <button
            class="btn btn-ghost staged-toggle"
            type="button"
            aria-expanded={stagedOpen}
            title="Show attached files"
            onclick={() => (stagedOpen = !stagedOpen)}
          >
            <Icon name="file" size={12} /> {staged.length} attached
          </button>
        {/if}
        {#if stagedOpen && staged.length > 0}
          <ul class="staged-list">
            {#each staged as item (item.path)}
              <li>
                <Icon name="file" size={12} />
                <span class="staged-name" title={item.path}>{item.name}</span>
                <button class="icon-btn" type="button" title="Remove" aria-label="Remove {item.name}" onclick={() => removeStaged(item.path)}>
                  <Icon name="x" size={12} />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

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

      <DesignSettingsForm
        {settings}
        onchange={(next) => (settings = next)}
        exaConfigured={projectStore.searchCredentials.exa.configured}
        pexelsConfigured={projectStore.searchCredentials.pexels.configured}
        openSearchSettings={() => window.dispatchEvent(new CustomEvent("forma:open-search-settings"))}
      />

    </section>
  </div>
</form>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />
