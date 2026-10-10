<script lang="ts">
  import { DESIGN_FONTS, defaultDesignProfile, type DesignProfile } from "../../../../src/projects/design.ts";
  import { projectStore } from "./projectStore.svelte";
  import type { ProjectSettings } from "./types";

  let { settings, onchange, disabled = false }: {
    settings: ProjectSettings;
    onchange: (settings: ProjectSettings) => void;
    disabled?: boolean;
  } = $props();

  const profile = $derived(settings.designProfile ?? defaultDesignProfile());
  let themeId = $state("");
  let themeName = $state("");
  let saving = $state(false);
  const colors: Array<{ key: keyof DesignProfile["colors"]; label: string }> = [
    { key: "background", label: "Background" },
    { key: "surface", label: "Surface" },
    { key: "text", label: "Text" },
    { key: "muted", label: "Muted text" },
    { key: "accent", label: "Accent" },
  ];
  const sizes: Array<{ key: "headingSize" | "bodySize" | "smallSize" | "spacing" | "radius"; label: string; min: number; max: number }> = [
    { key: "headingSize", label: "Heading size", min: 16, max: 240 },
    { key: "bodySize", label: "Body size", min: 12, max: 120 },
    { key: "smallSize", label: "Caption size", min: 8, max: 80 },
    { key: "spacing", label: "Spacing", min: 4, max: 160 },
    { key: "radius", label: "Corner radius", min: 0, max: 80 },
  ];

  function update(patch: Partial<DesignProfile>): void {
    onchange({ ...settings, designProfile: { ...profile, ...patch } });
  }

  async function save(): Promise<void> {
    if (!themeName.trim() || saving) return;
    saving = true;
    try {
      if (await projectStore.saveTheme(themeName.trim())) themeName = "";
    } finally {
      saving = false;
    }
  }
</script>

<fieldset class="design-profile" disabled={disabled || saving}>
  <legend class="field-label">Design profile</legend>
  <div class="theme-row">
    <label class="field">
      <span class="field-label">Saved themes</span>
      <select class="select" bind:value={themeId}>
        <option value="">Choose a theme</option>
        {#each projectStore.themes as theme (theme.id)}
          <option value={theme.id}>{theme.name}</option>
        {/each}
      </select>
    </label>
    <button class="btn" type="button" disabled={!themeId} onclick={() => projectStore.useTheme(themeId)}>Use theme</button>
  </div>
  {#if !settings.designProfile}
    <p class="muted small">Enable a shared profile to give every page the same palette and typography.</p>
    <button class="btn" type="button" onclick={() => update({})}>Enable shared profile</button>
  {/if}
  <div class="palette">
    {#each colors as color (color.key)}
      <label class="color-field">
        <input type="color" value={profile.colors[color.key]} aria-label={color.label} onchange={(event) => update({ colors: { ...profile.colors, [color.key]: event.currentTarget.value } })} />
        <span>{color.label}</span>
        <span class="muted">{profile.colors[color.key]}</span>
      </label>
    {/each}
  </div>
  <div class="profile-grid">
    {#each ["heading", "body"] as role (role)}
      <label class="field">
        <span class="field-label">{role === "heading" ? "Heading font" : "Body font"}</span>
        <select class="select" value={profile.fonts[role as keyof DesignProfile["fonts"]]} onchange={(event) => update({ fonts: { ...profile.fonts, [role]: event.currentTarget.value as DesignProfile["fonts"]["body"] } })}>
          {#each DESIGN_FONTS as font (font)}
            <option value={font}>{font}</option>
          {/each}
        </select>
      </label>
    {/each}
  </div>
  <details>
    <summary class="field-label">Type and spacing</summary>
    <p class="muted small">Sizes scale with page width; values are pixels on a 1920px-wide page.</p>
    <div class="profile-grid">
      {#each sizes as size (size.key)}
        <label class="field">
          <span class="field-label">{size.label}</span>
          <input class="input" type="number" min={size.min} max={size.max} value={profile[size.key]} onchange={(event) => {
            if (event.currentTarget.value && event.currentTarget.validity.valid) update({ [size.key]: Number(event.currentTarget.value) });
          }} />
        </label>
      {/each}
    </div>
  </details>
  <label class="field">
    <span class="field-label">Visual direction</span>
    <textarea class="input textarea" rows="2" placeholder="For example: spacious layouts, large headlines, restrained accents" value={profile.direction} onchange={(event) => update({ direction: event.currentTarget.value })}></textarea>
  </label>
  <form class="theme-row" onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <label class="field">
      <span class="field-label">Save as a reusable theme</span>
      <input class="input" placeholder="Theme name" bind:value={themeName} required />
    </label>
    <button class="btn" type="submit" disabled={!themeName.trim() || saving}>{saving ? "Saving…" : "Save theme"}</button>
  </form>
  <p class="muted small">Themes include this profile, style, and density. Reuse them in any project.</p>
</fieldset>

<style>
  .design-profile { display: grid; gap: 14px; min-width: 0; padding: 16px 0 0; margin: 0; border: 0; }
  .design-profile legend { padding: 0; }
  .theme-row { display: flex; align-items: end; gap: 8px; }
  .theme-row .field { flex: 1; min-width: 0; }
  .theme-row .btn { flex-shrink: 0; }
  .profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .palette { display: grid; gap: 8px; }
  .color-field { display: grid; grid-template-columns: 32px 1fr auto; align-items: center; gap: 10px; font-size: 12px; }
  .color-field input { width: 32px; height: 28px; padding: 0; border: 0; background: transparent; cursor: pointer; }
  summary { cursor: pointer; }
  details[open] summary { margin-bottom: 12px; }
</style>
