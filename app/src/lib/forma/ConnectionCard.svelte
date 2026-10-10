<script lang="ts">
  import ProviderManager from "../models/ProviderManager.svelte";
  import { providerStore } from "../rig/stores/providerStore.svelte";

  const loading = $derived(providerStore.providers.length === 0);
  const needsConnection = $derived(
    providerStore.providers.length > 0 &&
      !providerStore.providers.some((provider) => provider.configured),
  );
</script>

{#if needsConnection}
  <div class="connection-card">
    <h2>Connect an AI provider</h2>
    <p>
      Forma uses your own AI account. Add an API key or sign in once, and it
      stays on this machine.
    </p>
    <ProviderManager compact />
  </div>
{:else if loading}
  <p class="muted small">Checking provider connections…</p>
{/if}
