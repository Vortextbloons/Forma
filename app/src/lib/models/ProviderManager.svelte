<script lang="ts">
  import { providerStore } from "../rig/stores/providerStore.svelte";
  import Icon from "../components/Icon.svelte";
  import InteractionCard from "../conversation/InteractionCard.svelte";
  import { messageStore } from "../rig/stores/messageStore.svelte";
  import type { ProviderInfo } from "../rig/types";

  let { compact = false }: { compact?: boolean } = $props();

  const POPULAR = [
    "openai",
    "anthropic",
    "openrouter",
    "google",
    "xai",
    "groq",
    "mistral",
    "deepseek",
    "opencode",
    "zai",
    "cerebras",
    "together",
  ];

  let query = $state("");
  let addingKeyFor = $state("");
  let keyDraft = $state("");
  let saving = $state(false);
  let keyError = $state("");

  const authInteractions = $derived(messageStore.pendingInteractions(""));

  const sorted = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const matches = providerStore.providers.filter(
      (provider) =>
        !q ||
        provider.id.toLowerCase().includes(q) ||
        (provider.name ?? "").toLowerCase().includes(q),
    );
    const rank = (provider: ProviderInfo): number => {
      const index = POPULAR.indexOf(provider.id);
      return index === -1 ? POPULAR.length : index;
    };
    const list = [...matches].sort((a, b) => {
      if (a.configured !== b.configured) return a.configured ? -1 : 1;
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return (a.name ?? a.id).localeCompare(b.name ?? b.id);
    });
    return compact && q === "" ? list.slice(0, 8) : list;
  });

  const hiddenCount = $derived(
    compact && query.trim() === ""
      ? Math.max(0, providerStore.providers.length - sorted.length)
      : 0,
  );

  function startAddKey(id: string): void {
    addingKeyFor = id;
    keyDraft = "";
    keyError = "";
  }

  function cancelAddKey(): void {
    addingKeyFor = "";
    keyDraft = "";
    keyError = "";
  }

  async function saveKey(id: string): Promise<void> {
    const key = keyDraft.trim();
    if (!key || saving) return;
    saving = true;
    keyError = "";
    try {
      await providerStore.setApiKey(id, key);
      cancelAddKey();
    } catch (error) {
      keyError = error instanceof Error ? error.message : String(error);
    } finally {
      saving = false;
    }
  }

  function browseAll(): void {
    window.dispatchEvent(new CustomEvent("rig:open-provider-settings"));
  }
</script>

<div class="provider-manager">
  {#each authInteractions as interaction (interaction.interaction.id)}
    <InteractionCard sessionId="" state={interaction} />
  {/each}

  {#if providerStore.providers.length > 6}
    <input
      class="input provider-search"
      placeholder="Search providers…"
      aria-label="Search providers"
      bind:value={query}
    />
  {/if}

  {#each sorted as provider (provider.id)}
    <div class="provider-item">
      <div class="provider-info">
        <div class="provider-name">{provider.name ?? provider.id}</div>
        <div class="provider-id">{provider.id}</div>
      </div>
      <span
        class="badge badge-{provider.configured ? 'completed' : 'idle'}"
        title={provider.authStatus}
      >
        {provider.configured ? "connected" : "not configured"}
      </span>
      {#if provider.configured}
        <button
          class="btn btn-sm"
          type="button"
          title="Remove the saved credential for {provider.name ?? provider.id}"
          onclick={() => void providerStore.logout(provider.id)}
          disabled={providerStore.isBusy(provider.id)}
        >remove</button>
      {:else if provider.canSetApiKey}
        <button
          class="btn btn-sm btn-accent"
          type="button"
          onclick={() => startAddKey(provider.id)}
        >Add API key</button>
      {/if}
      {#if !provider.configured && provider.canOAuth}
        <button
          class="btn btn-sm"
          type="button"
          onclick={() => void providerStore.login(provider.id)}
          disabled={providerStore.isBusy(provider.id)}
        >
          {provider.oauthLabel ?? "Sign in"}
        </button>
      {/if}
    </div>

    {#if addingKeyFor === provider.id}
      <form
        class="api-key-form"
        onsubmit={(event) => {
          event.preventDefault();
          void saveKey(provider.id);
        }}
      >
        <input
          class="input"
          type="password"
          placeholder={provider.apiKeyLabel ?? "Paste your API key"}
          aria-label="API key for {provider.name ?? provider.id}"
          autocomplete="off"
          bind:value={keyDraft}
        />
        <button class="btn btn-accent btn-sm" type="submit" disabled={saving || keyDraft.trim() === ""}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button class="btn btn-sm" type="button" onclick={cancelAddKey}>Cancel</button>
      </form>
      {#if keyError}
        <p class="error-text small">{keyError}</p>
      {/if}
    {/if}
  {:else}
    <p class="muted small">No providers match “{query}”.</p>
  {/each}

  {#if compact && hiddenCount > 0}
    <button class="btn btn-sm provider-browse" type="button" onclick={browseAll}>
      <Icon name="plus" size={12} /> Browse all {providerStore.providers.length} providers
    </button>
  {/if}

  <p class="muted small provider-note">
    Credentials are stored by the Pi runtime on this machine, outside your
    projects.
  </p>
</div>
