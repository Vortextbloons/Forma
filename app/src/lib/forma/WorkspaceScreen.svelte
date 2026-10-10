<script lang="ts">
  import ProjectHeader from "./ProjectHeader.svelte";
  import ThumbnailRail from "./ThumbnailRail.svelte";
  import ProjectMain from "./ProjectMain.svelte";
  import RightPanel from "./RightPanel.svelte";
  import StatusBar from "./StatusBar.svelte";
  import { projectStore } from "./projectStore.svelte";

  let { onOpenSettings, onCloseProject }: { onOpenSettings: () => void; onCloseProject: () => void } = $props();

  let drawerOpen = $state(false);

  const pages = $derived(projectStore.current?.project.pages ?? []);
  const isSlides = $derived(projectStore.current?.project.settings.output === "slides");
</script>

<div class="forma-workspace">
  <ProjectHeader
    {onOpenSettings}
    {onCloseProject}
    drawerOpen={drawerOpen}
    onToggleDrawer={() => (drawerOpen = !drawerOpen)}
  />
  <div class="workspace-body">
    {#if isSlides && pages.length > 0}
      <ThumbnailRail />
    {/if}
    <ProjectMain />
    <RightPanel {drawerOpen} onCloseDrawer={() => (drawerOpen = false)} />
  </div>
  <StatusBar />
</div>
