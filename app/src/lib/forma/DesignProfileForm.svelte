<script lang="ts">
  import { BUILT_IN_THEMES, DESIGN_FONTS, defaultDesignProfile, designColorNameSchema, designFontSchema, type DesignProfile } from "../../../../src/projects/design.ts";
  import DesignPreview from "./DesignPreview.svelte";
  import { projectStore } from "./projectStore.svelte";
  import type { ProjectSettings } from "./types";

  let { settings, onchange, disabled = false, section = "full" }: {
    settings: ProjectSettings;
    onchange: (settings: ProjectSettings) => void;
    disabled?: boolean;
    section?: "chooser" | "editor" | "full";
  } = $props();

  const profile = $derived(settings.designProfile ?? defaultDesignProfile());
  const selectedThemeId = $derived(!settings.designApproved ? "ai" : [...BUILT_IN_THEMES, ...projectStore.themes].find((theme) => theme.name === settings.designName && JSON.stringify(theme.designProfile) === JSON.stringify(profile))?.id ?? "custom");
  let themeName = $state("");
  let saving = $state(false);
  let colorName = $state("");
  const fontListId = $props.id();
  const colors: Array<{ key: keyof DesignProfile["colors"]; label: string }> = [
    { key: "background", label: "Background" },
    { key: "surface", label: "Surface" },
    { key: "text", label: "Text" },
    { key: "muted", label: "Muted text" },
    { key: "accent", label: "Accent" },
  ];
  const sizes: Array<{ key: "headingSize" | "bodySize" | "smallSize" | "spacing" | "radius"; label: string; min: number; max: number }> = [
    { key: "headingSize", label: "Heading size", min: 16, max: 600 },
    { key: "bodySize", label: "Body size", min: 12, max: 240 },
    { key: "smallSize", label: "Caption size", min: 8, max: 120 },
    { key: "spacing", label: "Spacing", min: 4, max: 320 },
    { key: "radius", label: "Corner radius", min: 0, max: 320 },
  ];
  const extraColors = $derived(Object.entries(profile.colors).filter(([name]) => !colors.some((color) => color.key === name)));
  const canAddColor = $derived(designColorNameSchema.safeParse(colorName.trim()).success && !(colorName.trim() in profile.colors));

  function update(patch: Partial<DesignProfile>): void {
    onchange({ ...settings, designProfile: { ...profile, ...patch }, designApproved: true, designName: "Custom" });
  }

  function choose(id: string): void {
    if (id === "ai") {
      if (projectStore.current) {
        void projectStore.sendRefine("Propose a new shared design palette and typography for this project. Show the design with propose_design and wait for my approval or feedback. Do not create or edit artwork pages.", { scope: "project" }, "plan");
        return;
      }
      onchange({ ...settings, designApproved: false, designName: "AI chooses" });
      return;
    }
    if (id === "custom") {
      update({});
      return;
    }
    const theme = [...BUILT_IN_THEMES, ...projectStore.themes].find((entry) => entry.id === id);
    if (theme) onchange({ ...settings, style: theme.style, density: theme.density, designProfile: JSON.parse(JSON.stringify(theme.designProfile)), designApproved: true, designName: theme.name });
  }

  async function save(): Promise<void> {
    if (!themeName.trim() || saving) return;
    saving = true;
    try {
      if (await projectStore.saveTheme(themeName.trim(), settings)) themeName = "";
    } finally {
      saving = false;
    }
  }
</script>

