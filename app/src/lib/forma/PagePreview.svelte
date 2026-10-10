<script lang="ts">
  import { projectStore } from "./projectStore.svelte";
  import { effectiveSize } from "../../../../src/projects/size.ts";

  let {
    pageId,
    mode = "main",
  }: { pageId: string; mode?: "main" | "thumb" } = $props();

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);
  const html = $derived(projectStore.composed[pageId]?.html ?? null);

  let width = $state(0);
  let height = $state(0);

  $effect(() => {
    void projectStore.composePage(pageId);
  });

  const scale = $derived.by(() => {
    if (!size) return 1;
    if (mode === "thumb") {
      if (!width || !height) return 0;
      return Math.min(width / size.width, height / size.height);
    }
    const zoom = projectStore.zoom;
    if (zoom !== "fit") return zoom / 100;
    if (!width || !height) return 0;
    return Math.min(width / size.width, height / size.height);
  });

  const framedWidth = $derived(size ? size.width * scale : 0);
  const framedHeight = $derived(size ? size.height * scale : 0);
</script>

{#if size && mode === "thumb"}
  <div
    class="page-thumb-frame"
    style={`--thumb-ratio:${size.width}/${size.height};`}
    bind:clientWidth={width}
    bind:clientHeight={height}
  >
    {#if html}
      <iframe
        class="page-frame"
        style={`width:${size.width}px;height:${size.height}px;transform:scale(${scale});`}
        srcdoc={html}
        sandbox=""
        tabindex="-1"
        aria-hidden="true"
        title="Slide thumbnail"
      ></iframe>
    {:else}
      <span class="page-thumb-empty"></span>
    {/if}
  </div>
{:else if size}
  <div class="preview-stage" bind:clientWidth={width} bind:clientHeight={height}>
    {#if html}
      <div class="preview-frame-wrap" style={`width:${framedWidth}px;height:${framedHeight}px;`}>
        <iframe
          class="page-frame"
          style={`width:${size.width}px;height:${size.height}px;transform:scale(${scale});`}
          srcdoc={html}
          sandbox=""
          tabindex="-1"
          title="Artwork preview"
        ></iframe>
      </div>
    {:else}
      <div class="preview-loading"><span class="spinner"></span> Rendering…</div>
    {/if}
  </div>
{/if}
