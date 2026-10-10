<script lang="ts">
  import { modelStore } from "../rig/stores/modelStore.svelte";
  import { providerStore } from "../rig/stores/providerStore.svelte";
  import Icon from "../components/Icon.svelte";
  import type { ModelInfo } from "../rig/types";

  let { onselect }: { onselect?: () => void } = $props();

  const connected = $derived.by(() => {
    const ids = new Set(modelStore.models.map((model) => model.provider));
    const list: Array<{ id: string; name: string }> = [];
    for (const provider of providerStore.providers) {
      if (provider.configured && ids.has(provider.id)) {
        list.push({ id: provider.id, name: provider.name ?? provider.id });
      }
    }
    return list;
  });

  const pool = $derived(modelStore.available.length > 0 ? modelStore.available : modelStore.models);

  let hoveredRow = $state<"provider" | "model" | null>(null);

  const selectedInfo = $derived(
    modelStore.selectedModel === "auto" ? undefined : modelStore.selectedInfo(),
  );
  const providerValue = $derived(
    selectedInfo
      ? (providerStore.providers.find((p) => p.id === selectedInfo.provider)?.name ??
          selectedInfo.provider)
      : "Auto",
  );
  const modelValue = $derived(
    modelStore.selectedModel === "auto"
      ? "Auto"
      : (selectedInfo?.name ?? modelStore.selectedModel),
  );

  const activeProvider = $derived(selectedInfo?.provider ?? "auto");
  const models = $derived(pool.filter((model) => model.provider === activeProvider));

  let query = $state("");
  const normalizedQuery = $derived(query.trim().toLowerCase());
  const providerMatches = $derived(
    connected.filter((provider) => provider.name.toLowerCase().includes(normalizedQuery)),
  );
  const modelMatches = $derived(
    models.filter(
      (model) =>
        (model.name ?? model.id).toLowerCase().includes(normalizedQuery) ||
        model.id.toLowerCase().includes(normalizedQuery),
    ),
  );

  let searchEl: HTMLInputElement | undefined = $state();
  let leaveTimer: number | undefined;

  $effect(() => {
    if (hoveredRow) searchEl?.focus();
    return () => window.clearTimeout(leaveTimer);
  });

  function clearSearch(): void {
    query = "";
  }

  function scheduleClear(): void {
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => {
      hoveredRow = null;
      clearSearch();
    }, 150);
  }

  function cancelClear(): void {
    window.clearTimeout(leaveTimer);
  }

  function refOf(model: ModelInfo): string {
    return `${model.provider}/${model.id}`;
  }

  function pickProvider(id: string): void {
    const match = pool.find((model) => model.provider === id);
    if (match) choose(match);
  }

  function chooseAuto(): void {
    void modelStore.select("auto");
    onselect?.();
  }

  function choose(model: ModelInfo): void {
    void modelStore.select(refOf(model));
    onselect?.();
  }
</script>

<div
  class="model-picker"
  onpointerleave={scheduleClear}
  onpointerenter={cancelClear}
>
  <div class="model-picker-rows">
    <div
      class="model-menu-row"
      role="button"
      tabindex="0"
      aria-haspopup="listbox"
      aria-expanded={hoveredRow === "provider"}
      onpointerenter={() => { hoveredRow = "provider"; clearSearch(); }}
    >
      <span class="model-menu-label">Provider</span>
      <span class="model-menu-value">{providerValue}</span>
      <Icon name="chevron-right" size={12} />
    </div>
    <div
      class="model-menu-row"
      role="button"
      tabindex="0"
      aria-haspopup="listbox"
      aria-expanded={hoveredRow === "model"}
      onpointerenter={() => { hoveredRow = "model"; clearSearch(); }}
    >
      <span class="model-menu-label">Model</span>
      <span class="model-menu-value">{modelValue}</span>
      <Icon name="chevron-right" size={12} />
    </div>
  </div>
  {#if hoveredRow}
    <div
      class="model-pane model-menu-list"
      role="listbox"
      aria-label={hoveredRow === "model" ? "Models" : "Providers"}
    >
      <input
        class="model-menu-search"
        type="text"
        placeholder={hoveredRow === "model" ? "Search models…" : "Search providers…"}
        bind:this={searchEl}
        bind:value={query}
      />
      {#if hoveredRow === "model"}
        <button
          class="model-option"
          class:model-option-selected={modelStore.selectedModel === "auto"}
          type="button"
          onclick={chooseAuto}
        >
          <span class="model-option-name">Auto</span>
        </button>
        {#each modelMatches as model (refOf(model))}
          <button
            class="model-option"
            class:model-option-selected={modelStore.selectedModel === refOf(model)}
            type="button"
            aria-pressed={modelStore.selectedModel === refOf(model)}
            onclick={() => choose(model)}
          >
            <span class="model-option-name">{model.name ?? model.id}</span>
            {#if model.contextWindow}
              <span class="model-option-meta">{Math.round(model.contextWindow / 1000)}k</span>
            {/if}
          </button>
        {:else}
          <p class="model-picker-empty muted small">
            {activeProvider === "auto"
              ? "Pick a provider first."
              : normalizedQuery
                ? "No matching models."
                : "No models."}
          </p>
        {/each}
      {:else}
        <button
          class="model-option"
          class:model-option-selected={activeProvider === "auto"}
          type="button"
          onclick={chooseAuto}
        >
          <span class="model-option-name">Auto</span>
        </button>
        {#each providerMatches as provider (provider.id)}
          <button
            class="model-option"
            class:model-option-selected={activeProvider === provider.id}
            type="button"
            onclick={() => pickProvider(provider.id)}
          >
            <span class="model-option-name">{provider.name}</span>
          </button>
        {:else}
          <p class="model-picker-empty muted small">
            {normalizedQuery ? "No matching providers." : "No connected providers."}
          </p>
        {/each}
      {/if}
    </div>
  {/if}
</div>