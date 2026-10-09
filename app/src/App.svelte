<script lang="ts">
  import StartScreen from "./lib/forma/StartScreen.svelte";
  import WorkspaceScreen from "./lib/forma/WorkspaceScreen.svelte";
  import SettingsDialog from "./lib/forma/SettingsDialog.svelte";
  import Icon from "./lib/components/Icon.svelte";
  import { projectStore } from "./lib/forma/projectStore.svelte";
  import { notificationStore } from "./lib/rig/stores/notificationStore.svelte";
  import { getBridge } from "./lib/rig/bridge";

  getBridge();

  let showSettings = $state(false);
  let settingsTab = $state<"providers" | "project">("providers");
  const banner = $derived(notificationStore.items[0]);

  $effect(() => {
    void projectStore.loadRecent();
    const onOpenProviders = (): void => {
      settingsTab = "providers";
      showSettings = true;
    };
    window.addEventListener("rig:open-provider-settings", onOpenProviders);
    return () => window.removeEventListener("rig:open-provider-settings", onOpenProviders);
  });
</script>

<div class="app forma-app">
  {#if projectStore.current}
    <WorkspaceScreen
      onOpenSettings={() => {
        settingsTab = "project";
        showSettings = true;
      }}
      onCloseProject={() => projectStore.closeProject()}
    />
  {:else}
    <StartScreen
      onOpenSettings={() => {
        settingsTab = "providers";
        showSettings = true;
      }}
    />
  {/if}

  {#if banner}
    <div class="banner forma-banner banner-{banner.type}">
      <Icon name={banner.type === "error" ? "alert" : banner.type === "success" ? "check" : "message"} size={14} />
      <span class="banner-text">{banner.message}</span>
      <button
        class="icon-btn"
        type="button"
        title="Dismiss"
        aria-label="Dismiss banner"
        onclick={() => notificationStore.dismiss(banner.id)}
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  {/if}

  {#if showSettings}
    <SettingsDialog initialTab={settingsTab} onclose={() => (showSettings = false)} />
  {/if}
</div>
