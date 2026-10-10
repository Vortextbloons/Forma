<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { pickDirectory, pickSaveFile, nativeOpenPath, nativeRevealInFolder } from "../rig/native";
  import type { ExportFormat, ExportResult, ExportScope } from "./types";
  import { effectiveSize } from "../../../../src/projects/size.ts";
  import { formatDimensions } from "./sizes";
  import { onMount } from "svelte";

  let { onclose }: { onclose: () => void } = $props();

  const project = $derived(projectStore.current?.project);
  const pages = $derived(project?.pages ?? []);
  const isPoster = $derived(project?.settings.output === "poster");
  const isPrintPoster = $derived(isPoster && project?.settings.posterKind === "print");
  const size = $derived(project ? effectiveSize(project.settings) : null);

  let format = $state<ExportFormat>("pdf");
  let pngScope = $state<"selected" | "all">("all");
  let pngScale = $state<1 | 2>(1);
  let pngDpi = $state<150 | 300>(300);
  let destination = $state("");
  let acknowledged = $state(false);
  let choosing = $state(false);
  let exported = $state<ExportResult | null>(null);
  let exportedTo = $state("");
  let errorMessage = $state("");

  const blocking = $derived(
    projectStore.validation?.issues.filter((issue) => issue.kind === "missing-asset") ?? [],
  );
  const advisories = $derived(
    projectStore.validation?.issues.filter(
      (issue) => issue.kind === "overflow" || issue.kind === "clipped-text",
    ) ?? [],
  );

  const scope = $derived<ExportScope>(
    isPoster ? "poster" : format === "png" && pngScope === "selected" ? "selected" : "all",
  );
  const selectedIndex = $derived(
    projectStore.selectedPageId ? pages.indexOf(projectStore.selectedPageId) : -1,
  );
  const run = $derived(projectStore.exportRun);
  const percent = $derived(
    run && run.total > 0 ? Math.min(100, Math.round((run.completed / run.total) * 100)) : 0,
  );

  const canExport = $derived(
    !projectStore.exporting &&
    destination !== "" &&
    blocking.length === 0 &&
    (advisories.length === 0 || acknowledged),
  );

  onMount(() => {
    if (pages.length > 0 && !projectStore.validation && !projectStore.validating) {
      void projectStore.validateArtwork();
    }
  });

  function selectFormat(next: ExportFormat): void {
    if (format === next) return;
    format = next;
    destination = "";
    acknowledged = false;
  }

  function safeName(): string {
    const name = (project?.name ?? "Forma").trim().replace(/[\\/:*?"<>|]+/g, "-");
    return name || "Forma";
  }

  async function chooseDestination(): Promise<void> {
    if (choosing || projectStore.exporting) return;
    choosing = true;
    try {
      const name = safeName();
      if (format === "png" && scope === "all") {
        destination = await pickDirectory("Choose a folder for the slide PNGs");
      } else if (format === "pdf") {
        destination = await pickSaveFile("Export PDF", `${name}.pdf`, "*.pdf");
      } else if (format === "png") {
        const suffix = scope === "selected" && selectedIndex >= 0 ? `-slide-${selectedIndex + 1}` : isPoster ? "-poster" : "";
        destination = await pickSaveFile("Export PNG", `${name}${suffix}.png`, "*.png");
      } else {
        destination = await pickSaveFile("Export Google Slides", `${name}.pptx`, "*.pptx");
      }
    } finally {
      choosing = false;
    }
  }

  async function startExport(): Promise<void> {
    if (!canExport) return;
    errorMessage = "";
    exported = null;
    exportedTo = destination;
    const pageId = scope === "selected" ? (projectStore.selectedPageId ?? undefined) : undefined;
    try {
      exported = await projectStore.startExport({
        format,
        scope,
        ...(pageId ? { pageId } : {}),
        destination,
        ...(format === "png" ? (isPrintPoster ? { dpi: pngDpi } : { scale: pngScale }) : {}),
      });
    } catch (error) {
      errorMessage =
        (error as { code?: string }).code === "CANCELLATION_ERROR"
          ? "Export cancelled."
          : error instanceof Error
            ? error.message
            : String(error);
    }
  }

  function openResult(): void {
    const target = exported?.files[0] ?? exportedTo;
    if (target) void nativeOpenPath(exported && exported.files.length > 1 ? exportedTo : target);
  }

  function revealResult(): void {
    const target = exported?.files[0] ?? exportedTo;
    if (target) void nativeRevealInFolder(target);
  }

  function onOverlayKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !projectStore.exporting) onclose();
  }
