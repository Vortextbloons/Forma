<script lang="ts">
  import Workspace from "../layout/Workspace.svelte";
  import { readDir, readFile, type DirEntry } from "../rig/files";
  import { dataDir } from "../rig/env";

  let entries = $state<DirEntry[]>([]);
  let status = $state("loading…");
  let selected = $state("");
  let preview = $state("");
  let error = $state("");

  async function refresh(): Promise<void> {
    error = "";
    try {
      entries = await readDir(".");
      status = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
    } catch (err) {
      entries = [];
      status = "unavailable";
      error = String(err);
    }
  }

  async function open(name: string): Promise<void> {
    selected = name;
    preview = "";
    try {
      preview = (await readFile(name)).content;
    } catch (err) {
      error = String(err);
    }
  }

  $effect(() => {
    void refresh();
  });
</script>

<div class="app shell">
  <header class="shell-header">
    <span class="brand">Rig</span>
    <span class="path" title={dataDir}>{dataDir || "(RIG_PROJECT_DIR unset)"}</span>
    <button type="button" onclick={() => void refresh()}>Refresh</button>
  </header>

  <Workspace>
    {#snippet sidebar()}
      <div class="list">
        <p class="status">{status}</p>
        {#each entries as entry (entry.path)}
          <button
            type="button"
            class="entry"
            class:selected={entry.path === selected}
            onclick={() => void open(entry.path)}
          >
            <span class="kind">{entry.isDir ? "dir" : "file"}</span>
            <span class="name">{entry.name}</span>
          </button>
        {/each}
      </div>
    {/snippet}
    {#snippet main()}
      <div class="preview">
        {#if error}
          <p class="error">{error}</p>
        {:else if selected}
          <h1>{selected}</h1>
          <pre>{preview}</pre>
        {:else}
          <h1>Hello, data folder</h1>
          <p>
            This is the blank Rig desktop shell (<code>rig add desktop --blank</code>).
            It wires the bridge, stores and the project-scoped FileService
            (<code>src/lib/rig/files.ts</code>). Edit <code>app/src/App.svelte</code>
            and grow the UI from here.
          </p>
        {/if}
      </div>
    {/snippet}
  </Workspace>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
  }

  .shell-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border, #2a2d3a);
  }

  .brand {
    font-weight: 600;
  }

  .path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.7;
    font-family: ui-monospace, monospace;
    font-size: 12px;
  }

  .shell-header button {
    background: transparent;
    border: 1px solid var(--border, #2a2d3a);
    border-radius: 6px;
    color: inherit;
    cursor: pointer;
    padding: 4px 10px;
  }

  .list {
    padding: 8px;
    overflow: auto;
    height: 100%;
  }

  .status {
    opacity: 0.6;
    font-size: 12px;
    margin: 0 0 8px;
  }

  .entry {
    display: flex;
    gap: 8px;
    width: 100%;
    padding: 4px 6px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .entry:hover,
  .entry.selected {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }

  .kind {
    opacity: 0.5;
    font-size: 11px;
    width: 28px;
    flex-shrink: 0;
  }

  .preview {
    padding: 24px;
    overflow: auto;
    height: 100%;
  }

  .preview pre {
    white-space: pre-wrap;
    font-size: 12px;
  }

  .error {
    color: var(--danger, #e5534b);
  }
</style>
