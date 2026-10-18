<script lang="ts">
  import ProjectHeader from "./ProjectHeader.svelte";
  import ThumbnailRail from "./ThumbnailRail.svelte";
  import ProjectMain from "./ProjectMain.svelte";
  import RightPanel from "./RightPanel.svelte";
  import ChatInfoPanel from "./ChatInfoPanel.svelte";
  import ElementInspector from "./ElementInspector.svelte";
  import ExportDialog from "./ExportDialog.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { editStore } from "./editStore.svelte";

  let { onOpenSettings, onCloseProject }: { onOpenSettings: () => void; onCloseProject: () => void } = $props();

  let previewOpen = $state(false);
  let showExport = $state(false);

  const pages = $derived(projectStore.current?.project.pages ?? []);
  const isSlides = $derived(projectStore.current?.project.settings.output === "slides");
  const editMode = $derived(editStore.editMode);

  async function togglePreview(): Promise<void> {
    if (previewOpen && editStore.editMode) {
      const saved = await editStore.exit();
      if (!saved) return;
    }
    previewOpen = !previewOpen;
  }
</script>

<div class="forma-workspace chat-full" class:preview-open={previewOpen}>
  <ProjectHeader
    {onOpenSettings}
    {onCloseProject}
    onOpenExport={() => (showExport = true)}
    {previewOpen}
    onTogglePreview={() => void togglePreview()}
  />
  <div class="workspace-body">
    {#if isSlides && pages.length > 0}
      <ThumbnailRail />
    {/if}
    <ProjectMain />
    {#if !previewOpen}
      <ChatInfoPanel />
    {/if}
    {#if editMode}
      <ElementInspector />
    {:else}
      <RightPanel />
    {/if}
  </div>
</div>

{#if showExport}
  <ExportDialog onclose={() => (showExport = false)} />
{/if}
