<script lang="ts">
  import { providerStore } from "../rig/stores/providerStore.svelte";
  import Icon from "../components/Icon.svelte";
  import InteractionCard from "../conversation/InteractionCard.svelte";
  import { messageStore } from "../rig/stores/messageStore.svelte";

  const authInteractions = $derived(messageStore.pendingInteractions(""));

  function authBadge(configured: boolean, authStatus: string): string {
    if (!configured) return "idle";
    const s = authStatus.toLowerCase();
    if (s.includes("ready") || s.includes("ok") || s.includes("valid")) return "completed";
    if (s.includes("error") || s.includes("expired") || s.includes("invalid")) return "failed";
    return "waiting";
  }

  function authLabel(configured: boolean, authStatus: string): string {
    if (!configured) return "not configured";
    return authStatus || "unknown";
  }
</script>

<div style="display:flex;flex-direction:column;gap:6px">
  {#each authInteractions as interaction (interaction.interaction.id)}
    <InteractionCard sessionId="" state={interaction} />
  {/each}
  {#each providerStore.providers as provider (provider.id)}
    <div class="provider-item">
      <div class="provider-info">
        <div class="provider-name">{provider.name ?? provider.id}</div>
        <div class="provider-id">{provider.id}</div>
      </div>
      <span class="badge badge-{authBadge(provider.configured, provider.authStatus)}">
        {authLabel(provider.configured, provider.authStatus)}
      </span>
      {#if provider.configured}
        <button
          class="btn btn-sm"
          type="button"
          onclick={() => void providerStore.logout(provider.id)}
          disabled={providerStore.isBusy(provider.id)}
        >
          logout
        </button>
      {:else}
        <button
          class="btn btn-sm btn-accent"
          type="button"
          onclick={() => void providerStore.login(provider.id)}
          disabled={providerStore.isBusy(provider.id)}
        >
          login
        </button>
      {/if}
    </div>
  {:else}
    <span class="muted" style="font-size:12px">no providers reported</span>
  {/each}
  <div>
    <button class="btn btn-sm" type="button" onclick={() => void providerStore.refresh()}>
      <Icon name="refresh" size={13} />
      refresh
    </button>
  </div>
</div>
