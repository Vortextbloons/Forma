<script lang="ts">
  let {
    width,
    height,
    size = 16,
    label = "",
  }: { width: number; height: number; size?: number; label?: string } = $props();

  const ratio = $derived(height > 0 ? width / height : 1);
  const innerW = $derived(ratio >= 1 ? size - 4 : Math.max(5, Math.round((size - 4) * ratio)));
  const innerH = $derived(ratio >= 1 ? Math.max(5, Math.round((size - 4) / ratio)) : size - 4);
</script>

<svg
  class="page-icon"
  width={size}
  height={size}
  viewBox={`0 0 ${size} ${size}`}
  role={label ? "img" : "presentation"}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : "true"}
>
  <rect
    x={(size - innerW) / 2}
    y={(size - innerH) / 2}
    width={innerW}
    height={innerH}
    rx="1.5"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
  />
</svg>
