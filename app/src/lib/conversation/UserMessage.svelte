<script lang="ts">
  import type { MessageEntry } from "../rig/stores/messageStore.svelte";

  let { entry }: { entry: MessageEntry } = $props();
</script>

<div class="msg msg-user">
  <div class="msg-bubble">{entry.content}</div>
</div>
