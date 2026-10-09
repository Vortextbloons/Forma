<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import ProviderManager from "../models/ProviderManager.svelte";
  import ModelPicker from "../models/ModelPicker.svelte";
  import { workerStore } from "../rig/stores/workerStore.svelte";
  import { restartWorker } from "../rig/bridge";
  import { onMount } from "svelte";

  let {
    initialTab = "providers",
    onclose,
  }: { initialTab?: "providers" | "project"; onclose: () => void } = $props();

  let tab = $state<"providers" | "project">("providers");

  onMount(() => {
    tab = initialTab;
  });

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
        <button
          type="button"
          class:settings-nav-active={tab === "providers"}
          onclick={() => (tab = "providers")}
        >Providers & models</button>
        <button
          type="button"
          class:settings-nav-active={tab === "project"}
          onclick={() => (tab = "project")}
        >Project & app</button>
      </nav>

      <div class="settings-pane">
        {#if tab === "providers"}
          <div class="field">
            <span class="field-label">Providers</span>
            <ProviderManager />
          </div>
          <div class="field">
            <span class="field-label">Model</span>
            <ModelPicker />
          </div>
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
