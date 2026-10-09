<script lang="ts">
  import DesignSettingsForm from "./DesignSettingsForm.svelte";
  import PageIcon from "./PageIcon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { OUTPUT_LABELS } from "./types";
  import { formatDimensions } from "./sizes";
  import { effectiveSize } from "../../../../src/projects/size.ts";

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);
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
    />
    <p class="muted small">
      Changes are saved automatically and apply the next time artwork is
      generated or refined.
    </p>
  {/if}
</div>
