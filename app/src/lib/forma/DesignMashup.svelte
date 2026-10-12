<script lang="ts">
  import type { DesignProfile } from "../../../../src/projects/design.ts";

  let { profile, height = 20, width }: { profile: DesignProfile; height?: number; width?: number | string } = $props();

  const CORE_RANKS: Record<string, number> = { surface: 0, muted: 1, text: 2, accent: 3 };

  const layers = $derived.by(() => {
    const entries = Object.entries(profile.colors).filter(([name]) => name !== "background");
    const core = entries.filter(([name]) => name in CORE_RANKS).sort((a, b) => (CORE_RANKS[a[0]] ?? 0) - (CORE_RANKS[b[0]] ?? 0));
    const extras = entries.filter(([name]) => !(name in CORE_RANKS));
    const picked = [...core.slice(0, 2), ...extras.slice(0, 2), ...core.slice(2)];
    const n = picked.length;
    return picked.map(([name, color], i) => {
      const spread = n > 1 ? i / (n - 1) : 0.5;
      return {
        name,
        color,
        diameter: height * (1.3 - spread * 0.4),
        left: 14 + spread * 72,
        top: 50 - spread * 14 + (i % 2 === 0 ? 7 : -7),
        opacity: i === n - 1 ? 1 : 0.88,
      };
    });
  });
</script>

<div
  class="mashup"
  style:height={`${height}px`}
  style:width={typeof width === "number" ? `${width}px` : (width ?? `${Math.round(height * 2.6)}px`)}
  style:box-shadow={`inset 0 0 0 1px color-mix(in srgb, ${profile.colors.text} 14%, transparent)`}
  role="img"
  aria-label="Design palette: {layers.map((layer) => layer.name).join(", ")}"
>
  {#each layers as layer (layer.name)}
    <span
      style:width={`${layer.diameter}px`}
      style:height={`${layer.diameter}px`}
      style:left={`${layer.left}%`}
      style:top={`${layer.top}%`}
      style:background={layer.color}
      style:opacity={layer.opacity}
    ></span>
  {/each}
</div>

<style>
  .mashup {
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
    border-radius: 999px;
  }
  .mashup span {
    position: absolute;
    transform: translate(-50%, -50%);
    border-radius: 50%;
  }
</style>
