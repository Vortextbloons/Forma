<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { projectStore } from "./projectStore.svelte";

  let {
    onOpenSettings,
    onCloseProject,
    onToggleDrawer,
    drawerOpen = false,
  }: {
    onOpenSettings: () => void;
    onCloseProject: () => void;
    onToggleDrawer: () => void;
    drawerOpen?: boolean;
  } = $props();

  const project = $derived(projectStore.current?.project);
  const savedLabel = $derived(
    projectStore.saveStatus === "saving"
      ? "Saving…"
      : projectStore.saveStatus === "error"
        ? "Save failed"
        : "Saved",
  );
</script>

<header class="forma-header">
  <button
    class="icon-btn"
    type="button"
    title="All projects"
    aria-label="Back to all projects"
    onclick={onCloseProject}
  >
    <Icon name="arrow-left" size={15} />
  </button>
  <span class="forma-wordmark">Forma</span>
  <span class="header-sep">·</span>
  <span class="header-project" title={project?.name ?? ""}>{project?.name ?? ""}</span>
  <span class="save-state" class:error={projectStore.saveStatus === "error"}>{savedLabel}</span>
  <span class="spacer"></span>
  <button
    class="icon-btn drawer-toggle"
    class:active={drawerOpen}
    type="button"
    title="Toggle chat"
    aria-label="Toggle chat"
    aria-expanded={drawerOpen}
    onclick={onToggleDrawer}
  >
    <Icon name="panel-right" size={15} />
  </button>
  <button class="btn btn-ghost" type="button" onclick={onOpenSettings}>
    <Icon name="gear" size={14} /> Project settings
  </button>
  <button class="btn" type="button" disabled title="Export is not available yet">
    <Icon name="external" size={14} /> Export
  </button>
</header>
