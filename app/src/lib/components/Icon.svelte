<script lang="ts">
  import { ICON_PATHS } from "./icons";
  import type { IconName } from "./icons";

  let {
    name,
    size = 16,
    strokeWidth = 1.8,
    label,
  }: {
    name: IconName;
    size?: number;
    strokeWidth?: number;
    label?: string;
  } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? "img" : "presentation"}
  aria-label={label ?? undefined}
>
  {#each ICON_PATHS[name] as d}
    <path {d} />
  {/each}
</svg>