</script>

<div
  class="modal-overlay"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget && !projectStore.exporting) onclose();
  }}
  onkeydown={onOverlayKeydown}
>
  <div class="modal export-modal" role="dialog" aria-modal="true" aria-label="Export" tabindex="-1">
    <div class="modal-head">
      <span class="modal-title">Export</span>
      <button
        class="icon-btn"
        type="button"
        title="Close"
        aria-label="Close export"
        disabled={projectStore.exporting}
        onclick={onclose}
      >
        <Icon name="x" size={16} />
      </button>
    </div>

    <div class="modal-body export-body">
      {#if exported}
        <div class="export-done">
          <p class="export-done-title"><Icon name="check" size={15} /> Export finished</p>
          <p class="muted small">{exported.files.length === 1 ? "Saved to:" : `${exported.files.length} files saved to:`}</p>
          <p class="export-path" title={exportedTo}>{exportedTo}</p>
          <div class="field-row">
            <button class="btn btn-accent" type="button" onclick={openResult}>
              <Icon name="external" size={14} /> {exported.files.length > 1 ? "Open folder" : "Open"}
            </button>
            <button class="btn" type="button" onclick={revealResult}>Show in folder</button>
            <button class="btn btn-ghost" type="button" onclick={() => (exported = null)}>Export again</button>
          </div>
        </div>
      {:else if projectStore.exporting}
        <div class="export-progress">
          <p class="export-done-title">Exporting… {run ? `${run.completed}/${run.total}` : ""}</p>
          <div class="progress-track"><div class="progress-fill" style={`width:${percent}%`}></div></div>
          <p class="muted small">Forma is rendering each page in Chromium. Keep this window open.</p>
          <button class="btn" type="button" onclick={() => void projectStore.cancelExport()}>
            <Icon name="stop" size={13} /> Stop export
          </button>
        </div>
      {:else}
        <div class="field">
          <span class="field-label">Format</span>
          <div class="export-formats" role="radiogroup" aria-label="Export format">
            <button
              class="export-format"
              class:active={format === "pdf"}
              type="button"
              role="radio"
              aria-checked={format === "pdf"}
              onclick={() => selectFormat("pdf")}
            >
              <span class="export-format-name">PDF</span>
              <span class="muted small">{isPoster ? "Print or share the poster at its exact size" : "The whole deck at the exact slide size"}</span>
            </button>
            <button
              class="export-format"
              class:active={format === "png"}
              type="button"
              role="radio"
              aria-checked={format === "png"}
              onclick={() => selectFormat("png")}
            >
              <span class="export-format-name">PNG</span>
              <span class="muted small">{isPoster ? "A pixel-perfect image of the poster" : "Slide images at 1× or 2× resolution"}</span>
            </button>
            {#if !isPoster}
              <button
                class="export-format"
                class:active={format === "pptx"}
                type="button"
                role="radio"
                aria-checked={format === "pptx"}
                onclick={() => selectFormat("pptx")}
              >
                <span class="export-format-name">Google Slides (.pptx)</span>
                <span class="muted small">Editable text and shapes, ready to import</span>
              </button>
            {/if}
          </div>
        </div>

        {#if format === "png" && !isPoster}
          <div class="field">
            <span class="field-label">Slides</span>
            <div class="segmented segmented-small" role="group" aria-label="Slides to export">
              <button type="button" class:active={pngScope === "all"} aria-pressed={pngScope === "all"} onclick={() => { pngScope = "all"; destination = ""; }}>All slides</button>
              <button type="button" class:active={pngScope === "selected"} aria-pressed={pngScope === "selected"} disabled={selectedIndex < 0} onclick={() => { pngScope = "selected"; destination = ""; }}>Selected slide</button>
            </div>
          </div>
        {/if}

        {#if format === "png"}
          <div class="field">
            <span class="field-label">{isPrintPoster ? "Resolution" : "Scale"}</span>
            {#if isPrintPoster}
              <div class="segmented segmented-small" role="group" aria-label="Resolution">
                <button type="button" class:active={pngDpi === 150} aria-pressed={pngDpi === 150} onclick={() => (pngDpi = 150)}>150 DPI</button>
                <button type="button" class:active={pngDpi === 300} aria-pressed={pngDpi === 300} onclick={() => (pngDpi = 300)}>300 DPI</button>
              </div>
              <p class="muted small">Calculated from the poster's physical size{size ? ` (${formatDimensions(project!.settings)})` : ""}.</p>
            {:else}
              <div class="segmented segmented-small" role="group" aria-label="Scale">
                <button type="button" class:active={pngScale === 1} aria-pressed={pngScale === 1} onclick={() => (pngScale = 1)}>1×</button>
                <button type="button" class:active={pngScale === 2} aria-pressed={pngScale === 2} onclick={() => (pngScale = 2)}>2×</button>
              </div>
            {/if}
          </div>
        {/if}

        <div class="field">
          <span class="field-label">Save to</span>
          <div class="field-row">
            <button class="btn" type="button" disabled={choosing} onclick={() => void chooseDestination()}>
              <Icon name="folder" size={14} />
              {destination ? "Change…" : format === "png" && scope === "all" ? "Choose folder…" : "Choose file…"}
            </button>
            {#if destination}
              <span class="export-path" title={destination}>{destination}</span>
            {/if}
          </div>
        </div>

        {#if format === "pptx"}
          <p class="muted small export-note">
            Import the .pptx into Google Slides to edit supported text and shapes. Complex artwork remains images; animations and transitions are added there.
          </p>
        {/if}

        {#if projectStore.validating}
          <p class="muted small"><span class="spinner"></span> Checking the artwork for missing assets…</p>
        {/if}

        {#if blocking.length > 0}
          <div class="export-block">
            <p class="export-block-title"><Icon name="alert" size={14} /> Export is blocked by {blocking.length} missing asset{blocking.length === 1 ? "" : "s"}.</p>
            <ul class="export-issues">
              {#each blocking.slice(0, 5) as issue, index (index)}
                <li>{issue.pageId ? `Slide ${pages.indexOf(issue.pageId) + 1}: ` : ""}{issue.message}</li>
              {/each}
            </ul>
            <p class="muted small">Restore the files or remove them from the artwork, then check the layout again.</p>
          </div>
        {/if}

        {#if advisories.length > 0}
          <div class="export-advisory">
            <p class="export-block-title"><Icon name="alert" size={14} /> {advisories.length} layout issue{advisories.length === 1 ? "" : "s"} found.</p>
            <ul class="export-issues">
              {#each advisories.slice(0, 5) as issue, index (index)}
                <li>{issue.pageId ? `Slide ${pages.indexOf(issue.pageId) + 1}: ` : ""}{issue.message}</li>
              {/each}
            </ul>
            <label class="export-ack">
              <input type="checkbox" bind:checked={acknowledged} />
              Export anyway
            </label>
          </div>
        {/if}

        {#if errorMessage}
          <p class="export-error"><Icon name="alert" size={14} /> {errorMessage}</p>
        {/if}

        <div class="export-actions">
          <button class="btn btn-ghost" type="button" onclick={onclose}>Cancel</button>
          <button class="btn btn-accent" type="button" disabled={!canExport} onclick={() => void startExport()}>
            <Icon name="download" size={14} /> Export
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .export-modal {
    width: min(560px, calc(100vw - 48px));
  }

  .export-body {
    flex-direction: column;
    gap: 16px;
  }

  .export-formats {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .export-format {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }

  .export-format:hover {
    border-color: var(--border-strong);
  }

  .export-format.active {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .export-format-name {
    font-weight: 650;
    font-size: 12px;
  }

  .export-path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font: 600 11px/1.6 var(--font-mono);
  }

  .export-progress {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
  }

  .export-progress .progress-track {
    width: 100%;
  }

  .export-done {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .export-done-title {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-weight: 650;
  }

  .export-block,
  .export-advisory {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
  }

  .export-advisory {
    border-color: color-mix(in srgb, var(--warning, #b8860b) 45%, var(--border));
  }

  .export-block-title {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 6px;
    font-weight: 650;
    font-size: 12px;
  }

  .export-issues {
    margin: 0;
    padding-left: 18px;
    color: var(--muted);
    font-size: 11px;
  }

  .export-ack {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 8px;
    font-size: 12px;
  }

  .export-error {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--danger);
    font-size: 12px;
  }

  .export-note {
    margin: 0;
  }

  .export-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
