<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  let {
    axis,
    ariaLabel,
    onDelta,
    children,
  }: {

    axis: "x" | "y";
    ariaLabel?: string;
    onDelta: (delta: number) => void;
    children?: Snippet;
  } = $props();

  let dragging = $state(false);
  let lastPos = $state(0);

  const STEP = 12;

  function startDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
    dragging = true;
    lastPos = axis === "x" ? event.clientX : event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent): void {
    if (!dragging) return;
    const pos = axis === "x" ? event.clientX : event.clientY;
    const delta = pos - lastPos;
    lastPos = pos;
    if (delta !== 0) onDelta(delta);
  }

  function endDrag(): void {
    dragging = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      onDelta(-STEP);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      onDelta(STEP);
    } else if (event.key === "Home") {
      event.preventDefault();
      onDelta(-10_000);
    } else if (event.key === "End") {
      event.preventDefault();
      onDelta(10_000);
    }
  }

  function doubleClick(): void {
    onDelta(-10_000);
  }
</script>


<div
  class="divider divider-{axis}"
  class:dragging
  role="separator"
  aria-orientation={axis === "x" ? "vertical" : "horizontal"}
  aria-label={ariaLabel ?? "resize"}
  tabindex="0"
  onpointerdown={startDrag}
  onpointermove={moveDrag}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onkeydown={onKeydown}
  ondblclick={doubleClick}
>
  {@render children?.()}
</div>
