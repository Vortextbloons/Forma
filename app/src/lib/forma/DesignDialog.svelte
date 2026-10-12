<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import DesignMashup from "./DesignMashup.svelte";
  import DesignPanel from "./DesignPanel.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { defaultDesignProfile } from "../../../../src/projects/design.ts";

  let {
    onclose,
    onOpenSettings,
    view = "settings",
  }: { onclose: () => void; onOpenSettings: () => void; view?: "settings" | "profile" } = $props();

  const settings = $derived(projectStore.current?.project.settings);
  const profile = $derived(settings?.designProfile ?? defaultDesignProfile());
  const approved = $derived(settings?.designApproved ?? false);
  const running = $derived(projectStore.run !== null);

  function propose(): void {
    onclose();
    void projectStore.sendRefine(
      "Propose a new shared design palette and typography for this project. Show the design with propose_design and wait for my approval or feedback. Do not create or edit artwork pages.",
      { scope: "project" },
      "plan",
    );
  }
</script>

<div
  class="modal-overlay"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose();
  }}
>
  <div
    class="modal design-modal"
    role="dialog"
    aria-modal="true"
    aria-label={view === "profile" ? "Design profile" : "Design settings"}
    tabindex="-1"
  >
    <div class="modal-head design-head">
      {#if settings && view === "profile"}
        <DesignMashup {profile} height={36} width={88} />
        <div class="design-head-info">
          <span class="modal-title">{approved ? settings.designName : "AI chooses"}</span>
          <span class="muted small">{approved ? "Applied across every page" : "AI will propose a design for your approval"}</span>
        </div>
        <div class="modal-actions">
          <button class="btn btn-accent" type="button" disabled={running} onclick={propose}>
            <Icon name="zap" size={13} /> Propose with AI
          </button>
          <button class="icon-btn" type="button" title="Settings" aria-label="Open settings" onclick={onOpenSettings}>
            <Icon name="gear" size={16} />
          </button>
          <button class="icon-btn" type="button" title="Close" aria-label="Close design" onclick={onclose}>
            <Icon name="x" size={16} />
          </button>
        </div>
      {:else if settings}
        <div class="design-head-info">
          <span class="modal-title">Design settings</span>
          <span class="muted small">Style, density, and aspect ratio</span>
        </div>
        <div class="modal-actions">
          <button class="icon-btn" type="button" title="Settings" aria-label="Open settings" onclick={onOpenSettings}>
            <Icon name="gear" size={16} />
          </button>
          <button class="icon-btn" type="button" title="Close" aria-label="Close design" onclick={onclose}>
            <Icon name="x" size={16} />
          </button>
        </div>
      {:else}
        <span class="modal-title">Design</span>
        <div class="modal-actions">
          <button class="icon-btn" type="button" title="Close" aria-label="Close design" onclick={onclose}>
            <Icon name="x" size={16} />
          </button>
        </div>
      {/if}
    </div>
    <div class="modal-body design-body">
      <DesignPanel section={view} />
    </div>
  </div>
</div>

<svelte:window onkeydown={(event) => { if (event.key === "Escape") onclose(); }} />

<style>
  .design-head {
    gap: 12px;
  }
  .design-head-info {
    display: grid;
    flex: 1;
    gap: 1px;
    min-width: 0;
  }
  .design-head-info .modal-title {
    line-height: 1.2;
  }
  .modal-actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .design-body {
    padding: 0;
  }
</style>