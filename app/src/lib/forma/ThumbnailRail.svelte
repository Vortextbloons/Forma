<script lang="ts">
  import { projectStore } from "./projectStore.svelte";

  let { selected, onSelect }: { selected: number; onSelect: (index: number) => void } = $props();

  const project = $derived(projectStore.current?.project);
  const pages = $derived(project?.pages ?? []);
  const outline = $derived(project?.outline ?? null);
</script>

<aside class="thumbnail-rail" aria-label="Slides">
  <div class="rail-body">
    {#each pages as path, i (path)}
      <button
        class="rail-thumb"
        class:active={selected === i}
        type="button"
        aria-label="Slide {i + 1}"
        aria-current={selected === i ? "true" : undefined}
        onclick={() => onSelect(i)}
      >
        <span class="rail-thumb-page"><span>{i + 1}</span></span>
        <span class="rail-thumb-title">{outline?.[i]?.title ?? `Slide ${i + 1}`}</span>
      </button>
    {/each}
  </div>
</aside>
