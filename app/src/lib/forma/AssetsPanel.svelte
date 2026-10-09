<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { pickFiles } from "../rig/native";
  import { CONTEXT_ROLE_LABELS, CONTEXT_ROLE_OPTIONS, formatFileSize } from "./types";
  import type { ContextRole } from "./types";

  let importing = $state(false);
  const project = $derived(projectStore.current?.project);

  async function add(): Promise<void> {
    const paths = await pickFiles("Add assets and context");
    if (paths.length === 0) return;
    importing = true;
    try {
      await projectStore.importContext(paths, "optional");
    } finally {
      importing = false;
    }
  }

  function changeRole(id: string, value: string): void {
    void projectStore.updateContext(id, { role: value as ContextRole });
  }

  function remove(id: string): void {
    void projectStore.removeContext(id);
  }
</script>

<div class="assets-panel">
  <button class="btn btn-accent block" type="button" disabled={importing} onclick={() => void add()}>
    {#if importing}
      <span class="spinner"></span> Importing…
    {:else}
      <Icon name="plus" size={13} /> Add files
    {/if}
  </button>
  <p class="muted small">
    PNG, JPEG, WebP, SVG, PDF, TXT, Markdown. Files are copied into the project.
  </p>

  {#if project && project.context.length > 0}
    {#each project.context as item (item.id)}
      <div class="asset-item">
        <div class="asset-head">
          <Icon name="file" size={13} />
          <span class="asset-name" title={item.name}>{item.name}</span>
          <button
            class="icon-btn"
            type="button"
            title="Remove"
            aria-label="Remove {item.name}"
            onclick={() => remove(item.id)}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
        <div class="asset-meta">
          <select
            class="select"
            aria-label="Role for {item.name}"
            value={item.role}
            onchange={(event) => changeRole(item.id, event.currentTarget.value)}
          >
            {#each CONTEXT_ROLE_OPTIONS as role (role)}
              <option value={role}>{CONTEXT_ROLE_LABELS[role]}</option>
            {/each}
          </select>
          <span class="muted small">{formatFileSize(item.size)}</span>
        </div>
      </div>
    {/each}
  {:else}
    <p class="muted small">No assets or context yet.</p>
  {/if}
</div>
