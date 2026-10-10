<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import PageIcon from "./PageIcon.svelte";
  import { workerStore } from "../rig/stores/workerStore.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { formatDimensions } from "./sizes";
  import { effectiveSize } from "../../../../src/projects/size.ts";

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);
  const pages = $derived(project?.pages ?? []);
  const run = $derived(projectStore.run);
  const validation = $derived(projectStore.validation);
  let issuesOpen = $state(false);

  const status = $derived.by(() => {
    if (workerStore.status === "error" || workerStore.status === "stopped") {
      return { text: "Connection lost — restart Forma to continue", tone: "error" };
    }
    if (workerStore.status === "connecting" || workerStore.status === "restarting") {
      return { text: "Connecting…", tone: "busy" };
    }
    if (run) {
      const label =
        run.kind === "outline"
          ? "Building the outline"
          : run.kind === "design"
            ? "Applying design settings"
            : run.kind === "refine"
              ? "Refining"
              : project?.settings.output === "poster"
                ? "Creating the poster"
                : "Creating the slides";
      const count = run.total > 0 ? ` · ${run.completed}/${run.total} pages` : "";
      return { text: `${label}…${count}`, tone: "busy" };
    }
    const sessionStatus = sessionStore.statusOf(sessionStore.activeSessionId);
    if (sessionStatus === "running" || sessionStatus === "waiting" || sessionStatus === "approval") {
      return { text: "Forma is working…", tone: "busy" };
    }
    if (projectStore.saveStatus === "saving") return { text: "Saving changes…", tone: "muted" };
    if (projectStore.saveStatus === "error") return { text: "Changes not saved", tone: "error" };
    return { text: "All changes saved", tone: "muted" };
  });

  const issueCount = $derived(validation?.issues.length ?? 0);
  const blockingCount = $derived(
    validation?.issues.filter((issue) => issue.kind === "missing-asset").length ?? 0,
  );

  const zoomLabel = $derived(
    projectStore.zoom === "fit" ? "Fit" : `${Math.round(projectStore.zoom)}%`,
  );

  function zoomBy(delta: number): void {
    const current = projectStore.zoom === "fit" ? 100 : projectStore.zoom;
    projectStore.setZoom(Math.min(200, Math.max(25, current + delta)));
  }
</script>

<footer class="status-bar">
  <span class="status-dot {status.tone}" aria-hidden="true"></span>
  <span>{status.text}</span>

  {#if run}
    <button class="btn btn-ghost btn-sm" type="button" onclick={() => void projectStore.stopGeneration()}>
      Stop
    </button>
  {/if}

  <span class="spacer"></span>

  {#if pages.length > 0}
    {#if projectStore.validating}
      <span class="status-dim"><span class="spinner"></span> Checking layout…</span>
    {:else if validation}
      <button
        class="status-issues"
        class:has-issues={issueCount > 0}
        type="button"
        aria-expanded={issuesOpen}
        onclick={() => (issuesOpen = !issuesOpen)}
      >
        <Icon name={issueCount > 0 ? "alert" : "check"} size={13} />
        {issueCount === 0 ? "No issues found" : `${issueCount} issue${issueCount === 1 ? "" : "s"}`}
      </button>
    {:else}
      <button class="status-link" type="button" onclick={() => void projectStore.validateArtwork()}>
        Check layout
      </button>
    {/if}
  {/if}

  {#if pages.length > 0}
    <span class="zoom-controls" role="group" aria-label="Zoom">
      <button class="icon-btn" type="button" title="Zoom out" aria-label="Zoom out" onclick={() => zoomBy(-10)}>
        <Icon name="minus" size={12} />
      </button>
      <button class="zoom-value" type="button" title="Fit to window" onclick={() => projectStore.setZoom("fit")}>
        {zoomLabel}
      </button>
      <button class="icon-btn" type="button" title="Zoom in" aria-label="Zoom in" onclick={() => zoomBy(10)}>
        <Icon name="plus" size={12} />
      </button>
    </span>
  {/if}

  {#if size}
    <span class="status-dim">
      <PageIcon width={size.width} height={size.height} size={13} />
      {formatDimensions(project!.settings)}
    </span>
  {/if}
</footer>

{#if issuesOpen && validation}
  <div class="issues-popover" role="region" aria-label="Validation issues">
    {#if validation.renderError}
      <p class="issues-warning">{validation.renderError}</p>
    {/if}
    {#if validation.issues.length === 0}
      <p class="muted small">No layout problems were found.</p>
    {:else}
      <ul class="issues-list">
        {#each validation.issues as issue, index (index)}
          <li class="issue-row">
            <span class="issue-slide">
              {issue.pageId && project
                ? `Slide ${project.pages.indexOf(issue.pageId) + 1}`
                : "Project"}
            </span>
            <span class="issue-message">{issue.message}</span>
            {#if issue.detail}<span class="muted small">{issue.detail}</span>{/if}
          </li>
        {/each}
      </ul>
      {#if blockingCount > 0}
        <p class="issues-warning">{blockingCount} missing asset{blockingCount === 1 ? "" : "s"} block export.</p>
      {/if}
      <p class="muted small">Overflow issues can be acknowledged, or sent to Forma from the chat.</p>
    {/if}
  </div>
{/if}
