<script lang="ts">
  import type { Snippet } from "svelte";
  import ResizableDivider from "../components/ResizableDivider.svelte";
  import { layoutStore } from "../rig/stores/layoutStore.svelte";

  let {
    sidebar,
    main,
    right,
  }: {
    sidebar: Snippet;
    main: Snippet;
    right?: Snippet;
  } = $props();

  const showRight = $derived(layoutStore.showRightPanel && right !== undefined);
</script>

<div class="workspace">
  <div class="workspace-panel workspace-panel-left" style="width:{layoutStore.sidebarWidth}px;flex-shrink:0">
    {@render sidebar()}
  </div>
  <ResizableDivider
    axis="x"
    ariaLabel="Resize sidebar"
    onDelta={(delta) => layoutStore.setSidebarWidth(layoutStore.sidebarWidth + delta)}
  />
  <main class="workspace-main">
    {@render main()}
  </main>
  {#if showRight}
    <ResizableDivider
      axis="x"
      ariaLabel="Resize activity panel"
      onDelta={(delta) => layoutStore.setRightPanelWidth(layoutStore.rightPanelWidth - delta)}
    />
    <div class="workspace-panel workspace-panel-right" style="width:{layoutStore.rightPanelWidth}px;flex-shrink:0">
      {@render right!()}
    </div>
  {/if}
</div>
