import type { Component } from "svelte";

// The blank desktop shell ships no tool renderers. Register your own here as
// you grow the UI:
//
//   registerCustomRenderer("my_tool", MyToolComponent);
//
// See the full template's app/src/app/registerRenderers.ts and the renderer
// registry for the full API (re-add `app/src/lib/rig/renderers/` from
// `rig add desktop --force` or copy the files you need).
export function registerDefaultRenderers(): void {}

export function registerCustomRenderer(
  _name: string,
  _component: Component<Record<string, unknown>>,
): void {}
