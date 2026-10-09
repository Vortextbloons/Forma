<script lang="ts">
  import DesignSettingsForm from "./DesignSettingsForm.svelte";
  import Icon from "../components/Icon.svelte";
  import { defaultProjectSettings } from "./defaults";
  import { projectStore } from "./projectStore.svelte";
  import { pickDirectory, pickFiles } from "../rig/native";
  import type { OutputKind, ProjectSettings } from "./types";

  let prompt = $state("");
  let kind = $state<OutputKind>("slides");
  let mode = $state<"plan" | "create">("plan");
  let settings = $state<ProjectSettings>(defaultProjectSettings("slides"));
  let folder = $state("");
  let staged = $state<Array<{ path: string; name: string }>>([]);
  let showSettings = $state(false);
  let creating = $state(false);
  let error = $state("");

  function setKind(next: OutputKind): void {
    kind = next;
    settings = { ...settings, output: next };
  }

  async function chooseFolder(): Promise<void> {
    const chosen = await pickDirectory("Choose the project folder");
    if (chosen) folder = chosen;
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
    if (!folder) {
      await chooseFolder();
      if (!folder) {
        error = "Choose a project folder first.";
        return;
      }
    }
    creating = true;
    try {
      await projectStore.createProject({
        dir: folder,
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
  <h2 class="panel-title">New project</h2>

  <div class="field">
    <label class="field-label" for="project-prompt">What do you want to create?</label>
    <textarea
      id="project-prompt"
      class="textarea prompt-input"
      rows="4"
      placeholder="A 10-slide review of our Q3 results for the leadership team…"
      bind:value={prompt}
    ></textarea>
  </div>

  <div class="field-row">
    <div class="field">
      <span class="field-label">Output</span>
      <div class="segmented" role="group" aria-label="Output">
        <button type="button" class:active={kind === "slides"} aria-pressed={kind === "slides"} onclick={() => setKind("slides")}>
          <Icon name="panel-bottom" size={13} /> Slides
        </button>
        <button type="button" class:active={kind === "poster"} aria-pressed={kind === "poster"} onclick={() => setKind("poster")}>
          <Icon name="file" size={13} /> Poster
        </button>
      </div>
    </div>
    <div class="field">
      <span class="field-label">Start with</span>
      <div class="segmented" role="group" aria-label="Start mode">
        <button type="button" class:active={mode === "plan"} aria-pressed={mode === "plan"} onclick={() => (mode = "plan")}>
          Plan
        </button>
        <button type="button" class:active={mode === "create"} aria-pressed={mode === "create"} onclick={() => (mode = "create")}>
          Create
        </button>
      </div>
    </div>
  </div>

  <p class="mode-hint">
    {mode === "plan"
      ? "Forma proposes an outline first. Edit it, then generate."
      : "Forma creates the artwork directly from your brief."}
  </p>

  <div class="field">
    <span class="field-label">Project folder</span>
    <div class="field-row">
      <button class="btn" type="button" onclick={() => void chooseFolder()}>
        <Icon name="folder" size={13} /> Choose…
      </button>
      <span class="folder-path" title={folder}>{folder || "No folder chosen"}</span>
    </div>
  </div>

  <div class="field">
    <span class="field-label">Assets</span>
    <button class="btn" type="button" onclick={() => void addAssets()}>
      <Icon name="plus" size={13} /> Add files
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

  <details class="settings-disclosure" bind:open={showSettings}>
    <summary>
      <Icon name={showSettings ? "chevron-down" : "chevron-right"} size={13} />
      Design settings
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
