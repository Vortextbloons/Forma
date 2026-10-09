<script lang="ts">
  import { modelStore } from "../rig/stores/modelStore.svelte";
  import { providerStore } from "../rig/stores/providerStore.svelte";
  import Icon from "../components/Icon.svelte";

  const selected = $derived(modelStore.selectedInfo());
  const providerId = $derived(modelStore.selectedModel === "auto" ? "auto" : (selected?.provider ?? "auto"));
  const providerOptions = $derived.by(() => {
    const ids = new Set(modelStore.models.map((model) => model.provider));
    return providerStore.providers.filter((provider) => ids.has(provider.id));
  });
  const modelOptions = $derived(
    providerId === "auto" ? [] : modelStore.models.filter((model) => model.provider === providerId),
  );

  function onProvider(event: Event): void {
    const nextProvider = (event.currentTarget as HTMLSelectElement).value;
    if (nextProvider === "auto") void modelStore.select("auto");
    else {
      const first = modelStore.available.find((model) => model.provider === nextProvider)
        ?? modelStore.models.find((model) => model.provider === nextProvider);
      if (first) void modelStore.select(`${first.provider}/${first.id}`);
    }
  }

  function onModel(event: Event): void {
    void modelStore.select((event.currentTarget as HTMLSelectElement).value);
  }
</script>

<div class="model-picker-group">
  <select class="select provider-select" aria-label="Provider" value={providerId} onchange={onProvider}>
    <option value="auto">Auto provider</option>
    {#each providerOptions as provider (provider.id)}
      <option value={provider.id}>{provider.name ?? provider.id}</option>
    {/each}
  </select>
  {#if providerId !== "auto"}
    <select class="select model-select" aria-label="Model" value={modelStore.selectedModel} onchange={onModel}>
      {#each modelOptions as model (`${model.provider}/${model.id}`)}
        <option value={`${model.provider}/${model.id}`}>{model.name ?? model.id}</option>
      {/each}
    </select>
  {/if}
  <button
    class="model-manage-button"
    type="button"
    title="Add or manage providers"
    aria-label="Add or manage providers"
    onclick={() => window.dispatchEvent(new CustomEvent("rig:open-provider-settings"))}
  ><Icon name="plus" size={13} /></button>
</div>
