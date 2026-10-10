<script lang="ts">
  import { projectStore } from "./projectStore.svelte";
  import type { StoredExtraction } from "./types";

  let { id, onclose }: { id: string; onclose: () => void } = $props();

  let extraction = $state<StoredExtraction | null>(null);
  let loading = $state(true);

  $effect(() => {
    let cancelled = false;
    loading = true;
    void projectStore.contextText(id).then((result) => {
      if (!cancelled) {
        extraction = result;
        loading = false;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") onclose();
  }
</script>

<div
  class="modal-overlay"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose();
  }}
  onkeydown={onKeydown}
>
  <div class="modal context-text-modal" role="dialog" aria-modal="true" aria-label="Extracted text">
    <div class="modal-head">
      <span class="modal-title">{extraction?.name ?? "Extracted text"}</span>
      {#if extraction}
        <span class="badge">{extraction.kind === "mixed" ? "Text + OCR" : extraction.kind === "ocr" ? "OCR" : "Text"}</span>
      {/if}
      <span class="spacer"></span>
      <button class="icon-btn" type="button" title="Close" aria-label="Close extracted text" onclick={onclose}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
    <div class="modal-body context-text-body">
      {#if loading}
        <p class="muted small"><span class="spinner"></span> Loading…</p>
      {:else if !extraction || extraction.pages.length === 0}
        <p class="muted small">No extracted text is available for this item yet.</p>
      {:else}
        {#each extraction.pages as page (page.page)}
          <section class="context-page">
            <header class="context-page-head">
              <strong>Page {page.page}</strong>
              <span class="muted small">{page.source === "ocr" ? "OCR" : "Embedded text"}</span>
            </header>
            <pre class="context-page-text">{page.text}</pre>
          </section>
        {/each}
      {/if}
    </div>
  </div>
</div>
