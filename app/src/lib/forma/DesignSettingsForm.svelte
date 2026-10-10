<script lang="ts">
  import type { ProjectSettings } from "./types";
  import { DENSITY_LABELS, STYLE_LABELS } from "./types";
  import { formatDimensions } from "./sizes";
  import PageIcon from "./PageIcon.svelte";
  import Icon from "../components/Icon.svelte";

  let {
  settings,
  onchange,
  compact = false,
}: {
  settings: ProjectSettings;
  onchange: (next: ProjectSettings) => void;
  compact?: boolean;
} = $props();

  let moreOptions = $state(false);
  let disclosureEl = $state<HTMLElement | null>(null);

  function onWindowPointerDown(event: PointerEvent): void {
    if (!moreOptions) return;
    if (disclosureEl && event.target instanceof Node && disclosureEl.contains(event.target)) return;
    moreOptions = false;
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") moreOptions = false;
  }

  const SLIDE_PRESETS: Record<string, { width: number; height: number }> = {
    "16:9": { width: 1920, height: 1080 },
    "4:3": { width: 1440, height: 1080 },
  };
  const DIGITAL_PRESETS: Record<string, { width: number; height: number }> = {
    "1080x1350": { width: 1080, height: 1350 },
    square: { width: 1080, height: 1080 },
  };
  const PRINT_PRESETS: Record<string, { width: number; height: number; unit: "mm" | "in" }> = {
    a4: { width: 210, height: 297, unit: "mm" },
    a3: { width: 297, height: 420, unit: "mm" },
    letter: { width: 8.5, height: 11, unit: "in" },
    tabloid: { width: 11, height: 17, unit: "in" },
  };
  const PRINT_OPTIONS: Array<{
    value: "a4" | "a3" | "letter" | "tabloid";
    label: string;
    width: number;
    height: number;
  }> = [
    { value: "a4", label: "A4", width: 210, height: 297 },
    { value: "a3", label: "A3", width: 297, height: 420 },
    { value: "letter", label: "Letter", width: 8.5, height: 11 },
    { value: "tabloid", label: "Tabloid", width: 11, height: 17 },
  ];

  function emit(patch: Partial<ProjectSettings>): void {
    onchange({ ...settings, ...patch });
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
    const size = PRINT_PRESETS[preset]!;
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
      <span class="field-label">Slide count</span>
      <input
        class="input input-narrow"
        type="number"
        min="1"
        step="1"
        value={settings.slideCount}
        onchange={(event) => {
          const value = numberFrom(event);
          if (value !== null) emit({ slideCount: Math.round(value) });
        }}
      />
    </div>

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
        {#if moreOptions || settings.slideSize.preset === "custom"}
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
        {/if}
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
          {#if moreOptions || settings.posterSize.preset === "custom"}
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
        {/if}
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
          {#if moreOptions || settings.posterSize.preset === "custom"}
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
        {/if}
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

{#snippet options()}
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

  <div class="settings-disclosure" bind:this={disclosureEl}>
    <button
      class="disclosure-toggle"
      type="button"
      aria-expanded={moreOptions}
      onclick={() => (moreOptions = !moreOptions)}
    >
      More options
      <Icon name={moreOptions ? "chevron-down" : "chevron-right"} size={13} />
    </button>
  </div>
{/snippet}

<div class="design-settings">
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

  {#if compact}
    <details class="creation-options">
      <summary>
        <span>Density</span>
        <span class="muted small">{DENSITY_LABELS[settings.density]} density</span>
      </summary>
      <div class="design-settings">{@render options()}</div>
    </details>
  {:else}
    {@render options()}
  {/if}
</div>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />
