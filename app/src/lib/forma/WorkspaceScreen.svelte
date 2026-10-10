<script lang="ts">
  import ProjectHeader from "./ProjectHeader.svelte";
  import ThumbnailRail from "./ThumbnailRail.svelte";
  import ProjectMain from "./ProjectMain.svelte";
  import RightPanel from "./RightPanel.svelte";
  import StatusBar from "./StatusBar.svelte";
  import ExportDialog from "./ExportDialog.svelte";
  import { projectStore } from "./projectStore.svelte";

  let { onOpenSettings, onCloseProject }: { onOpenSettings: () => void; onCloseProject: () => void } = $props();

  let windowWidth = $state(1440);
  let layout = $state<"full" | "side">("full");
  const effectiveLayout = $derived(windowWidth < 1100 ? "full" : layout);
  let previewOpen = $state(false);
  let showExport = $state(false);

  const pages = $derived(projectStore.current?.project.pages ?? []);
  const isSlides = $derived(projectStore.current?.project.settings.output === "slides");
</script>

<svelte:window bind:innerWidth={windowWidth} />

<div class="forma-workspace" class:chat-full={effectiveLayout === "full"} class:preview-open={previewOpen}>
  <ProjectHeader
    {onOpenSettings}
    {onCloseProject}
    onOpenExport={() => (showExport = true)}
    layout={effectiveLayout}
    compact={windowWidth < 1100}
    {previewOpen}
    onLayoutChange={(next) => { layout = next; previewOpen = false; }}
    onTogglePreview={() => (previewOpen = !previewOpen)}
  />
  <div class="workspace-body">
    {#if isSlides && pages.length > 0}
      <ThumbnailRail />
    {/if}
    <ProjectMain />
    <RightPanel />
  </div>
  <StatusBar />
</div>

{#if showExport}
  <ExportDialog onclose={() => (showExport = false)} />
{/if}
