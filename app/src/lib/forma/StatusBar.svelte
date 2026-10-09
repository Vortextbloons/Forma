<script lang="ts">
  import PageIcon from "./PageIcon.svelte";
  import { workerStore } from "../rig/stores/workerStore.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { formatDimensions } from "./sizes";
  import { effectiveSize } from "../../../../src/projects/size.ts";

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);
  const workerLabel = $derived(
    workerStore.status === "ready"
      ? "Worker ready"
      : workerStore.status === "connecting"
        ? "Connecting…"
        : workerStore.status === "restarting"
          ? "Restarting…"
          : workerStore.status === "error"
            ? "Worker error"
            : "Worker stopped",
  );
</script>

<footer class="status-bar">
  <span class="status-dot {workerStore.status}" aria-hidden="true"></span>
  <span>{workerLabel}</span>
  <span class="status-sep">·</span>
  <span>Generation idle</span>
  <span class="spacer"></span>
  {#if size}
    <span class="status-dim">
      <PageIcon width={size.width} height={size.height} size={13} />
      {formatDimensions(project!.settings)}
    </span>
    <span class="status-sep">·</span>
  {/if}
  <span>No validation issues</span>
</footer>
