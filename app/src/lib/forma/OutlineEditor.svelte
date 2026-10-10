<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { CONTEXT_ROLE_LABELS } from "./types";

  interface DraftEntry {
    id?: string;
    title: string;
    points: string[];
    visualDirection: string;
    assetIds: string[];
  }

  const project = $derived(projectStore.current?.project);
  const context = $derived(project?.context ?? []);
  const isPoster = $derived(project?.settings.output === "poster");
  const run = $derived(projectStore.run);
  const generating = $derived(run !== null);

  let entries = $state<DraftEntry[]>([]);
  let pointsText = $state<Record<number, string>>({});
  let dirty = $state(false);
  let lastSynced = "";
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let dragIndex = $state<number | null>(null);

  function signature(outline: unknown): string {
    return JSON.stringify(outline ?? null);
  }

  function toDraft(outline: NonNullable<typeof project>["outline"]): DraftEntry[] {
    return (outline ?? []).map((entry) => ({
      id: entry.id,
      title: entry.title,
      points: [...entry.points],
      visualDirection: entry.visualDirection ?? "",
      assetIds: [...entry.assetIds],
    }));
  }

  $effect(() => {
    const outline = project?.outline ?? null;
    const sig = signature(outline);
    if (sig === lastSynced) return;
    lastSynced = sig;
    entries = toDraft(outline);
    pointsText = {};
    dirty = false;
  });

  function scheduleSave(): void {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void save();
    }, 600);
  }

  async function save(): Promise<void> {
    if (!dirty) return;
    await projectStore.updateOutline(
      entries.map((entry) => ({
        ...(entry.id ? { id: entry.id } : {}),
        title: entry.title,
        points: entry.points,
        ...(entry.visualDirection ? { visualDirection: entry.visualDirection } : {}),
        assetIds: entry.assetIds,
      })),
    );
    const serverSig = signature(projectStore.current?.project.outline ?? null);
    lastSynced = serverSig;
    if (!dirty) {
      entries = toDraft(projectStore.current?.project.outline ?? null);
      pointsText = {};
    }
    dirty = false;
  }

  function pointsFor(index: number): string {
    return pointsText[index] ?? entries[index]?.points.join("\n") ?? "";
  }

  function setPoints(index: number, text: string): void {
    pointsText = { ...pointsText, [index]: text };
    const entry = entries[index];
    if (!entry) return;
    entry.points = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    scheduleSave();
  }

  function addEntry(after: number): void {
    entries.splice(after + 1, 0, {
      title: isPoster ? "Poster" : `Slide ${entries.length + 1}`,
      points: [],
      visualDirection: "",
      assetIds: [],
    });
    pointsText = {};
    scheduleSave();
  }

  function removeEntry(index: number): void {
    entries.splice(index, 1);
    pointsText = {};
    scheduleSave();
  }

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= entries.length) return;
    const [entry] = entries.splice(index, 1);
    if (!entry) return;
    entries.splice(target, 0, entry);
    pointsText = {};
    scheduleSave();
  }

  function drop(index: number): void {
    const from = dragIndex;
    dragIndex = null;
    if (from === null || from === index) return;
    const [entry] = entries.splice(from, 1);
    if (!entry) return;
    entries.splice(index, 0, entry);
    pointsText = {};
    scheduleSave();
  }

  function toggleAsset(index: number, assetId: string): void {
    const entry = entries[index];
    if (!entry) return;
    const existing = entry.assetIds.indexOf(assetId);
    if (existing === -1) entry.assetIds = [...entry.assetIds, assetId];
    else entry.assetIds = entry.assetIds.filter((id) => id !== assetId);
    scheduleSave();
  }
</script>

