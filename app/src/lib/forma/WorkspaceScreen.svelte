<script lang="ts">
  import ProjectHeader from "./ProjectHeader.svelte";
  import ThumbnailRail from "./ThumbnailRail.svelte";
  import ProjectMain from "./ProjectMain.svelte";
  import RightPanel from "./RightPanel.svelte";
  import StatusBar from "./StatusBar.svelte";
  import { projectStore } from "./projectStore.svelte";

  let { onOpenSettings, onCloseProject }: { onOpenSettings: () => void; onCloseProject: () => void } = $props();

  let drawerOpen = $state(false);
  let selectedPage = $state(0);

  const pages = $derived(projectStore.current?.project.pages ?? []);
  const isSlides = $derived(projectStore.current?.project.settings.output === "slides");
  const page = $derived(pages.length > 0 ? Math.min(selectedPage, pages.length - 1) : null);
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
      <ThumbnailRail selected={page ?? 0} onSelect={(index) => (selectedPage = index)} />
    {/if}
    <ProjectMain {page} />
    <RightPanel {drawerOpen} onCloseDrawer={() => (drawerOpen = false)} />
  </div>
  <StatusBar />
</div>
