<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import PagePreview from "./PagePreview.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { editStore } from "./editStore.svelte";

  const project = $derived(projectStore.current?.project);
  const pages = $derived(project?.pages ?? []);
  const selected = $derived(projectStore.selectedPageId);
  let dragIndex = $state<number | null>(null);

  function titleOf(pageId: string, index: number): string {
    return project?.pageMeta[pageId]?.title || `Slide ${index + 1}`;
  }

  function drop(index: number): void {
    const from = dragIndex;
    dragIndex = null;
    if (from === null || from === index) return;
    const pageId = pages[from];
    if (!pageId) return;
    void projectStore.reorderPage(pageId, index + 1);
  }
</script>

<aside class="thumbnail-rail" aria-label="Slides">
  <div class="rail-body" role="list" aria-label="Slide order">
    {#each pages as pageId, i (pageId)}
      <div
        class="rail-item"
        class:active={selected === pageId}
        role="listitem"
        draggable="true"
        ondragstart={() => (dragIndex = i)}
        ondragover={(event) => event.preventDefault()}
        ondrop={(event) => {
          event.preventDefault();
          drop(i);
        }}
      >
        <button
          class="rail-thumb"
          type="button"
          aria-label={`Select slide ${i + 1}: ${titleOf(pageId, i)}`}
          aria-current={selected === pageId ? "true" : undefined}
          onclick={() => void editStore.selectPage(pageId)}
        >
          <PagePreview pageId={pageId} mode="thumb" />
        </button>
        <div class="rail-item-foot">
          <span class="rail-thumb-title" title={titleOf(pageId, i)}>{titleOf(pageId, i)}</span>
          <div class="rail-item-actions">
            <button
              class="icon-btn"
              type="button"
              title="Move up"
              aria-label={`Move slide ${i + 1} up`}
              disabled={i === 0}
              onclick={() => void projectStore.reorderPage(pageId, i)}
            >
              <Icon name="chevron-up" size={12} />
            </button>
            <button
              class="icon-btn"
              type="button"
              title="Move down"
              aria-label={`Move slide ${i + 1} down`}
              disabled={i === pages.length - 1}
              onclick={() => void projectStore.reorderPage(pageId, i + 2)}
            >
              <Icon name="chevron-down" size={12} />
            </button>
            <button
              class="icon-btn"
              type="button"
              title="Duplicate"
              aria-label={`Duplicate slide ${i + 1}`}
              onclick={() => void projectStore.duplicatePage(pageId)}
            >
              <Icon name="copy" size={12} />
            </button>
            <button
              class="icon-btn"
              type="button"
              title="Delete"
              aria-label={`Delete slide ${i + 1}`}
              onclick={() => void projectStore.deletePage(pageId)}
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        </div>
      </div>
    {/each}
  </div>
</aside>
