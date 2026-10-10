<script lang="ts">
  import PageIcon from "./PageIcon.svelte";
  import { workerStore } from "../rig/stores/workerStore.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { formatDimensions } from "./sizes";
  import { effectiveSize } from "../../../../src/projects/size.ts";

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);

  const status = $derived.by(() => {
    if (workerStore.status === "error" || workerStore.status === "stopped") {
      return { text: "Connection lost — restart Forma to continue", tone: "error" };
    }
    if (workerStore.status === "connecting" || workerStore.status === "restarting") {
      return { text: "Connecting…", tone: "busy" };
    }
    const status = sessionStore.statusOf(sessionStore.activeSessionId);
    if (status === "running" || status === "waiting" || status === "approval") {
      const mode = project?.mode;
      const hasOutline = (project?.outline?.length ?? 0) > 0;
      const text =
        mode === "plan" && !hasOutline
          ? "Building your outline…"
          : project?.settings.output === "poster"
            ? "Creating your poster…"
            : "Creating your slides…";
      return { text, tone: "busy" };
    }
    if (projectStore.saveStatus === "saving") return { text: "Saving changes…", tone: "muted" };
    if (projectStore.saveStatus === "error") return { text: "Changes not saved", tone: "error" };
    return { text: "All changes saved", tone: "muted" };
  });
</script>

<footer class="status-bar">
  <span class="status-dot {status.tone}" aria-hidden="true"></span>
  <span>{status.text}</span>
  <span class="spacer"></span>
  {#if size}
    <span class="status-dim">
      <PageIcon width={size.width} height={size.height} size={13} />
      {formatDimensions(project!.settings)}
    </span>
  {/if}
</footer>
