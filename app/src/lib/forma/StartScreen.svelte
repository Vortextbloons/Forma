<script lang="ts">
  import NewProjectForm from "./NewProjectForm.svelte";
  import ConnectionCard from "./ConnectionCard.svelte";
  import PageIcon from "./PageIcon.svelte";
  import Icon from "../components/Icon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";
  import type { ProjectListEntry } from "./types";

  let { onOpenSettings }: { onOpenSettings: () => void } = $props();

  let opening = $state(false);
  let openingPath = $state("");
  let renamingPath = $state("");
  let renameDraft = $state("");
  let armedDelete = $state("");

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

<div class="start-screen">
  <header class="start-header">
    <span class="forma-wordmark">Forma</span>
    <span class="spacer"></span>
    <button class="btn btn-ghost" type="button" onclick={onOpenSettings}>
      <Icon name="gear" size={14} /> Settings
    </button>
  </header>

  <main class="start-main">
    <section class="start-left">
      <h1 class="start-tagline">Presentations and posters, composed for you.</h1>
      <p class="start-copy">
        Describe the result. Forma plans the structure, creates the artwork,
        and refines it with you through chat.
      </p>

      <ConnectionCard />

      <section class="recent-section">
        <h2 class="section-heading">Projects</h2>
        {#if projectStore.projects.length === 0}
          <p class="muted small">No projects yet. Create one on the right.</p>
        {:else}
          <ul class="recent-list">
            {#each projectStore.projects as entry (entry.dir)}
              <li>
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
                    class="recent-open"
                    type="button"
                    disabled={opening}
                    onclick={() => void open(entry)}
                  >
                    {#if entry.project.settings.output === "poster"}
                      <PageIcon width={1080} height={1350} size={18} />
                    {:else}
                      <PageIcon width={1920} height={1080} size={18} />
                    {/if}
                    <span class="recent-text">
                      <span class="recent-name">{entry.project.name}</span>
                      <span class="recent-path">{dateLabel(entry.project.updatedAt)}</span>
                    </span>
                    {#if opening && openingPath === entry.dir}
                      <span class="spinner"></span>
                    {/if}
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
      </section>
    </section>

    <section class="start-right">
      <NewProjectForm />
    </section>
  </main>
</div>