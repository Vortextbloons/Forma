<script lang="ts">
  import NewProjectForm from "./NewProjectForm.svelte";
  import ConnectionCard from "./ConnectionCard.svelte";
  import PageIcon from "./PageIcon.svelte";
  import Icon from "../components/Icon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { pickDirectory } from "../rig/native";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";

  let { onOpenSettings }: { onOpenSettings: () => void } = $props();

  let opening = $state(false);
  let openingPath = $state("");

  async function openExisting(dir?: string): Promise<void> {
    const target = dir ?? (await pickDirectory("Open a Forma project folder"));
    if (!target || opening) return;
    opening = true;
    openingPath = target;
    try {
      await projectStore.openProject(target);
    } catch (error) {
      notificationStore.push({
        type: "error",
        message: `Could not open project: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      opening = false;
      openingPath = "";
    }
  }

  async function forget(dir: string): Promise<void> {
    await projectStore.forgetRecent(dir);
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

      <div class="start-actions">
        <button class="btn" type="button" disabled={opening} onclick={() => void openExisting()}>
          <Icon name="folder" size={14} /> Open project…
        </button>
      </div>

      <ConnectionCard />

      <section class="recent-section">
        <h2 class="section-heading">Recent projects</h2>
        {#if projectStore.recent.length === 0}
          <p class="muted small">No recent projects yet.</p>
        {:else}
          <ul class="recent-list">
            {#each projectStore.recent as item (item.path)}
              <li>
                <button
                  class="recent-open"
                  type="button"
                  disabled={opening}
                  onclick={() => void openExisting(item.path)}
                >
                  {#if item.output === "poster"}
                    <PageIcon width={1080} height={1350} size={18} />
                  {:else}
                    <PageIcon width={1920} height={1080} size={18} />
                  {/if}
                  <span class="recent-text">
                    <span class="recent-name">{item.name}</span>
                    <span class="recent-path" title={item.path}>{item.path}</span>
                  </span>
                  {#if opening && openingPath === item.path}
                    <span class="spinner"></span>
                  {/if}
                </button>
                <button
                  class="icon-btn"
                  type="button"
                  title="Remove from list"
                  aria-label="Remove {item.name} from recent projects"
                  onclick={() => void forget(item.path)}
                >
                  <Icon name="x" size={13} />
                </button>
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
