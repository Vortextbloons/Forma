<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { editStore } from "./editStore.svelte";

  const info = $derived(editStore.info);
  const paused = $derived(editStore.paused);

  let posX = $state(0);
  let posY = $state(0);
  let opacityValue = $state(100);
  let fontSizeValue = $state(16);

  $effect(() => {
    if (!info) return;
    posX = Math.round(info.rect.x);
    posY = Math.round(info.rect.y);
    opacityValue = Math.round(info.opacity * 100);
    const fontSize = info.fontSize;
    fontSizeValue = fontSize === undefined ? 16 : Math.round(fontSize);
  });

  const KIND_LABELS: Record<string, string> = {
    text: "Text",
    svg: "Graphic",
    image: "Image",
    canvas: "Image",
    video: "Video",
    group: "Group",
    shape: "Shape",
  };

  function commitPosition(): void {
    if (!info) return;
    const dx = Math.round(posX) - Math.round(info.rect.x);
    const dy = Math.round(posY) - Math.round(info.rect.y);
    if (!dx && !dy) return;
    editStore.setTranslate(info.translate.x + dx, info.translate.y + dy);
  }

  function commitOpacity(): void {
    if (!info) return;
    editStore.setStyles({ opacity: String(opacityValue / 100) });
  }

  function commitFontSize(): void {
    if (!info?.editableText || !Number.isFinite(fontSizeValue) || fontSizeValue <= 0) return;
    editStore.setStyles({ "font-size": `${fontSizeValue}px` });
  }

  function commitColor(event: Event): void {
    if (!info?.editableText) return;
    editStore.setStyles({ color: (event.currentTarget as HTMLInputElement).value });
  }

  function commitFill(event: Event): void {
    if (!info?.fill) return;
    editStore.setStyles({ "background-color": (event.currentTarget as HTMLInputElement).value });
  }

  function setSizeX(event: Event): void {
    if (!info) return;
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value) && value > 0) editStore.setSize(value, info.resizable === "ratio" ? value * info.rect.height / info.rect.width : info.rect.height);
  }

  function setSizeY(event: Event): void {
    if (!info) return;
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value) && value > 0) editStore.setSize(info.resizable === "ratio" ? value * info.rect.width / info.rect.height : info.rect.width, value);
  }
</script>

<aside class="element-inspector" aria-label="Element properties">
  <div class="inspector-head">
    <span class="field-label">Element</span>
    {#if info}
      <span class="inspector-kind">{KIND_LABELS[info.kind] ?? "Element"}</span>
    {/if}
  </div>

  {#if info}
    <div class="inspector-block">
      <span class="field-label">Position</span>
      <div class="inspector-row">
        <label class="inspector-field">
          <span class="muted small">X</span>
          <input class="input" type="number" bind:value={posX} onchange={commitPosition} disabled={paused} />
        </label>
        <label class="inspector-field">
          <span class="muted small">Y</span>
          <input class="input" type="number" bind:value={posY} onchange={commitPosition} disabled={paused} />
        </label>
      </div>
    </div>

    {#if info.resizable !== false}
      <div class="inspector-block">
        <span class="field-label">Size</span>
        <div class="inspector-row">
          <label class="inspector-field">
            <span class="muted small">W</span>
            <input class="input" type="number" value={Math.round(info.rect.width)} onchange={setSizeX} disabled={paused} />
          </label>
          <label class="inspector-field">
            <span class="muted small">H</span>
            <input class="input" type="number" value={Math.round(info.rect.height)} onchange={setSizeY} disabled={paused} />
          </label>
        </div>
        {#if info.resizable === "ratio"}
          <span class="muted small">Corner handles keep this graphic's proportions.</span>
        {/if}
      </div>
    {/if}

    <div class="inspector-block">
      <span class="field-label">Opacity</span>
      <div class="inspector-row inspector-opacity">
        <input type="range" min="0" max="100" step="1" bind:value={opacityValue} onchange={commitOpacity} disabled={paused} />
        <span class="inspector-value">{opacityValue}%</span>
      </div>
    </div>

    {#if info.editableText}
      <div class="inspector-block">
        <span class="field-label">Text</span>
        <div class="inspector-row">
          <label class="inspector-field">
            <span class="muted small">Size</span>
            <input class="input" type="number" min="1" bind:value={fontSizeValue} onchange={commitFontSize} disabled={paused} />
          </label>
          <label class="inspector-field inspector-color">
            <span class="muted small">Color</span>
            <input type="color" value={info.color ?? "#000000"} onchange={commitColor} disabled={paused} />
          </label>
        </div>
        <div class="inspector-row">
          <button
            class="icon-btn"
            class:active={info.align === "left"}
            type="button"
            aria-label="Align left"
            title="Align left"
            disabled={paused}
            onclick={() => editStore.setStyles({ "text-align": "left" })}
          ><Icon name="align-left" size={16} /></button>
          <button
            class="icon-btn"
            class:active={info.align === "center"}
            type="button"
            aria-label="Align center"
            title="Align center"
            disabled={paused}
            onclick={() => editStore.setStyles({ "text-align": "center" })}
          ><Icon name="align-center" size={16} /></button>
          <button
            class="icon-btn"
            class:active={info.align === "right"}
            type="button"
            aria-label="Align right"
            title="Align right"
            disabled={paused}
            onclick={() => editStore.setStyles({ "text-align": "right" })}
          ><Icon name="align-right" size={16} /></button>
        </div>
      </div>
    {/if}

    {#if info.fill}
      <div class="inspector-block">
        <span class="field-label">Fill</span>
        <label class="inspector-field inspector-color">
          <input type="color" value={info.fill} onchange={commitFill} disabled={paused} />
        </label>
      </div>
    {/if}
  {:else}
    <p class="muted small">Select an element on the canvas to edit it.</p>
  {/if}

  {#if paused}
    <p class="muted small">Editing pauses while Forma is working.</p>
  {/if}
</aside>

<style>
  .element-inspector {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 300px;
    flex-shrink: 0;
    padding: 20px 16px;
    border-left: 1px solid var(--border);
    background: var(--bg);
    overflow-y: auto;
  }

  .inspector-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .inspector-kind {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-radius: 999px;
    padding: 2px 10px;
  }

  .inspector-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .inspector-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .inspector-field {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .inspector-field .input {
    width: 100%;
  }

  .inspector-value {
    min-width: 40px;
    text-align: right;
    font-size: 12px;
    color: var(--text);
  }

  .inspector-color input[type="color"] {
    width: 100%;
    height: 32px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    cursor: pointer;
  }

  input[type="range"] {
    flex: 1;
    accent-color: var(--accent);
  }
</style>
