<script lang="ts">
  import ChatPanel from "./ChatPanel.svelte";

  let { layout = "side" }: { layout?: "full" | "side" } = $props();
</script>

<aside class="forma-right-panel" aria-label="Project chat">
  <div class="panel-content">
    <ChatPanel {layout} />
  </div>
</aside>