<div class="outline-editor">
  <header class="outline-head">
    <span class="outline-kicker">{isPoster ? "Composition brief" : `Outline · ${entries.length} slides`}</span>
    <span class="spacer"></span>
    {#if projectStore.saveStatus === "saving"}
      <span class="muted small">Saving…</span>
    {:else if projectStore.saveStatus === "error"}
      <span class="error-text small">Not saved</span>
    {/if}
  </header>

  <div class="outline-list">
    {#each entries as entry, index (entry.id ?? `new-${index}`)}
      <article
        class="outline-card"
        draggable="true"
        ondragstart={() => (dragIndex = index)}
        ondragover={(event) => event.preventDefault()}
        ondrop={(event) => {
          event.preventDefault();
          drop(index);
        }}
      >
        <div class="outline-card-head">
          <span class="outline-number">{index + 1}</span>
          <input
            class="input outline-title"
            type="text"
            value={entry.title}
            placeholder={isPoster ? "Poster headline" : "Slide title"}
            aria-label={isPoster ? "Poster headline" : `Slide ${index + 1} title`}
            oninput={(event) => {
              entry.title = event.currentTarget.value;
              scheduleSave();
            }}
          />
          <div class="outline-actions">
            <button
              class="icon-btn"
              type="button"
              title="Move up"
              aria-label={`Move ${isPoster ? "brief" : `slide ${index + 1}`} up`}
              disabled={index === 0}
              onclick={() => move(index, -1)}
            >
              <Icon name="chevron-up" size={13} />
            </button>
            <button
              class="icon-btn"
              type="button"
              title="Move down"
              aria-label={`Move ${isPoster ? "brief" : `slide ${index + 1}`} down`}
              disabled={index === entries.length - 1}
              onclick={() => move(index, 1)}
            >
              <Icon name="chevron-down" size={13} />
            </button>
            <button
              class="icon-btn"
              type="button"
              title="Remove"
              aria-label={`Remove ${isPoster ? "brief" : `slide ${index + 1}`}`}
              disabled={entries.length === 1}
              onclick={() => removeEntry(index)}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        </div>

        <label class="outline-field">
          <span class="outline-label">Key points</span>
          <textarea
            class="input textarea outline-points"
            rows="3"
            value={pointsFor(index)}
            placeholder="One point per line"
            oninput={(event) => setPoints(index, event.currentTarget.value)}
          ></textarea>
        </label>

        <label class="outline-field">
          <span class="outline-label">Visual direction</span>
          <input
            class="input"
            type="text"
            value={entry.visualDirection}
            placeholder={isPoster ? "How the poster should be composed" : "How this slide should look"}
            oninput={(event) => {
              entry.visualDirection = event.currentTarget.value;
              scheduleSave();
            }}
          />
        </label>

        {#if context.length > 0}
          <div class="outline-assets">
            <span class="outline-label">Context</span>
            <div class="asset-chips">
              {#each context as item (item.id)}
                <button
                  type="button"
                  class="asset-chip"
                  class:active={entry.assetIds.includes(item.id)}
                  aria-pressed={entry.assetIds.includes(item.id)}
                  title={`${CONTEXT_ROLE_LABELS[item.role]} · ${item.name}`}
                  onclick={() => toggleAsset(index, item.id)}
                >
                  {#if item.role === "must-include"}<span class="chip-dot" aria-hidden="true"></span>{/if}
                  {item.name}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </article>
    {/each}
  </div>

  {#if !isPoster}
    <button class="btn btn-ghost block" type="button" onclick={() => addEntry(entries.length - 1)}>
      <Icon name="plus" size={13} /> Add slide
    </button>
  {/if}

  <div class="outline-footer">
    <button
      class="btn btn-accent"
      type="button"
      disabled={generating || entries.length === 0}
      onclick={() => void projectStore.generate()}
    >
      {#if generating}<span class="spinner"></span>{/if}
      {isPoster ? "Create the poster" : `Generate ${entries.length} slides`}
    </button>
    <button
      class="btn btn-ghost"
      type="button"
      disabled={generating}
      title="Ask Forma to replace the outline with a new draft"
      onclick={() => void projectStore.plan()}
    >
      Redraft with Forma
    </button>
  </div>
  <p class="muted small">
    Generated pages follow this outline's order. Changes here are saved automatically.
  </p>
</div>
