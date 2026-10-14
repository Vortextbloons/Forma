<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import Logo from "../components/Logo.svelte";
  import { projectStore } from "./projectStore.svelte";

  let {
    onOpenSettings,
    onCloseProject,
    onOpenExport,
    previewOpen,
    onTogglePreview,
  }: {
    onOpenSettings: () => void;
    onCloseProject: () => void;
    onOpenExport: () => void;
    previewOpen: boolean;
    onTogglePreview: () => void;
  } = $props();

  const project = $derived(projectStore.current?.project);
  const busy = $derived(projectStore.run !== null || projectStore.exporting);
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
  <Logo size={20} />
  <span class="header-sep">·</span>
  <span class="header-project" title={project?.name ?? ""}>{project?.name ?? ""}</span>
  <span class="save-state" class:error={projectStore.saveStatus === "error"}>{savedLabel}</span>
  <span class="spacer"></span>
  <button class="btn preview-toggle" type="button" aria-pressed={previewOpen} onclick={onTogglePreview}>
    <Icon name="external" size={14} /> {previewOpen ? "Back to chat" : project?.pages.length ? "View artwork" : project?.outline?.length ? "View plan" : "Preview"}
  </button>
  <button
    class="btn btn-accent"
    type="button"
    disabled={!project?.pages.length || busy}
    title={project?.pages.length ? "Export the artwork" : "Generate the artwork before exporting"}
    onclick={onOpenExport}
  >
    <Icon name="download" size={14} /> Export
  </button>
  <button class="btn btn-ghost" type="button" aria-label="Settings" onclick={onOpenSettings}>
    <Icon name="gear" size={14} /> <span class="settings-label">Settings</span>
  </button>

</header>
