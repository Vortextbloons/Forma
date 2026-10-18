<script lang="ts">
  import { onMount } from "svelte";
  import { Events } from "@wailsio/runtime";
  import Icon from "../components/Icon.svelte";
  import Collapsible from "../components/Collapsible.svelte";
  import ContextTextDialog from "./ContextTextDialog.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { pickFiles, openUrl, isNative, nativeOpenPath } from "../rig/native";
  import { formatFileSize } from "./types";
  import type { ActionRecord, ContextItem, MaterialPreview } from "./types";

  type Filter = "all" | "results" | "outdated";

  const UNFILED = "__unfiled__";
  const FILTERS: Array<[Filter, string]> = [
    ["all", "All"],
    ["results", "Results"],
    ["outdated", "Out of date"],
  ];

  let importing = $state(false);
  let dropActive = $state(false);
  let noteOpen = $state(false);
  let noteDraft = $state("");
  let noteName = $state("");
  let folderOpen = $state(false);
  let folderName = $state("");
  let viewingId = $state<string | null>(null);
  let blockedRemove = $state<{ id: string; references: string[] } | null>(null);
  let expandedIds = $state<Record<string, true>>({});
  let search = $state("");
  let filter = $state<Filter>("all");
  let folderFilter = $state("");
  let previews = $state<Record<string, MaterialPreview | null>>({});
  let codeOpen = $state<string | null>(null);
  let actionsEl = $state<HTMLElement | null>(null);

  function onWindowPointerDown(event: PointerEvent): void {
    if (!noteOpen && !folderOpen) return;
    if (actionsEl && event.target instanceof Node && actionsEl.contains(event.target)) return;
    noteOpen = false;
    folderOpen = false;
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    noteOpen = false;
    folderOpen = false;
  }

  const project = $derived(projectStore.current?.project);
  const sources = $derived(project?.sources ?? []);
  const folders = $derived(project?.folders ?? []);
  const context = $derived(project?.context ?? []);
  const counts = $derived({
    all: context.length,
    results: context.filter((item) => item.derivedFrom.length > 0).length,
    outdated: context.filter((item) => item.stale).length,
  });

  const items = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return context.filter((item) => {
      if (filter === "results" && item.derivedFrom.length === 0) return false;
      if (filter === "outdated" && !item.stale) return false;
      if (folderFilter === UNFILED) {
        if (item.folder !== "") return false;
      } else if (folderFilter !== "" && item.folder !== folderFilter) {
        return false;
      }
      return query === "" || item.name.toLowerCase().includes(query);
    });
  });

  const nameById = $derived(new Map(context.map((item) => [item.id, item.name])));

  const derivedBySource = $derived.by(() => {
    const map = new Map<string, ContextItem[]>();
    for (const item of context) {
      for (const source of item.derivedFrom) {
        map.set(source, [...(map.get(source) ?? []), item]);
      }
    }
    return map;
  });

  const pagesByItem = $derived.by(() => {
    const map = new Map<string, string[]>();
    if (!project) return map;
    project.pages.forEach((pageId, index) => {
      const meta = project.pageMeta[pageId];
      const label = meta?.title.trim() || `Slide ${index + 1}`;
      for (const asset of meta?.assets ?? []) {
        map.set(asset, [...(map.get(asset) ?? []), label]);
      }
    });
    return map;
  });

  const stalePages = $derived.by(() => {
    if (!project) return [] as string[];
    return project.pages
      .filter((pageId) => project.pageMeta[pageId]?.stale)
      .map((pageId) => project.pageMeta[pageId]?.title.trim() || `Slide ${project.pages.indexOf(pageId) + 1}`);
  });

  const actionByOutput = $derived.by(() => {
    const map = new Map<string, ActionRecord>();
    for (const action of [...(project?.actions ?? [])].reverse()) {
      for (const id of action.outputs) {
        if (!map.has(id)) map.set(id, action);
      }
    }
    return map;
  });

  const recentActions = $derived([...(project?.actions ?? [])].slice(-8).reverse());

  $effect(() => {
    if (folderFilter !== "" && folderFilter !== UNFILED && !folders.includes(folderFilter)) {
      folderFilter = "";
    }
  });

  onMount(() => Events.On("rig:files-dropped", (event) => {
    dropActive = false;
    if (event.data.target !== "materials") return;
    void importPaths(event.data.files);
  }));

  function targetFolder(): string | undefined {
    return folderFilter !== "" && folderFilter !== UNFILED ? folderFilter : undefined;
  }

  async function importPaths(paths: string[]): Promise<void> {
    if (paths.length === 0 || importing) return;
    importing = true;
    try {
      await projectStore.importContext(paths, "optional", targetFolder());
    } finally {
      importing = false;
    }
  }

  async function add(): Promise<void> {
    await importPaths(await pickFiles("Add project materials"));
  }

  function acceptsDrop(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    return (
      types !== undefined &&
      (types.includes("Files") || types.includes("text/uri-list") || types.includes("text/html"))
    );
  }

  function onDragOver(event: DragEvent): void {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = "copy";
    dropActive = true;
  }

  function onDragLeave(event: DragEvent): void {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    dropActive = false;
  }

  async function onDrop(event: DragEvent): Promise<void> {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    dropActive = false;
    const transfer = event.dataTransfer;
    if (!transfer || importing) return;
    const files = Array.from(transfer.files);
    const url = files.length === 0 ? droppedUrl(transfer) : undefined;
    if (transfer.types.includes("Files") && await isNative()) return;
    importing = true;
    try {
      if (files.length > 0) {
        for (const file of files) {
          const data = toBase64(await file.arrayBuffer());
          await projectStore.importAsset({ name: file.name, mime: file.type, data, folder: targetFolder() });
        }
        return;
      }
      if (url) await projectStore.importAsset({ name: urlFileName(url), url, folder: targetFolder() });
    } finally {
      importing = false;
    }
  }

  function droppedUrl(transfer: DataTransfer): string | undefined {
    const uri = transfer
      .getData("text/uri-list")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^https?:\/\//i.test(line));
    if (uri) return uri;
    const html = transfer.getData("text/html");
    const match = html ? /<img[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(html) : null;
    const image = match?.[1] ?? match?.[2];
    if (image && /^https?:\/\//i.test(image)) return image;
    const text = transfer.getData("text/plain").trim();
    return /^https?:\/\//i.test(text) ? text : undefined;
  }

  function urlFileName(url: string): string {
    try {
      const name = new URL(url).pathname.split("/").filter(Boolean).pop();
      return name ? decodeURIComponent(name) : "";
    } catch {
      return "";
    }
  }

  function toBase64(buffer: ArrayBuffer): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  async function addNote(): Promise<void> {
    const text = noteDraft.trim();
    if (!text) return;
    await projectStore.importNote(text, "content-source", noteName.trim() || undefined, targetFolder());
    noteDraft = "";
    noteName = "";
    noteOpen = false;
  }

  async function createFolder(): Promise<void> {
    const name = folderName.trim();
    if (!name) return;
    if (await projectStore.addMaterialFolder(name)) {
      folderFilter = name;
      folderName = "";
      folderOpen = false;
    }
  }

  function requestRemove(item: ContextItem): void {
    const references: string[] = [];
    const slides = pagesByItem.get(item.id) ?? [];
    if (slides.length > 0) references.push(slides.join(", "));
    const results = derivedBySource.get(item.id) ?? [];
    if (results.length > 0) {
      references.push(`the result${results.length === 1 ? "" : "s"} ${results.map((entry) => entry.name).join(", ")}`);
    }
    if (project?.outline?.some((entry) => entry.assetIds.includes(item.id))) references.push("the outline");
    if (references.length === 0) {
      void projectStore.removeContext(item.id);
      return;
    }
    blockedRemove = { id: item.id, references };
  }

  async function replace(id: string): Promise<void> {    const [path] = await pickFiles("Replace material");
    if (!path) return;
    await projectStore.replaceContext(id, path);
    const next = { ...previews };
    delete next[id];
    previews = next;
    if (isExpanded(id)) await loadPreview(id);
  }

  function sourceFor(item: ContextItem) {
    return item.sourceId ? sources.find((source) => source.id === item.sourceId) : undefined;
  }

  function providerLabel(provider: string | undefined): string {
    if (provider === "ddgs") return "Built-in image search";
    if (provider === "pexels") return "Pexels";
    return provider ?? "Source";
  }

  function extractionLabel(item: ContextItem): string {
    if (!item.extraction) return "";
    const kind =
      item.extraction.kind === "ocr" ? "OCR" : item.extraction.kind === "mixed" ? "Text + OCR" : "Text";
    return `${item.extraction.pages} page${item.extraction.pages === 1 ? "" : "s"} · ${kind}`;
  }

  function typeLabel(item: ContextItem): string {
    if (item.mime === "text/html") return "Result table";
    if (item.data) {
      if (item.data.format === "xlsx") return "Excel workbook";
      if (item.data.format === "json") return "JSON data";
      if (item.data.format === "tsv") return "TSV data";
      return "CSV data";
    }
    if (item.mime.startsWith("image/")) return "Image";
    if (item.mime === "application/pdf") return "PDF";
    if (item.mime === "text/markdown") return "Note";
    if (item.mime === "text/plain") return "Text";
    return "File";
  }

  function iconFor(item: ContextItem): "image" | "list" | "zap" | "file" {
    if (item.derivedFrom.length > 0) return "zap";
    if (item.data || item.mime === "text/html") return "list";
    if (item.mime.startsWith("image/")) return "image";
    return "file";
  }

  function dataSummary(item: ContextItem): string {
    if (!item.data) return "";
    const rows = item.data.sheets.reduce((total, sheet) => total + sheet.rows, 0);
    const columns = item.data.sheets[0]?.columns.length ?? 0;
    const unit = item.data.format === "xlsx" ? "sheet" : "table";
    const parts = [`${item.data.sheets.length} ${unit}${item.data.sheets.length === 1 ? "" : "s"}`];
    if (columns > 0) parts.push(`${columns} column${columns === 1 ? "" : "s"}`);
    parts.push(`${rows.toLocaleString()} row${rows === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }

  function generatedLabel(item: ContextItem, action: ActionRecord | undefined): string {
    const date = new Date(action?.createdAt ?? item.createdAt);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function names(ids: string[]): string {
    return ids.map((id) => nameById.get(id) ?? id).join(", ");
  }

  function revealOriginal(item: ContextItem): void {
    const dir = projectStore.current?.dir;
    if (!dir) return;
    void nativeOpenPath(`${dir}/${item.asset}`);
  }

  function isExpanded(id: string): boolean {
    return expandedIds[id] === true;
  }

  async function toggle(id: string): Promise<void> {
    if (isExpanded(id)) {
      const next = { ...expandedIds };
      delete next[id];
      expandedIds = next;
      return;
    }
    expandedIds = { ...expandedIds, [id]: true };
    if (!(id in previews)) await loadPreview(id);
  }

  async function loadPreview(id: string): Promise<void> {
    previews = { ...previews, [id]: null };
    const preview = await projectStore.contextPreview(id);
    previews = { ...previews, [id]: preview };
  }

  $effect(() => {
    const pending = items.filter((item) => isExpanded(item.id) && !(item.id in previews));
    for (const item of pending) void loadPreview(item.id);
  });
</script>

<div
  class="assets-panel"
  class:file-drop-target-active={dropActive}
  role="region"
  aria-label="Project materials"
  data-file-drop-target="materials"
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={(event) => void onDrop(event)}
>
  <div class="materials-head">
    <div>
      <p class="materials-eyebrow">Library</p>
      <h2>Project materials</h2>
    </div>
    {#if context.length > 0}
      <span class="materials-total">{context.length} item{context.length === 1 ? "" : "s"}</span>
    {/if}
  </div>
  <p class="muted small">
    Everything Forma can work from: images, documents, spreadsheets, and notes. Forma reads or analyses a material only
    when your request needs it, and every result stays linked to what it came from.
  </p>

  <div class="assets-actions" bind:this={actionsEl}>
    <button class="btn btn-accent" type="button" disabled={importing} onclick={() => void add()}>
      {#if importing}
        <span class="spinner"></span> Importing…
      {:else}
        <Icon name="plus" size={13} /> Add files
      {/if}
    </button>
    <button
      class="btn"
      type="button"
      aria-expanded={noteOpen}
      onclick={() => { noteOpen = !noteOpen; folderOpen = false; }}
    >
      <Icon name="pencil" size={13} /> Add information
    </button>
    <button
      class="btn"
      type="button"
      aria-expanded={folderOpen}
      onclick={() => { folderOpen = !folderOpen; noteOpen = false; }}
    >
      <Icon name="folder" size={13} /> New folder
    </button>
    {#if noteOpen}
      <div class="note-form">
        <input class="input" type="text" placeholder="Title (optional)" bind:value={noteName} aria-label="Information title" />
        <textarea
          class="input textarea"
          rows="4"
          placeholder="Add facts, background, or key messages for the AI to draw from…"
          bind:value={noteDraft}
          aria-label="Project material information"
        ></textarea>
        <div class="note-form-foot">
          <button class="btn btn-accent" type="button" disabled={noteDraft.trim() === ""} onclick={() => void addNote()}>
            Add information
          </button>
        </div>
      </div>
    {/if}
    {#if folderOpen}
      <div class="note-form">
        <input
          class="input"
          type="text"
          placeholder="Folder name"
          bind:value={folderName}
          aria-label="New folder name"
          onkeydown={(event) => { if (event.key === "Enter") void createFolder(); }}
        />
        <div class="note-form-foot">
          <button class="btn btn-accent" type="button" disabled={folderName.trim() === ""} onclick={() => void createFolder()}>
            Create folder
          </button>
        </div>
      </div>
    {/if}
  </div>

  <p class="muted small">
    PNG, JPEG, WebP, SVG, PDF, TXT, Markdown, CSV, TSV, JSON, Excel. Drag files here, or add several at once; each is
    copied into the project and the original stays where it is.
  </p>

  {#if counts.outdated > 0 || stalePages.length > 0}
    <div class="materials-stale" role="status">
      <div class="materials-stale-head">
        <Icon name="alert" size={13} />
        <strong>{counts.outdated} result{counts.outdated === 1 ? "" : "s"} out of date</strong>
      </div>
      <p class="small">
        A source material changed after {counts.outdated === 1 ? "this result was" : "these results were"} made, so
        {counts.outdated === 1 ? "it may" : "they may"} no longer match.
        {#if stalePages.length > 0}
          {stalePages.length === 1 ? "The slide" : "The slides"} {stalePages.join(", ")} also
          {stalePages.length === 1 ? "needs" : "need"} refreshing.
        {/if}
        Ask Forma to rebuild what you need, or open a result and keep it as it is.
      </p>
    </div>
  {/if}

  {#if context.length > 0}
    <div class="materials-controls">
      <label class="materials-search">
        <Icon name="search" size={13} />
        <input class="input" type="search" placeholder="Search materials" bind:value={search} aria-label="Search materials" />
      </label>
      <div class="materials-filters" role="group" aria-label="Filter materials">
        {#each FILTERS as [key, label] (key)}
          <button
            class="materials-chip"
            class:active={filter === key}
            type="button"
            aria-pressed={filter === key}
            onclick={() => (filter = key)}
          >
            {label} <span class="materials-count">{#if key === "all"}{counts.all}{:else if key === "results"}{counts.results}{:else}{counts.outdated}{/if}</span>
          </button>
        {/each}
      </div>
      <div class="materials-folders">
        <select class="select" bind:value={folderFilter} aria-label="Folder">
          <option value="">All folders</option>
          <option value={UNFILED}>Unfiled</option>
          {#each folders as folder (folder)}
            <option value={folder}>{folder}</option>
          {/each}
        </select>
        {#if folderFilter !== "" && folderFilter !== UNFILED}
          <button
            class="icon-btn"
            type="button"
            title="Remove this folder"
            aria-label="Remove folder {folderFilter}"
            onclick={() => void projectStore.removeMaterialFolder(folderFilter)}
          >
            <Icon name="trash" size={13} />
          </button>
        {/if}
      </div>
    </div>
  {/if}

  {#if items.length > 0}
    {#each items as item (item.id)}
      {@const derived = derivedBySource.get(item.id) ?? []}
      {@const usedBy = pagesByItem.get(item.id) ?? []}
      {@const action = actionByOutput.get(item.id)}
      <div class="asset-item" class:is-stale={item.stale}>
        <button class="asset-row" type="button" aria-expanded={isExpanded(item.id)} onclick={() => void toggle(item.id)}>
          <Icon name={iconFor(item)} size={13} />
          <span class="asset-name" title={item.name}>{item.name}</span>
          {#if item.stale}<span class="material-chip material-chip-warning">Out of date</span>{/if}
          {#if item.derivedFrom.length > 0}<span class="material-chip">Result</span>{/if}
          <Icon name={isExpanded(item.id) ? "chevron-up" : "chevron-down"} size={13} />
        </button>

        <div class="asset-meta">
          <span class="muted small">{typeLabel(item)}</span>
          <span class="muted small">
            {#if item.revision > 1}Version {item.revision} · {/if}{formatFileSize(item.size)}{#if item.folder} · {item.folder}{/if}
          </span>
        </div>

        {#if item.data}
          <p class="muted small">{dataSummary(item)}</p>
        {/if}

        <div class="asset-status">
          {#if item.status === "processing"}
            <span class="muted small"><span class="spinner"></span> Reading this file…</span>
          {:else if item.status === "error"}
            <span class="error-text small" title={item.error ?? ""}>
              <Icon name="alert" size={12} /> {item.error ?? "Could not read this file"}
            </span>
          {:else if item.extraction}
            <span class="muted small">{extractionLabel(item)}</span>
            <button class="status-link" type="button" onclick={() => (viewingId = item.id)}>View text</button>
          {/if}
        </div>

        {#if sourceFor(item)}
          {@const source = sourceFor(item)!}
          <div class="asset-source muted small">
            <Icon name="link" size={11} />
            {#if source.authorUrl}
              <button class="link-btn" type="button" onclick={() => void openUrl(source.authorUrl!)}>
                {source.author ?? "Photographer"}
              </button>
            {/if}
            {#if source.url}
              <span>·</span>
              <button class="link-btn" type="button" onclick={() => void openUrl(source.url!)}>{providerLabel(source.provider)}</button>
            {/if}
            {#if source.licenseStatus === "unverified"}
              <span>· Reuse rights unverified</span>
            {/if}
          </div>
        {/if}

        {#if isExpanded(item.id)}
          {@const preview = previews[item.id]}
          <div class="material-detail">
            {#if item.derivedFrom.length > 0}
              <p class="muted small">
                Built from {names(item.derivedFrom)}{#if action} · {generatedLabel(item, action)}{/if}
              </p>
            {/if}
            {#if usedBy.length > 0}
              <p class="muted small">Used in {usedBy.join(", ")}</p>
            {/if}
            {#if derived.length > 0}
              <p class="muted small">
                Results from this: {derived.map((entry) => entry.name).join(", ")}{#if derived.some((entry) => entry.stale)} (needs review){/if}
              </p>
            {/if}

            <div class="material-preview">
              {#if preview === null}
                <p class="muted small"><span class="spinner"></span> Loading preview…</p>
              {:else if preview?.kind === "image"}
                <img class="material-image" src={preview.dataUri} alt={item.name} />
              {:else if preview?.kind === "table"}
                {#each preview.sheets as sheet (sheet.name)}
                  {#if preview.sheets.length > 1}<p class="muted small">{sheet.name}</p>{/if}
                  <div class="material-preview-scroll">
                    <table class="material-table">
                      <thead>
                        <tr>{#each sheet.columns as column (column.name)}<th>{column.name}</th>{/each}</tr>
                      </thead>
                      <tbody>
                        {#each sheet.rows as row, rowIndex (rowIndex)}
                          <tr>
                            {#each sheet.columns as _, columnIndex (columnIndex)}
                              <td>{row[columnIndex] ?? ""}</td>
                            {/each}
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/each}
                <p class="muted small">
                  {preview.truncated ? "Only the start of this file is shown. " : ""}The original file is unchanged.
                </p>
              {:else if preview?.kind === "text"}
                <pre class="material-text">{preview.text}{#if preview.truncated}

(Preview ends here.){/if}</pre>
              {:else if preview?.kind === "html"}
                <iframe class="material-frame" srcdoc={preview.html} title={item.name} sandbox=""></iframe>
              {:else if preview}
                <p class="muted small">{preview.note}</p>
              {/if}
            </div>

            {#if action?.code}
              <button class="status-link" type="button" onclick={() => (codeOpen = codeOpen === item.id ? null : item.id)}>
                {codeOpen === item.id ? "Hide what Forma ran" : "See what Forma ran"}
              </button>
              {#if codeOpen === item.id}
                <pre class="material-text material-code">{action.code}</pre>
              {/if}
            {/if}

            <div class="material-foot">
              {#if item.stale}
                <div class="material-actions">
                  <button class="btn" type="button" onclick={() => void projectStore.setContextReviewed(item.id)}>
                    <Icon name="check" size={13} /> Keep as is
                  </button>
                </div>
              {/if}

              <div class="material-actions">
                <button class="btn" type="button" onclick={() => void replace(item.id)}>
                  <Icon name="refresh" size={13} /> Replace file…
                </button>
                <button class="btn" type="button" onclick={() => revealOriginal(item)}>
                  <Icon name="external" size={13} /> Open original
                </button>
                <button class="btn" type="button" onclick={() => requestRemove(item)}>
                  <Icon name="trash" size={13} /> Remove
                </button>
              </div>

              {#if blockedRemove?.id === item.id}
                <div class="material-actions material-confirm" role="alert">
                  <p class="muted small">
                    This material is still used by {blockedRemove.references.join(" and ")}. Remove those results or
                    rebuild those slides without it first; the original file stays until then.
                  </p>
                  <button class="btn" type="button" onclick={() => (blockedRemove = null)}>Close</button>
                </div>
              {/if}

              <label class="material-move">
                <span class="muted small">Folder</span>
                <select
                  class="select"
                  value={item.folder}
                  aria-label="Folder for {item.name}"
                  onchange={(event) => void projectStore.moveContext(item.id, event.currentTarget.value)}
                >
                  <option value="">Unfiled</option>
                  {#each folders as folder (folder)}
                    <option value={folder}>{folder}</option>
                  {/each}
                </select>
              </label>
            </div>
          </div>
        {/if}
      </div>
    {/each}
  {:else if context.length > 0}
    <p class="muted small">No materials match this view.</p>
  {:else}
    <p class="muted small">No project materials yet. Add images, documents, spreadsheets, or information to give Forma a starting point.</p>
  {/if}

  {#if recentActions.length > 0}
    <div class="sources-section">
      <Collapsible title="Recent activity">
        <ul class="sources-list">
          {#each recentActions as entry (entry.id)}
            <li class="material-action-row">
              <span class="source-kind">{entry.kind}</span>
              <span class="source-title">{entry.label}</span>
              {#if entry.detail}<span class="muted small">{entry.detail}</span>{/if}
              {#if entry.code}
                <button class="link-btn" type="button" onclick={() => (codeOpen = codeOpen === entry.id ? null : entry.id)}>
                  {codeOpen === entry.id ? "Hide script" : "Script"}
                </button>
              {/if}
            </li>
            {#if codeOpen === entry.id && entry.code}
              <li><pre class="material-text material-code">{entry.code}</pre></li>
            {/if}
          {/each}
        </ul>
      </Collapsible>
    </div>
  {/if}

  <div class="sources-section">
    <Collapsible title="Sources">
      {#if sources.length === 0}
        <p class="muted small">Research links and photo provenance appear here.</p>
      {:else}
        <ul class="sources-list">
          {#each sources as source (source.id)}
            <li class="source-row">
              <span class="source-kind">{source.kind === "photo" ? "Photo" : "Web"}</span>
              {#if source.url}
                <button class="link-btn source-title" type="button" title={source.url} onclick={() => void openUrl(source.url!)}>
                  {source.title}
                </button>
              {:else}
                <span class="source-title">{source.title}</span>
              {/if}
              {#if source.author}
                <span class="muted small">
                  by
                  {#if source.authorUrl}
                    <button class="link-btn" type="button" onclick={() => void openUrl(source.authorUrl!)}>{source.author}</button>
                  {:else}
                    {source.author}
                  {/if}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </Collapsible>
  </div>
</div>

{#if viewingId}
  <ContextTextDialog id={viewingId} onclose={() => (viewingId = null)} />
{/if}

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />
