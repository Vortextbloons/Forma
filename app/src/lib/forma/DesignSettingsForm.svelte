<script lang="ts">
  import type { ProjectSettings } from "./types";
  import { CONTENT_FORMAT_LABELS, DECORATION_LABELS, DENSITY_LABELS, DESIGN_FREEDOM_LABELS, LAYOUT_VARIETY_LABELS, STYLE_LABELS } from "./types";
  import { formatDimensions } from "./sizes";
  import PageIcon from "./PageIcon.svelte";

  let {
  settings,
  onchange,
  section = "full",
}: {
  settings: ProjectSettings;
  onchange: (next: ProjectSettings) => void;
  section?: "full" | "chooser" | "editor";
} = $props();

  const SLIDE_PRESETS: Record<string, { width: number; height: number }> = {
    "16:9": { width: 1920, height: 1080 },
    "4:3": { width: 1440, height: 1080 },
  };
  const DIGITAL_PRESETS: Record<string, { width: number; height: number }> = {
    "1080x1350": { width: 1080, height: 1350 },
    square: { width: 1080, height: 1080 },
  };
  const PRINT_OPTIONS: Array<{
    value: "a4" | "a3" | "letter" | "tabloid";
    label: string;
    width: number;
    height: number;
    unit: "mm" | "in";
  }> = [
    { value: "a4", label: "A4", width: 210, height: 297, unit: "mm" },
    { value: "a3", label: "A3", width: 297, height: 420, unit: "mm" },
    { value: "letter", label: "Letter", width: 8.5, height: 11, unit: "in" },
    { value: "tabloid", label: "Tabloid", width: 11, height: 17, unit: "in" },
  ];

  function emit(patch: Partial<ProjectSettings>): void {
    onchange({ ...settings, ...patch });
  }

  function emitGuidelines(patch: Partial<ProjectSettings["designGuidelines"]>): void {
    emit({ designGuidelines: { ...settings.designGuidelines, ...patch } });
  }

  function selectSlidePreset(preset: "16:9" | "4:3" | "custom"): void {
    if (preset === "custom") {
      emit({ slideSize: { ...settings.slideSize, preset } });
      return;
    }
    const size = SLIDE_PRESETS[preset]!;
    emit({ slideSize: { preset, ...size } });
  }

  function selectDigitalPreset(preset: "1080x1350" | "square" | "custom"): void {
    if (preset === "custom") {
      emit({ posterSize: { ...settings.posterSize, preset } });
      return;
    }
    const size = DIGITAL_PRESETS[preset]!;
    emit({ posterSize: { preset, ...size, unit: "px" } });
  }

  function selectPrintPreset(preset: "a4" | "a3" | "letter" | "tabloid" | "custom"): void {
    if (preset === "custom") {
      emit({ posterSize: { ...settings.posterSize, preset } });
      return;
    }
    const size = PRINT_OPTIONS.find((option) => option.value === preset)!;
    emit({ posterSize: { preset, width: size.width, height: size.height, unit: size.unit } });
  }

  function numberFrom(event: Event): number | null {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
</script>

{#snippet dimensions()}
  {#if settings.output === "slides"}
    <div class="field">
      <span class="field-label">Slide size</span>
      <div class="tile-grid" role="group" aria-label="Slide size">
        <button
          type="button"
          class="size-tile"
          class:active={settings.slideSize.preset === "16:9"}
          onclick={() => selectSlidePreset("16:9")}
        >
          <PageIcon width={1920} height={1080} size={30} />
          <span>16:9</span>
          <em>1920 × 1080</em>
        </button>
        <button
          type="button"
          class="size-tile"
          class:active={settings.slideSize.preset === "4:3"}
          onclick={() => selectSlidePreset("4:3")}
        >
          <PageIcon width={1440} height={1080} size={30} />
          <span>4:3</span>
          <em>1440 × 1080</em>
        </button>
        <button
          type="button"
          class="size-tile"
          class:active={settings.slideSize.preset === "custom"}
          onclick={() => selectSlidePreset("custom")}
        >
          <PageIcon width={settings.slideSize.width} height={settings.slideSize.height} size={30} />
          <span>Custom</span>
          <em>pixels</em>
        </button>
      </div>
      {#if settings.slideSize.preset === "custom"}
        <div class="field-row">
          <label class="inline-field">
            <span>Width</span>
            <input
              class="input"
              type="number"
              min="1"
              value={settings.slideSize.width}
              onchange={(event) => {
                const value = numberFrom(event);
                if (value !== null) emit({ slideSize: { ...settings.slideSize, width: Math.round(value) } });
              }}
            />
          </label>
          <label class="inline-field">
            <span>Height</span>
            <input
              class="input"
              type="number"
              min="1"
              value={settings.slideSize.height}
              onchange={(event) => {
                const value = numberFrom(event);
                if (value !== null) emit({ slideSize: { ...settings.slideSize, height: Math.round(value) } });
              }}
            />
          </label>
        </div>
      {/if}
    </div>
  {:else}
    <div class="field">
      <span class="field-label">Poster type</span>
      <div class="segmented" role="group" aria-label="Poster type">
        <button
          type="button"
          class:active={settings.posterKind === "digital"}
          aria-pressed={settings.posterKind === "digital"}
          onclick={() => emit({ posterKind: "digital" })}
        >Digital</button>
        <button
          type="button"
          class:active={settings.posterKind === "print"}
          aria-pressed={settings.posterKind === "print"}
          onclick={() => emit({ posterKind: "print" })}
        >Print</button>
      </div>
    </div>

    {#if settings.posterKind === "digital"}
      <div class="field">
        <span class="field-label">Poster size</span>
        <div class="tile-grid" role="group" aria-label="Poster size">
          <button
            type="button"
            class="size-tile"
            class:active={settings.posterSize.preset === "1080x1350"}
            onclick={() => selectDigitalPreset("1080x1350")}
          >
            <PageIcon width={1080} height={1350} size={30} />
            <span>Portrait</span>
            <em>1080 × 1350</em>
          </button>
          <button
            type="button"
            class="size-tile"
            class:active={settings.posterSize.preset === "square"}
            onclick={() => selectDigitalPreset("square")}
          >
            <PageIcon width={1080} height={1080} size={30} />
            <span>Square</span>
            <em>1080 × 1080</em>
          </button>
          <button
            type="button"
            class="size-tile"
            class:active={settings.posterSize.preset === "custom"}
            onclick={() => selectDigitalPreset("custom")}
          >
            <PageIcon width={settings.posterSize.width} height={settings.posterSize.height} size={30} />
            <span>Custom</span>
            <em>pixels</em>
          </button>
        </div>
      </div>
    {:else}
      <div class="field">
        <span class="field-label">Print size</span>
        <div class="tile-grid" role="group" aria-label="Print size">
          {#each PRINT_OPTIONS as option (option.value)}
            <button
              type="button"
              class="size-tile"
              class:active={settings.posterSize.preset === option.value}
              onclick={() => selectPrintPreset(option.value)}
            >
              <PageIcon width={option.width} height={option.height} size={30} />
              <span>{option.label}</span>
              <em>{option.width} × {option.height}</em>
            </button>
          {/each}
          <button
            type="button"
            class="size-tile"
            class:active={settings.posterSize.preset === "custom"}
            onclick={() => selectPrintPreset("custom")}
          >
            <PageIcon width={settings.posterSize.width} height={settings.posterSize.height} size={30} />
            <span>Custom</span>
            <em>{settings.posterSize.unit}</em>
          </button>
        </div>
      </div>
    {/if}
      <div class="field">
        <span class="field-label">Orientation</span>
        <div class="segmented" role="group" aria-label="Orientation">
          <button
            type="button"
            class:active={settings.orientation === "portrait"}
            aria-pressed={settings.orientation === "portrait"}
            onclick={() => emit({ orientation: "portrait" })}
          >Portrait</button>
          <button
            type="button"
            class:active={settings.orientation === "landscape"}
            aria-pressed={settings.orientation === "landscape"}
            onclick={() => emit({ orientation: "landscape" })}
          >Landscape</button>
        </div>
      </div>
    {#if settings.posterSize.preset === "custom"}
      <div class="field-row">
        <label class="inline-field">
          <span>Width</span>
          <input
            class="input"
            type="number"
            min="1"
            step="0.1"
            value={settings.posterSize.width}
            onchange={(event) => {
              const value = numberFrom(event);
              if (value !== null) emit({ posterSize: { ...settings.posterSize, width: value } });
            }}
          />
        </label>
        <label class="inline-field">
          <span>Height</span>
          <input
            class="input"
            type="number"
            min="1"
            step="0.1"
            value={settings.posterSize.height}
            onchange={(event) => {
              const value = numberFrom(event);
              if (value !== null) emit({ posterSize: { ...settings.posterSize, height: value } });
            }}
          />
        </label>
        <label class="inline-field">
          <span>Unit</span>
          <select
            class="select input-narrow"
            value={settings.posterSize.unit}
            onchange={(event) =>
              emit({
                posterSize: {
                  ...settings.posterSize,
                  unit: (event.currentTarget as HTMLSelectElement).value as "px" | "mm" | "in",
                },
              })}
          >
            <option value="px">px</option>
            <option value="mm">mm</option>
            <option value="in">in</option>
          </select>
        </label>
      </div>
    {/if}

    <div class="dimension-preview">
      <PageIcon width={settings.posterSize.width} height={settings.posterSize.height} size={14} />
      <span>{formatDimensions(settings)}</span>
    </div>
  {/if}

{/snippet}

<div class="design-settings">
  {#if section !== "editor"}
    {@render dimensions()}
    <div class="field">
      <span class="field-label">Style</span>
      <div class="tile-grid tile-grid-3" role="group" aria-label="Style">
        {#each Object.entries(STYLE_LABELS) as [value, label] (value)}
          <button
            type="button"
            class="preset-tile"
            class:active={settings.style === value}
            aria-pressed={settings.style === value}
            onclick={() => emit({ style: value as ProjectSettings["style"] })}
          >
            <span class="mini-slide mini-{value}" aria-hidden="true">
              <span class="sample-title">{value === "balance" ? "Room to grow." : value === "bold" ? "Make waves." : "A new perspective."}</span>
              <span class="sample-art"></span>
            </span>
            <span class="tile-label">{label}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
  {#if section !== "chooser"}
    <div class="field">
      <span class="field-label">Density</span>
      <div class="tile-grid tile-grid-3" role="group" aria-label="Density">
        {#each Object.entries(DENSITY_LABELS) as [value, label] (value)}
          <button
            type="button"
            class="preset-tile"
            class:active={settings.density === value}
            aria-pressed={settings.density === value}
            onclick={() => emit({ density: value as ProjectSettings["density"] })}
          >
            <span class="mini-slide mini-density-{value}">
              <i class="m-title"></i>
              <i class="m-line"></i>
              <i class="m-line"></i>
              {#if value !== "concise"}
                <i class="m-line"></i>
                <i class="m-line m-short"></i>
              {/if}
              {#if value === "detailed"}
                <i class="m-line"></i>
                <i class="m-line"></i>
                <i class="m-line m-short"></i>
                <i class="m-grid"></i>
              {/if}
            </span>
            <span class="tile-label">{label}</span>
          </button>
        {/each}
      </div>
    </div>
    <div class="guidelines">
      <span class="field-label">Design guidelines</span>
      <div class="guideline-checks">
        <label class="toggle-row">
          <input type="checkbox" checked={settings.designGuidelines.photoHeavy} onchange={(event) => emitGuidelines({ photoHeavy: event.currentTarget.checked })} />
          <span>Photo-heavy</span>
        </label>
        <label class="toggle-row">
          <input type="checkbox" checked={settings.designGuidelines.preferDiagrams} onchange={(event) => emitGuidelines({ preferDiagrams: event.currentTarget.checked })} />
          <span>Prefer diagrams</span>
        </label>
        <label class="toggle-row">
          <input type="checkbox" checked={settings.designGuidelines.bigHeadlines} onchange={(event) => emitGuidelines({ bigHeadlines: event.currentTarget.checked })} />
          <span>Big headlines</span>
        </label>
        <label class="toggle-row">
          <input type="checkbox" checked={settings.designGuidelines.avoidCards} onchange={(event) => emitGuidelines({ avoidCards: event.currentTarget.checked })} />
          <span>Avoid cards</span>
        </label>
        <label class="toggle-row">
          <input type="checkbox" checked={settings.designGuidelines.onlySuppliedImages} onchange={(event) => emitGuidelines({ onlySuppliedImages: event.currentTarget.checked })} />
          <span>Only use my images</span>
        </label>
      </div>
      <div class="guideline-selects">
        <label class="inline-field">
          <span>Layout variety</span>
          <select class="input" value={settings.designGuidelines.layoutVariety} onchange={(event) => emitGuidelines({ layoutVariety: (event.currentTarget as HTMLSelectElement).value as ProjectSettings["designGuidelines"]["layoutVariety"] })}>
            {#each Object.entries(LAYOUT_VARIETY_LABELS) as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
        </label>
        <label class="inline-field">
          <span>Decoration</span>
          <select class="input" value={settings.designGuidelines.decoration} onchange={(event) => emitGuidelines({ decoration: (event.currentTarget as HTMLSelectElement).value as ProjectSettings["designGuidelines"]["decoration"] })}>
            {#each Object.entries(DECORATION_LABELS) as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
        </label>
        <label class="inline-field">
          <span>Content format</span>
          <select class="input" value={settings.designGuidelines.contentFormat} onchange={(event) => emitGuidelines({ contentFormat: (event.currentTarget as HTMLSelectElement).value as ProjectSettings["designGuidelines"]["contentFormat"] })}>
            {#each Object.entries(CONTENT_FORMAT_LABELS) as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
        </label>
        <label class="inline-field">
          <span>Design freedom</span>
          <select class="input" value={settings.designGuidelines.designFreedom} onchange={(event) => emitGuidelines({ designFreedom: (event.currentTarget as HTMLSelectElement).value as ProjectSettings["designGuidelines"]["designFreedom"] })}>
            {#each Object.entries(DESIGN_FREEDOM_LABELS) as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
        </label>
      </div>
      <label class="inline-field">
        <span>Custom guidelines</span>
        <textarea class="input textarea" rows="3" placeholder="Anything else the artwork should follow" value={settings.designGuidelines.custom} onchange={(event) => emitGuidelines({ custom: event.currentTarget.value })}></textarea>
      </label>
    </div>
  {/if}
</div>

<style>
  .guidelines {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .guideline-checks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
  }
  .guideline-selects {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .guidelines select,
  .guidelines textarea {
    width: 100%;
  }
</style>
