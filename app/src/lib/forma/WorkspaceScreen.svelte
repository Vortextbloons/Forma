<script lang="ts">
  import ProjectHeader from "./ProjectHeader.svelte";
  import ThumbnailRail from "./ThumbnailRail.svelte";
  import ProjectMain from "./ProjectMain.svelte";
  import RightPanel from "./RightPanel.svelte";
  import ChatInfoPanel from "./ChatInfoPanel.svelte";
  import ExportDialog from "./ExportDialog.svelte";
  import { projectStore } from "./projectStore.svelte";

  let { onOpenSettings, onCloseProject }: { onOpenSettings: () => void; onCloseProject: () => void } = $props();

  let previewOpen = $state(false);
  let showExport = $state(false);

  const pages = $derived(projectStore.current?.project.pages ?? []);
  const isSlides = $derived(projectStore.current?.project.settings.output === "slides");
</script>

<div class="forma-workspace chat-full" class:preview-open={previewOpen}>
  <ProjectHeader
    {onOpenSettings}
    {onCloseProject}
    onOpenExport={() => (showExport = true)}
    {previewOpen}
    onTogglePreview={() => (previewOpen = !previewOpen)}
  />
  <div class="workspace-body">
    {#if isSlides && pages.length > 0}
      <ThumbnailRail />
    {/if}
    <ProjectMain />
    {#if !previewOpen}
      <ChatInfoPanel />
    {/if}
    <RightPanel />
  </div>
</div>

{#if showExport}
  <ExportDialog onclose={() => (showExport = false)} />
{/if}
