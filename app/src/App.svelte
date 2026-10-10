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
  let settingsTab = $state<"providers" | "search" | "project">("providers");
  const banner = $derived(notificationStore.items[0]);

  const BANNER_TTL_MS = 6000;

  $effect(() => {
    if (!banner) return;
    const id = banner.id;
    const timer = setTimeout(() => notificationStore.dismiss(id), BANNER_TTL_MS);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    void projectStore.loadProjects();
    const onOpenProviders = (): void => {
      settingsTab = "providers";
      showSettings = true;
    };
    const onOpenSearch = (): void => {
      settingsTab = "search";
      showSettings = true;
    };
    window.addEventListener("rig:open-provider-settings", onOpenProviders);
    window.addEventListener("forma:open-search-settings", onOpenSearch);
    return () => {
      window.removeEventListener("rig:open-provider-settings", onOpenProviders);
      window.removeEventListener("forma:open-search-settings", onOpenSearch);
    };
  });
</script>

<div class="app forma-app">
  {#if banner}
    {#key banner.id}
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
    {/key}
  {/if}

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

  {#if showSettings}
    <SettingsDialog initialTab={settingsTab} onclose={() => (showSettings = false)} />
  {/if}
</div>
