<script lang="ts">
  import DesignSettingsForm from "./DesignSettingsForm.svelte";
  import DesignProfileForm from "./DesignProfileForm.svelte";
  import PageIcon from "./PageIcon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { OUTPUT_LABELS } from "./types";
  import { formatDimensions } from "./sizes";
  import { effectiveSize } from "../../../../src/projects/size.ts";

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);
  const run = $derived(projectStore.run);

</script>

<div class="design-panel">
  {#if project && size}
    <div class="output-chip">
      <PageIcon width={size.width} height={size.height} size={16} />
      <span>{OUTPUT_LABELS[project.settings.output]}</span>
      <span class="muted">·</span>
      <span class="muted">{formatDimensions(project.settings)}</span>
    </div>
    <label class="field">
      <span class="field-label">Project title</span>
      <input class="input" value={project.name} aria-label="Project title" onchange={(event) => { const name = event.currentTarget.value.trim(); if (name) projectStore.updateBrief({ name }); }} />
    </label>
    <label class="field">
      <span class="field-label">Overview</span>
      <textarea class="input textarea" rows="4" value={project.prompt} oninput={(event) => projectStore.updateBrief({ prompt: event.currentTarget.value })}></textarea>
    </label>
    <DesignSettingsForm
      settings={project.settings}
      onchange={(next) => projectStore.updateSettings(next)}
    />
    <DesignProfileForm
      settings={project.settings}
      onchange={(next) => projectStore.updateSettings(next)}
      disabled={run !== null}
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
      Changes are saved automatically. Shared palette and typography update pages
      that use the profile. Apply to artwork to adapt existing layouts and styles.
    </p>
  {/if}
</div>
