<script lang="ts">
  import RigShell from "./lib/components/RigShell.svelte";
  import { layoutStore } from "./lib/rig/stores/layoutStore.svelte";

  $effect(() => {
    layoutStore.applyTheme();
  });
</script>

<RigShell />
