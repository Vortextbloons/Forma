<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { projectStore } from "./projectStore.svelte";

  let {
    onOpenSettings,
    onCloseProject,
    onOpenExport,
    compact,
    layout,
    previewOpen,
    onLayoutChange,
    onTogglePreview,
  }: {
    onOpenSettings: () => void;
    onCloseProject: () => void;
    onOpenExport: () => void;
    compact: boolean;
    layout: "full" | "side";
    previewOpen: boolean;
    onLayoutChange: (layout: "full" | "side") => void;
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
  <span class="forma-wordmark">Forma</span>
  <span class="header-sep">·</span>
  <span class="header-project" title={project?.name ?? ""}>{project?.name ?? ""}</span>
  <span class="save-state" class:error={projectStore.saveStatus === "error"}>{savedLabel}</span>
  <span class="spacer"></span>
  <div class="segmented layout-switch" role="group" aria-label="Chat layout">
    <button type="button" class:active={layout === "full"} aria-pressed={layout === "full"} onclick={() => onLayoutChange("full")}><Icon name="message" size={14} /> Full chat</button>
    <button type="button" disabled={compact} class:active={layout === "side"} aria-pressed={layout === "side"} onclick={() => onLayoutChange("side")}><Icon name="panel-right" size={14} /> Side chat</button>
  </div>
  <button class="btn preview-toggle" type="button" aria-pressed={previewOpen} onclick={onTogglePreview}>
    <Icon name="external" size={14} /> {previewOpen ? "Back to chat" : project?.pages.length ? "View artwork" : project?.outline?.length ? "View plan" : "Preview"}
  </button>
  <button class="btn btn-ghost" type="button" aria-label="Project settings" onclick={onOpenSettings}>
    <Icon name="gear" size={14} /> <span class="project-settings-label">Project settings</span>
  </button>
  <button
    class="btn"
    type="button"
    disabled={!project?.pages.length || busy}
    title={project?.pages.length ? "Export the artwork" : "Generate the artwork before exporting"}
    onclick={onOpenExport}
  >
    <Icon name="download" size={14} /> Export
  </button>

</header>