<fieldset class="design-profile" disabled={disabled || saving}>
  <legend class="field-label">Design</legend>
  {#if section !== "editor"}
  <div class="theme-row">
    <label class="field">
      <span class="field-label">Palette and typography</span>
      <select class="select" value={selectedThemeId} onchange={(event) => choose(event.currentTarget.value)}>
        <option value="ai">Let AI propose a design</option>
        <option value="custom">Custom design</option>
        <optgroup label="Built-in themes">
          {#each BUILT_IN_THEMES as theme (theme.id)}
            <option value={theme.id}>{theme.name}</option>
          {/each}
        </optgroup>
        {#if projectStore.themes.length}
          <optgroup label="Saved themes">
            {#each projectStore.themes as theme (theme.id)}
              <option value={theme.id}>{theme.name}</option>
            {/each}
          </optgroup>
        {/if}
      </select>
    </label>
  </div>
  {#if !settings.designApproved}
    <p class="muted small">AI will preview a design for approval before building. You can ask for changes until it feels right.</p>
  {:else}
    <DesignPreview {profile} name={settings.designName} />
  {/if}
  {#if !settings.designProfile}
    <p class="muted small">Enable a shared profile to give every page the same palette and typography.</p>
    <button class="btn" type="button" onclick={() => update({})}>Enable shared profile</button>
  {/if}
  {/if}
  {#if section !== "chooser"}
  <details>
    <summary class="field-label">Edit colors, fonts, and spacing</summary>
  <div class="palette">
    {#each colors as color (color.key)}
      <label class="color-field">
        <input type="color" value={profile.colors[color.key]} aria-label={color.label} onchange={(event) => update({ colors: { ...profile.colors, [color.key]: event.currentTarget.value } })} />
        <span>{color.label}</span>
        <span class="muted">{profile.colors[color.key]}</span>
      </label>
    {/each}
    {#each extraColors as [name, value] (name)}
      <div class="color-field extra-color-field">
        <input type="color" {value} aria-label={name} onchange={(event) => update({ colors: { ...profile.colors, [name]: event.currentTarget.value } })} />
        <span>{name}</span>
        <span class="muted">{value}</span>
        <button class="btn btn-ghost" type="button" aria-label={`Remove ${name}`} onclick={() => {
          const { [name]: _removed, ...remaining } = profile.colors;
          update({ colors: remaining as DesignProfile["colors"] });
        }}>Remove</button>
      </div>
    {/each}
  </div>
  <div class="theme-row">
    <label class="field">
      <span class="field-label">Additional color</span>
      <input class="input" placeholder="e.g. coral or accent-two" bind:value={colorName} />
    </label>
    <button class="btn" type="button" disabled={!canAddColor} onclick={() => {
      update({ colors: { ...profile.colors, [colorName.trim()]: profile.colors.accent } });
      colorName = "";
    }}>Add color</button>
  </div>
  <div class="profile-grid">
    {#each ["heading", "body", "utility"] as role (role)}
      <label class="field">
        <span class="field-label">{role === "heading" ? "Heading font" : role === "body" ? "Body font" : "Caption and data font"}</span>
        <input class="input" list={fontListId} value={profile.fonts[role as keyof DesignProfile["fonts"]] ?? ""} placeholder={role === "utility" ? "Use body font" : "Local font family"} onchange={(event) => {
          const parsed = designFontSchema.safeParse(event.currentTarget.value);
          const inherited = role === "utility" && !event.currentTarget.value.trim();
          event.currentTarget.setCustomValidity(parsed.success || inherited ? "" : "Enter a local font family name.");
          if (parsed.success || inherited) update({ fonts: { ...profile.fonts, [role]: inherited ? undefined : parsed.data } });
          else event.currentTarget.reportValidity();
        }} />
      </label>
    {/each}
  </div>
  <datalist id={fontListId}>
    {#each DESIGN_FONTS as font (font)}<option value={font}></option>{/each}
  </datalist>
  <p class="muted small">Choose a suggestion or enter any font installed on this computer.</p>
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
    <textarea class="input textarea" rows="2" placeholder="For example: vivid collage, oversized typography, layered gradients" value={profile.direction} onchange={(event) => update({ direction: event.currentTarget.value })}></textarea>
  </label>
  </details>
  <div class="theme-row">
    <label class="field">
      <span class="field-label">Save as a reusable theme</span>
      <input class="input" placeholder="Theme name" bind:value={themeName} />
    </label>
    <button class="btn" type="button" onclick={() => void save()} disabled={!themeName.trim() || saving || !settings.designApproved}>{saving ? "Saving…" : "Save theme"}</button>
  </div>
  <p class="muted small">Themes include this profile, style, and density. Reuse them in any project.</p>
  {/if}
</fieldset>

<style>
  .design-profile { display: grid; gap: 14px; min-width: 0; padding: 16px 0 0; margin: 0; border: 0; }
  .design-profile legend { padding: 0; }
  .theme-row { display: flex; align-items: end; gap: 8px; }
  .theme-row .field { flex: 1; min-width: 0; }
  .theme-row .btn { flex-shrink: 0; }
  .profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .palette { display: grid; gap: 8px; }
  details > :global(*) + :global(*) { margin-top: 12px; }
  .color-field { display: grid; grid-template-columns: 32px 1fr auto; align-items: center; gap: 10px; font-size: 12px; }
  .color-field input { width: 32px; height: 28px; padding: 0; border: 0; background: transparent; cursor: pointer; }
  .extra-color-field { grid-template-columns: 32px 1fr auto auto; }
  summary { cursor: pointer; }
  details[open] summary { margin-bottom: 12px; }
</style>
