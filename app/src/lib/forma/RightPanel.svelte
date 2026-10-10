<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import ChatPanel from "./ChatPanel.svelte";

  let {
    drawerOpen = false,
    width,
    onCloseDrawer,
  }: { drawerOpen?: boolean; width?: number; onCloseDrawer: () => void } = $props();

</script>

<aside
  class="forma-right-panel"
  class:drawer-open={drawerOpen}
  style={width !== undefined ? `--forma-panel-width:${width}px` : undefined}
  aria-label="Project chat"
>
  <button class="icon-btn drawer-close chat-drawer-close" type="button" title="Close chat" aria-label="Close chat" onclick={onCloseDrawer}>
    <Icon name="x" size={14} />
  </button>
  <div class="panel-content">
    <ChatPanel />
  </div>
</aside>
