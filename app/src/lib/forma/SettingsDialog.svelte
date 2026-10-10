<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import ProviderManager from "../models/ProviderManager.svelte";
  import ModelPicker from "../models/ModelPicker.svelte";
  import AssetsPanel from "./AssetsPanel.svelte";
  import DesignPanel from "./DesignPanel.svelte";
  import { workerStore } from "../rig/stores/workerStore.svelte";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";
  import { restartWorker } from "../rig/bridge";
  import { projectStore } from "./projectStore.svelte";
  import type { SearchProviderId } from "./types";
  import { onMount } from "svelte";

  let {
    initialTab = "providers",
    onclose,
  }: {
    initialTab?: "providers" | "search" | "project" | "design" | "assets";
    onclose: () => void;
  } = $props();

  let tab = $state<"providers" | "search" | "project" | "design" | "assets">("providers");
  let exaKey = $state("");
  let pexelsKey = $state("");
  let saving = $state<SearchProviderId | null>(null);

  const credentials = $derived(projectStore.searchCredentials);

  onMount(() => {
    tab = initialTab;
    void projectStore.refreshSearchCredentials();
  });

  async function saveKey(provider: SearchProviderId): Promise<void> {
    const key = provider === "exa" ? exaKey : pexelsKey;
    if (!key.trim()) return;
    saving = provider;
    try {
      await projectStore.setSearchKey(provider, key.trim());
      if (provider === "exa") exaKey = "";
      else pexelsKey = "";
      notificationStore.push({
        type: "success",
        message: `${provider === "exa" ? "Exa" : "Pexels"} key saved`,
      });
    } catch (error) {
      notificationStore.push({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      saving = null;
    }
  }

  async function clearKey(provider: SearchProviderId): Promise<void> {
    try {
      await projectStore.clearSearchKey(provider);
    } catch (error) {
      notificationStore.push({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function onOverlayKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") onclose();
  }
</script>

<div
  class="modal-overlay"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose();
  }}
  onkeydown={onOverlayKeydown}
>
  <div
    class="modal forma-settings"
    role="dialog"
    aria-modal="true"
    aria-label="Settings"
    tabindex="-1"
  >
    <div class="modal-head">
      <span class="modal-title">Settings</span>
      <button class="icon-btn" type="button" title="Close" aria-label="Close settings" onclick={onclose}>
        <Icon name="x" size={16} />
      </button>
    </div>
    <div class="modal-body">
      <nav class="settings-nav" aria-label="Settings sections">
        {#if projectStore.current}
          <button type="button" class:settings-nav-active={tab === "design"} onclick={() => (tab = "design")}>Design</button>
          <button type="button" class:settings-nav-active={tab === "assets"} onclick={() => (tab = "assets")}>References</button>
        {/if}
        <button
          type="button"
          class:settings-nav-active={tab === "providers"}
          onclick={() => (tab = "providers")}
        >Providers & models</button>
        <button
          type="button"
          class:settings-nav-active={tab === "search"}
          onclick={() => (tab = "search")}
        >Search credentials</button>
        <button
          type="button"
          class:settings-nav-active={tab === "project"}
          onclick={() => (tab = "project")}
        >App & worker</button>
      </nav>

      <div class="settings-pane">
        {#if tab === "design"}
          <DesignPanel />
        {:else if tab === "assets"}
          <AssetsPanel />
        {:else if tab === "providers"}
          <div class="field">
            <span class="field-label">Providers</span>
            <ProviderManager />
          </div>
          <div class="field">
            <span class="field-label">Model</span>
            <ModelPicker />
          </div>
        {:else if tab === "search"}
          <div class="field">
            <span class="field-label">Exa — research</span>
            <p class="muted small">
              Used by the research tools when Research is enabled for a project.
              {#if credentials.exa.configured}
                <span class="badge">Configured · {credentials.exa.masked}</span>
              {:else}
                <span class="badge">Not configured</span>
              {/if}
            </p>
            <div class="field-row">
              <input
                class="input"
                type="password"
                placeholder="Exa API key"
                bind:value={exaKey}
                aria-label="Exa API key"
              />
              <button
                class="btn"
                type="button"
                disabled={saving !== null || exaKey.trim() === ""}
                onclick={() => void saveKey("exa")}
              >Save</button>
              {#if credentials.exa.configured}
                <button class="btn btn-ghost" type="button" onclick={() => void clearKey("exa")}>Remove</button>
              {/if}
            </div>
          </div>
          <div class="field">
            <span class="field-label">Pexels — image search</span>
            <p class="muted small">
              Used by photo search when Image search is enabled for a project.
              {#if credentials.pexels.configured}
                <span class="badge">Configured · {credentials.pexels.masked}</span>
              {:else}
                <span class="badge">Not configured</span>
              {/if}
            </p>
            <div class="field-row">
              <input
                class="input"
                type="password"
                placeholder="Pexels API key"
                bind:value={pexelsKey}
                aria-label="Pexels API key"
              />
              <button
                class="btn"
                type="button"
                disabled={saving !== null || pexelsKey.trim() === ""}
                onclick={() => void saveKey("pexels")}
              >Save</button>
              {#if credentials.pexels.configured}
                <button class="btn btn-ghost" type="button" onclick={() => void clearKey("pexels")}>Remove</button>
              {/if}
            </div>
          </div>
          <p class="muted small">
            Keys are stored per user, outside projects, and protected with Windows DPAPI.
          </p>
        {:else}
          <div class="field">
            <span class="field-label">Worker</span>
            <div class="field-row">
              <span class="badge badge-{workerStore.status}">{workerStore.status}</span>
              <button class="btn" type="button" onclick={() => void restartWorker()}>Restart worker</button>
            </div>
          </div>
          <div class="field">
            <span class="field-label">Project directory</span>
            <div class="mono small">{workerStore.readyInfo?.projectDir ?? "—"}</div>
          </div>
          <div class="field">
            <span class="field-label">Agent</span>
            <div>{workerStore.readyInfo?.agentName ?? "—"}</div>
          </div>
          {#if workerStore.lastError}
            <div class="field">
              <span class="field-label">Last error</span>
              <div class="error-text small">{workerStore.lastError.message}</div>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</div>
