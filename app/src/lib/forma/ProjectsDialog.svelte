<script lang="ts">
  import { sendCommand } from "../rig/bridge";
  import Logo from "../components/Logo.svelte";
  import { effectiveSize } from "../../../../src/projects/size.ts";
  import Icon from "../components/Icon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";
  import { OUTPUT_LABELS } from "./types";
  import type { ProjectListEntry } from "./types";

  let { onclose }: { onclose: () => void } = $props();

  let covers = $state<Record<string, string>>({});
  let coverWidth = $state(0);
  let query = $state("");
  let opening = $state(false);
  let openingPath = $state("");
  let renamingPath = $state("");
  let renameDraft = $state("");
  let armedDelete = $state("");

  const filtered = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projectStore.projects;
    return projectStore.projects.filter((entry) => entry.project.name.toLowerCase().includes(needle));
  });

  $effect(() => {
    const projects = projectStore.projects;
    let cancelled = false;
    void Promise.all(projects.filter((entry) => entry.project.pages.length > 0).map(async (entry) => {
      try {
        const result = await sendCommand("artwork.compose", { dir: entry.dir, pageId: entry.project.pages[0] }) as { html: string };
        return [entry.dir, result.html] as const;
      } catch {
        return [entry.dir, ""] as const;
      }
    })).then((results) => { if (!cancelled) covers = Object.fromEntries(results); });
    return () => { cancelled = true; };
  });

  function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function dateLabel(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function focusOnMount(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }

  async function open(entry: ProjectListEntry): Promise<void> {
    if (opening) return;
    opening = true;
    openingPath = entry.dir;
    try {
      await projectStore.openProject(entry.dir);
    } catch (error) {
      notificationStore.push({
        type: "error",
        message: `Could not open project: ${message(error)}`,
      });
    } finally {
      opening = false;
      openingPath = "";
    }
  }

  function startRename(entry: ProjectListEntry): void {
    renamingPath = entry.dir;
    renameDraft = entry.project.name;
  }

  async function commitRename(): Promise<void> {
    const dir = renamingPath;
    const name = renameDraft.trim();
    renamingPath = "";
    renameDraft = "";
    if (!dir || !name) return;
    try {
      await projectStore.renameProject(dir, name);
    } catch (error) {
      notificationStore.push({ type: "error", message: `Could not rename project: ${message(error)}` });
    }
  }

  async function duplicate(entry: ProjectListEntry): Promise<void> {
    try {
      await projectStore.duplicateProject(entry.dir);
    } catch (error) {
      notificationStore.push({ type: "error", message: `Could not duplicate project: ${message(error)}` });
    }
  }

  async function remove(entry: ProjectListEntry): Promise<void> {
    if (armedDelete !== entry.dir) {
      armedDelete = entry.dir;
      setTimeout(() => {
        if (armedDelete === entry.dir) armedDelete = "";
      }, 4000);
      return;
    }
    armedDelete = "";
    try {
      await projectStore.deleteProject(entry.dir);
    } catch (error) {
      notificationStore.push({ type: "error", message: `Could not delete project: ${message(error)}` });
    }
  }
</script>

<div
  class="modal-overlay"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose();
  }}
  onkeydown={(event) => {
    if (event.key === "Escape") onclose();
  }}
