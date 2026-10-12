<script lang="ts">
  import type { DesignProfile } from "../../../../src/projects/design.ts";
  import DesignMashup from "./DesignMashup.svelte";

  let { profile, name = "Design preview", rationale = "" }: { profile: DesignProfile; name?: string; rationale?: string } = $props();

  const colors = $derived(Object.entries(profile.colors));
  const fontLine = $derived(`${profile.fonts.heading} / ${profile.fonts.body}${profile.fonts.utility ? ` / ${profile.fonts.utility}` : ""}`);

  const SCALE = 0.25;
  const headingStack = $derived(fontStack(profile.fonts.heading));
  const bodyStack = $derived(fontStack(profile.fonts.body));
  const utilityStack = $derived(fontStack(profile.fonts.utility ?? profile.fonts.body));
  const headingPx = $derived(Math.max(11, profile.headingSize * SCALE));
  const bodyPx = $derived(Math.max(7, profile.bodySize * SCALE));
  const smallPx = $derived(Math.max(6, profile.smallSize * SCALE));
  const spacingPx = $derived(Math.max(3, profile.spacing * SCALE));
  const radiusPx = $derived(profile.radius * SCALE);

  function fontStack(font: string): string {
    return `"${font}", ${["Georgia", "Times New Roman", "Cambria", "Palatino Linotype", "Garamond"].includes(font) ? "serif" : ["Consolas", "Courier New"].includes(font) ? "monospace" : "sans-serif"}`;
  }
</script>

<div class="design-preview">
  <div
    class="design-sample"
    aria-hidden="true"
    style:background={profile.colors.background}
    style:gap={`${spacingPx * 0.5}px`}
    style:padding={`${spacingPx}px ${spacingPx * 1.25}px`}
    style:border-radius={`${radiusPx}px`}
    style:box-shadow={`inset 0 0 0 1px color-mix(in srgb, ${profile.colors.text} 14%, transparent)`}
  >
    <span class="sample-kicker" style:font-family={utilityStack} style:font-size={`${smallPx}px`} style:color={profile.colors.accent}>Overview</span>
    <span class="sample-headline" style:font-family={headingStack} style:font-size={`${headingPx}px`} style:color={profile.colors.text}>Design in motion</span>
    <span class="sample-body" style:font-family={bodyStack} style:font-size={`${bodyPx}px`} style:color={profile.colors.muted}>The shared palette and typography apply to every page.</span>
    <div
      class="sample-surface"
      style:background={profile.colors.surface}
      style:border-radius={`${radiusPx}px`}
      style:padding={`${Math.max(2, spacingPx * 0.5)}px ${spacingPx}px`}
    >
      <span style:font-family={bodyStack} style:font-size={`${smallPx}px`} style:color={profile.colors.text}>Surface</span>
    </div>
  </div>
  <DesignMashup {profile} height={72} width="100%" />
  <div class="design-preview-row">
    <strong style:font-family={headingStack}>{name}</strong>
    <small class="muted">{fontLine}</small>
  </div>
  {#if profile.direction}<p class="muted small">{profile.direction}</p>{/if}
  <div class="palette-strip" role="img" aria-label="Palette: {colors.map(([role]) => role).join(", ")}">
    {#each colors as [role, color] (role)}
      <span style:background={color} title={`${role}: ${color}`} aria-label={`${role}: ${color}`}></span>
    {/each}
  </div>
</div>
{#if rationale}<p class="small">{rationale}</p>{/if}

<style>
  .design-preview { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; }
  .design-preview-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .design-preview-row strong { font-size: 17px; line-height: 1.2; }
  .design-preview-row small { flex-shrink: 0; }
  .design-preview p { margin: 0; }
  .palette-strip { display: flex; height: 10px; overflow: hidden; border-radius: 5px; }
  .palette-strip span { flex: 1; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08); }
  .design-sample { display: flex; flex-direction: column; align-items: flex-start; overflow: hidden; }
  .sample-kicker { font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
  .sample-headline { font-weight: 700; line-height: 1.1; }
  .sample-body { line-height: 1.45; }
  .sample-surface { display: inline-flex; align-items: center; }
</style>