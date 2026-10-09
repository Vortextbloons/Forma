<script lang="ts">
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";

  let {
    title,
    defaultOpen = false,
    badge,
    children,
  }: {
    title: string;
    defaultOpen?: boolean;
    badge?: string;
    children: Snippet;
  } = $props();

  let open = $state(false);

  onMount(() => {
    open = defaultOpen;
  });
</script>

<button
  class="collapsible-head"
  type="button"
  onclick={() => (open = !open)}
  aria-expanded={open}
>
  <Icon name={open ? "chevron-down" : "chevron-right"} size={13} />
  <span class="collapsible-title">{title}</span>
  {#if badge}
    <span class="chip">{badge}</span>
  {/if}
</button>
{#if open}
  <div class="collapsible-body">{@render children()}</div>
{/if}
