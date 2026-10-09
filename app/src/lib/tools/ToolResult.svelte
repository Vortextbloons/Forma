<script lang="ts">
  import Collapsible from "../components/Collapsible.svelte";
  import { prettyJson } from "../rig/format";

  let { value, label = "output" }: { value: unknown; label?: string } = $props();

  const text = $derived(prettyJson(value));
  const long = $derived(text.length > 500);
</script>

{#if value !== undefined}
  <Collapsible title={label} defaultOpen={!long}>
    <pre class="pre">{text}</pre>
  </Collapsible>
{/if}
