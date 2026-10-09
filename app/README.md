# RigShell — the Svelte 5 UI for a Rig agent workspace

Copied into your project by `rig add desktop` as `app/`. Everything here
**belongs to your project after the copy** — it is a modifiable template, not
an opaque package. The Go host in `desktop/` only forwards events and
commands; all visuals and behavior live in this directory.

```
app/
├── package.json           name "<project>-app"; scripts: dev / build / check
├── vite.config.ts         root = this dir, base './', outDir dist
├── tsconfig.json          strict, svelte + vite types
├── index.html
├── README.md
└── src/
    ├── main.ts            mount App, register renderers, create the bridge
    ├── App.svelte         RigShell composition
    ├── app.css            design tokens (CSS variables) + shared classes
    ├── app/
    │   └── registerRenderers.ts   ← add YOUR tool renderers here
    └── lib/
        ├── rig/
        │   ├── bridge.ts          IPC client (Wails adapter + browser mock)
        │   ├── native.ts          native open/reveal via the Go host
        │   ├── files.ts           project-scoped file access (ReadFile/ReadDir/Stat)
        │   ├── env.ts             typed virtual:rig-env (projectDir/dataDir)
        │   ├── types.ts           rig/ipc + rig/events types + local gaps
        │   ├── format.ts          defensive parsing/formatting helpers
        │   ├── stores/            headless $state stores (one per concern)
        │   ├── renderers/         renderer registry + default renderers
        │   ├── components/        layout shell (RigShell, Header, panels…)
        │   ├── sessions/          session list
        │   ├── conversation/      messages, thinking, composer, interactions
        │   ├── tools/             tool call dispatch + shared tool UI
        │   ├── artifacts/         artifact cards/preview
        │   ├── permissions/       approval requests
        │   ├── models/            model/thinking pickers, providers
        │   ├── layout/            resizable 3-area workspace
        │   └── settings/          settings dialog (6 tabs)
```

## Development

```bash
npm install          # installs svelte, vite, @wailsio/runtime
npm run dev          # vite dev server in your browser
```

`npm run dev` runs the **mock bridge**: a scripted worker (hello → ready →
one session → a full demo run with tools, a question, an approval, todos,
subagents and artifacts when you send your first prompt). No desktop host, no
rig worker, no credentials needed. Perfect for styling and iterating on the
UI.

The full desktop app:

```bash
# from the project root (not app/)
.\desktop\scripts\build.ps1   # builds app/dist + the Go host
.\desktop\scripts\dev.ps1     # build and run from source
```

The desktop host embeds `app/dist` (`go:embed all:app/dist` in
`desktop/main.go`), so `npm run build` must run before compiling the host.

## How it talks to the worker

| Channel | Detail |
| --- | --- |
| `rig:event` (in) | one RigEvent envelope → routed to every store |
| `rig:ready` (in) | WorkerReady payload → workerStore + sessions/models/providers refresh |
| `rig:result` (in) | `{id, ok, data?, error?}` — resolves the matching command |
| `rig:log` / `rig:worker-exit` / `rig:worker-error` (in) | worker stream, exits, errors |
| `rig:command` (out) | `{v:1, type:"command", id, name, params}` — one worker command |
| `rig:worker-restart` / `rig:worker-stop` (out) | lifecycle control |

Commands carry ids `c<counter>`; results match by id with a 60s timeout
(`timeoutMs: 0` waits indefinitely — used for `prompt`, which settles when
the run ends). Payloads are parsed defensively (JSON strings, wrapped
WorkerEventMessage form, raw envelopes).

Native actions (artifact open/reveal) call the bound Go services through
`@wailsio/runtime`'s `Call({ methodName, args })` with fully-qualified names
`rigdesktop/services.WorkspaceService.OpenPath` and
`...RevealInFolder` (see `src/lib/rig/native.ts`). In the browser mock those
actions are no-ops.

Project files are read through the bound `FileService`
(`rigdesktop/services.FileService.ReadFile/ReadDir/Stat`) via
`src/lib/rig/files.ts`. All paths are relative to `RIG_PROJECT_DIR`; escapes
are rejected by the Go service. In browser dev `files.ts` serves an
in-memory fixture, so the shell works without the host.

`src/lib/rig/env.ts` exposes the typed `virtual:rig-env` module
(`projectDir`, `dataDir`) provided by `vite.config.ts`; values are baked from
`RIG_PROJECT_DIR`/`RIG_DATA_DIR` at Vite startup or build time (see
`src/lib/rig/vite-env-rig.d.ts`).

## Customization entry points

- **`src/app/registerRenderers.ts`** — register a component per tool name
  (`minecraft_validate_manifest`, …). Unknown tools always fall back to the
  generic JSON card. The file header explains the recipe.
- **`src/lib/rig/stores/*`** — headless `$state` stores (plain objects, no
  `svelte/store`). Every store exposes `handleEvent(event)`; the bridge is
  the single dispatcher. Add a store and wire it into `bridge.ts`'s
  `EVENT_STORES` to react to new event families.
- **`src/lib/rig/renderers/registry.ts`** — aliases and lookup rules.
- **`src/lib/rig/types.ts`** — local structural types for whatever
  `rig/ipc`/`rig/events` does not export yet.
- **`src/app.css`** — design tokens (`--bg`, `--surface`, `--accent`,
  `--radius`, …); dark/light via `[data-theme]`. Theme + accent + radius can
  be overridden from Settings → Appearance.

## Layout preferences

Panel widths/toggles, theme, accent and radius persist to localStorage under
`rig:layout:v2` (Settings → Advanced → Reset layout prefs clears them). The
v1→v2 bump intentionally resets stored prefs once (new accent/radius fields).

## Notes

- The stores are `.svelte.ts` modules: runes (`$state`, `$derived`) are
  compiler-processed only in `.svelte.ts`/`.svelte.js`, so plain `.ts` files
  cannot host rune state.
- Type-only imports from `rig/ipc` and `rig/events` are the app's only
  dependency on the rig package; the app bundle is otherwise self-contained.
