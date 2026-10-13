<script lang="ts">
  let { size = 22, withWordmark = true }: { size?: number; withWordmark?: boolean } = $props();
</script>

<span class="logo-lockup" aria-label="Forma home">
  <img class="logo-mark" src="/logo.png" alt="" width={size} height={size} draggable="false" />
  {#if withWordmark}
    <span class="logo-word">Forma</span>
  {/if}
</span>

<style>
  .logo-lockup {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    color: var(--text);
  }
  .logo-mark {
    flex-shrink: 0;
    border-radius: 6px;
    object-fit: cover;
  }
  .logo-word {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 650;
    letter-spacing: 0.01em;
    line-height: 1;
    white-space: nowrap;
  }
</style>
