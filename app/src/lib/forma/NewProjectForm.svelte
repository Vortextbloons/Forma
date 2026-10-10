<script lang="ts">
  import DesignSettingsForm from "./DesignSettingsForm.svelte";
  import Icon from "../components/Icon.svelte";
  import PageIcon from "./PageIcon.svelte";
  import ConnectionCard from "./ConnectionCard.svelte";
  import { defaultProjectSettings } from "./defaults";
  import { projectStore } from "./projectStore.svelte";
  import { pickFiles } from "../rig/native";
  import type { OutputKind, ProjectSettings } from "./types";

  let prompt = $state("");
  let kind = $state<OutputKind>("slides");
  let mode = $state<"plan" | "create">("plan");
  let settings = $state<ProjectSettings>(defaultProjectSettings("slides"));
  let staged = $state<Array<{ path: string; name: string }>>([]);
  let showSettings = $state(false);
  let creating = $state(false);
  let error = $state("");

  function setKind(next: OutputKind): void {
    kind = next;
    settings = { ...settings, output: next };
  }

  async function addAssets(): Promise<void> {
    const paths = await pickFiles("Add assets and context");
    for (const path of paths) {
      if (staged.some((item) => item.path === path)) continue;
      staged = [...staged, { path, name: path.split(/[\\/]/).pop() ?? path }];
    }
  }

  function removeStaged(path: string): void {
    staged = staged.filter((item) => item.path !== path);
  }

  async function submit(): Promise<void> {
    if (creating) return;
    error = "";
    if (prompt.trim() === "") {
      error = "Describe what you want to create.";
      return;
    }
    creating = true;
    try {
      await projectStore.createProject({
        prompt: prompt.trim(),
        mode,
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
  <h1 class="start-prompt">What are we making?</h1>

  <textarea
    class="textarea start-brief"
    rows="3"
    placeholder="A 10-slide review of our Q3 results for the leadership team, or a poster for Saturday's show…"
    bind:value={prompt}
  ></textarea>

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
        <em>16:9 · 1920 × 1080</em>
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
        <em>Portrait · 1080 × 1350</em>
      </button>
    </div>
  </div>

  <div class="mode-choices" role="radiogroup" aria-label="How to start">
    <button
      type="button"
      class="mode-choice"
      class:active={mode === "plan"}
      role="radio"
      aria-checked={mode === "plan"}
      onclick={() => (mode = "plan")}
    >
      <span class="mode-dot" aria-hidden="true"></span>
      <span class="mode-text">
        <strong>Plan first</strong>
        <span>Forma proposes an outline. Edit it, then generate.</span>
      </span>
    </button>
    <button
      type="button"
      class="mode-choice"
      class:active={mode === "create"}
      role="radio"
      aria-checked={mode === "create"}
      onclick={() => (mode = "create")}
    >
      <span class="mode-dot" aria-hidden="true"></span>
      <span class="mode-text">
        <strong>Create directly</strong>
        <span>Forma makes the artwork straight from the brief.</span>
      </span>
    </button>
  </div>

  <div class="start-assets">
    <button class="btn btn-ghost" type="button" onclick={() => void addAssets()}>
      <Icon name="plus" size={14} /> Attach files
    </button>
    {#if staged.length > 0}
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

  <details class="settings-disclosure" bind:open={showSettings}>
    <summary>
      <Icon name={showSettings ? "chevron-down" : "chevron-right"} size={13} />
      Style &amp; density
    </summary>
    <DesignSettingsForm {settings} onchange={(next) => (settings = next)} />
  </details>

  {#if error}
    <p class="error-text">{error}</p>
  {/if}

  <button class="btn btn-accent create-button" type="submit" disabled={creating}>
    {#if creating}
      <span class="spinner"></span> Creating…
    {:else}
      Create project
    {/if}
  </button>
</form>
