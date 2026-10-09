<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import { formatDuration } from "../rig/format";
  import type { SubagentStatus, ToolStatus } from "../rig/types";

  let {
    name,
    status,
    durationMs,
    actions,
  }: {
    name: string;
    status: ToolStatus | SubagentStatus;
    durationMs?: number;
    actions?: Snippet;
  } = $props();
</script>

<div class="tool-header">
  <span class="tool-name">{name}</span>
  <StatusBadge {status} />
  {#if durationMs !== undefined}
    <span class="muted">{formatDuration(durationMs)}</span>
  {/if}
  <span class="composer-spacer"></span>
  {@render actions?.()}
</div>
