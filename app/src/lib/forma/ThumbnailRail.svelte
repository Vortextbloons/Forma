<script lang="ts">
  import PageIcon from "./PageIcon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { effectiveSize } from "../../../../src/projects/size.ts";

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);
</script>

<aside class="thumbnail-rail" aria-label="Slides">
  <div class="rail-head">
    <span>Slides</span>
    <span class="rail-count">{project?.pages.length ?? 0}</span>
  </div>
  <div class="rail-body">
    {#if !project || project.pages.length === 0}
      <div class="rail-empty">
        {#if size}
          <PageIcon width={size.width} height={size.height} size={26} />
        {/if}
        <p>No slides yet</p>
        <span>Slides appear here once the outline is generated.</span>
      </div>
    {/if}
  </div>
</aside>
