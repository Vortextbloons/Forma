<script lang="ts">
  import DesignSettingsForm from "./DesignSettingsForm.svelte";
  import PageIcon from "./PageIcon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { OUTPUT_LABELS } from "./types";
  import { formatDimensions } from "./sizes";
  import { effectiveSize } from "../../../../src/projects/size.ts";

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);
  const run = $derived(projectStore.run);
  const credentials = $derived(projectStore.searchCredentials);

  function openSearchSettings(): void {
    window.dispatchEvent(new CustomEvent("forma:open-search-settings"));
  }
</script>

<div class="design-panel">
  {#if project && size}
    <div class="output-chip">
      <PageIcon width={size.width} height={size.height} size={16} />
      <span>{OUTPUT_LABELS[project.settings.output]}</span>
      <span class="muted">·</span>
      <span class="muted">{formatDimensions(project.settings)}</span>
    </div>
    <DesignSettingsForm
      settings={project.settings}
      onchange={(next) => projectStore.updateSettings(next)}
      exaConfigured={credentials.exa.configured}
      pexelsConfigured={credentials.pexels.configured}
      {openSearchSettings}
    />
    {#if projectStore.needsDesignApply}
      <div class="design-apply">
        <p class="small">Design settings changed since the artwork was made.</p>
        <button
          class="btn btn-accent block"
          type="button"
          disabled={run !== null}
          onclick={() => void projectStore.applyDesign()}
        >Apply to artwork</button>
      </div>
    {/if}
    <p class="muted small">
      Changes are saved automatically. Artwork changes only when you generate,
      refine, or apply design settings.
    </p>
  {/if}
</div>
