<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import ChatPanel from "./ChatPanel.svelte";
  import AssetsPanel from "./AssetsPanel.svelte";
  import DesignPanel from "./DesignPanel.svelte";
  import { projectStore } from "./projectStore.svelte";

  let {
    drawerOpen = false,
    onCloseDrawer,
  }: { drawerOpen?: boolean; onCloseDrawer: () => void } = $props();

  let tab = $state<"chat" | "assets" | "design">("chat");
  const contextCount = $derived(projectStore.current?.project.context.length ?? 0);
</script>

<aside class="forma-right-panel" class:drawer-open={drawerOpen} aria-label="Project panel">
  <div class="panel-tabs" role="tablist" aria-label="Project panel">
    <button
      type="button"
      role="tab"
      class:active={tab === "chat"}
      aria-selected={tab === "chat"}
      onclick={() => (tab = "chat")}
    >Chat</button>
    <button
      type="button"
      role="tab"
      class:active={tab === "assets"}
      aria-selected={tab === "assets"}
      onclick={() => (tab = "assets")}
    >Assets{contextCount > 0 ? ` (${contextCount})` : ""}</button>
    <button
      type="button"
      role="tab"
      class:active={tab === "design"}
      aria-selected={tab === "design"}
      onclick={() => (tab = "design")}
    >Design</button>
    <span class="spacer"></span>
    <button class="icon-btn drawer-close" type="button" title="Close panel" aria-label="Close panel" onclick={onCloseDrawer}>
      <Icon name="x" size={14} />
    </button>
  </div>
  <div class="panel-content">
    {#if tab === "chat"}
      <ChatPanel />
    {:else if tab === "assets"}
      <AssetsPanel />
    {:else}
      <DesignPanel />
    {/if}
  </div>
</aside>