>
  <div class="modal projects-modal" role="dialog" aria-modal="true" aria-label="Your projects" tabindex="-1">
    <div class="modal-head">
      <span class="modal-title">Your projects</span>
      <button
        class="icon-btn"
        type="button"
        title="Close"
        aria-label="Close projects"
        onclick={onclose}
      >
        <Icon name="x" size={16} />
      </button>
    </div>

    <div class="projects-search">
      <Icon name="search" size={14} />
      <input
        class="input projects-search-input"
        type="search"
        placeholder="Search projects"
        bind:value={query}
      />
    </div>

    <div class="modal-body projects-body">
      {#if projectStore.projects.length === 0}
        <div class="projects-empty">
          <Logo size={32} withWordmark={false} />
          <p class="muted small">Your first project starts with a title and an idea. Saved projects will appear here.</p>
        </div>
      {:else if filtered.length === 0}
        <p class="muted small">No projects match “{query}”.</p>
      {:else}
        <ul class="cover-grid projects-grid">
          {#each filtered as entry (entry.dir)}
            {@const size = effectiveSize(entry.project.settings)}
            <li class="cover-cell">
              {#if renamingPath === entry.dir}
                <form
                  class="rename-row"
                  onsubmit={(event) => {
                    event.preventDefault();
                    void commitRename();
                  }}
                >
                  <input
                    class="input rename-input"
                    type="text"
                    bind:value={renameDraft}
                    use:focusOnMount
                    onkeydown={(event) => {
                      if (event.key === "Escape") renamingPath = "";
                    }}
                    aria-label="Project name"
                  />
                  <button class="icon-btn" type="submit" title="Save name" aria-label="Save name">
                    <Icon name="check" size={13} />
                  </button>
                  <button
                    class="icon-btn"
                    type="button"
                    title="Cancel"
                    aria-label="Cancel rename"
                    onclick={() => (renamingPath = "")}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </form>
              {:else}
                <button
                  class="project-cover"
                  type="button"
                  disabled={opening}
                  onclick={() => void open(entry)}
                >
                  <span
                    class="cover-art cover-{entry.project.settings.output} cover-style-{entry.project.settings.style}"
                    class:opening={opening && openingPath === entry.dir}
                    style:aspect-ratio={size.width / size.height}
                    bind:clientWidth={coverWidth}
                  >
                    {#if covers[entry.dir]}
                      <iframe class="cover-preview" title={entry.project.name + " preview"} srcdoc={covers[entry.dir]} sandbox="" tabindex="-1" aria-hidden="true" style={`width:${size.width}px;height:${size.height}px;transform:scale(${coverWidth / size.width});`}></iframe>
                    {:else}
                    <span class="cover-format">{OUTPUT_LABELS[entry.project.settings.output]}</span>
                    <span class="cover-a"></span>
                    <span class="cover-b"></span>
                    <span class="cover-c"></span>
                    {/if}
                    {#if opening && openingPath === entry.dir}
                      <span class="spinner cover-spinner"></span>
                    {/if}
                  </span>
                  <span class="cover-name">{entry.project.name}</span>
                  <span class="cover-meta">
                    {OUTPUT_LABELS[entry.project.settings.output]} · {dateLabel(entry.project.updatedAt)}
                  </span>
                </button>
                <span class="project-actions">
                  <button
                    class="icon-btn"
                    type="button"
                    title="Rename"
                    aria-label="Rename {entry.project.name}"
                    onclick={() => startRename(entry)}
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                  <button
                    class="icon-btn"
                    type="button"
                    title="Duplicate"
                    aria-label="Duplicate {entry.project.name}"
                    onclick={() => void duplicate(entry)}
                  >
                    <Icon name="copy" size={13} />
                  </button>
                  <button
                    class="icon-btn delete-armed"
                    type="button"
                    title={armedDelete === entry.dir ? "Click again to delete" : "Delete"}
                    aria-label={armedDelete === entry.dir
                      ? `Click again to delete ${entry.project.name}`
                      : `Delete ${entry.project.name}`}
                    onclick={() => void remove(entry)}
                  >
                    <Icon name={armedDelete === entry.dir ? "alert" : "trash"} size={13} />
                  </button>
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>

<style>
  .projects-modal {
    width: min(880px, calc(100vw - 48px));
  }

  .projects-body {
    flex-direction: column;
    gap: 16px;
    padding: 20px 22px;
  }

  .projects-search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 14px 22px 0;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--muted);
  }

  .projects-search-input {
    min-height: 34px;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .projects-grid {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 18px;
  }
</style>
