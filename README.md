# Forma

A Windows desktop studio for presentations and posters, built on
[Rig](https://github.com/anomalyco/rig) and Wails v3.

Describe the result → add context → optionally approve an outline → generate →
refine through chat → export.

## Architecture

- `app/` — Svelte 5 + TypeScript UI (the Forma workspace).
- `desktop/` — Wails v3 Go host: window, native dialogs, and the worker bridge.
- `src/worker/` — project-owned Node worker built on Rig's public runtime APIs.
  It speaks the Rig v1 JSONL protocol to the Go host and owns project
  persistence (`project.json`, `pages/`, `assets/`, project-local sessions).
- `src/projects/` — project format, atomic writes, context imports, recents.
- `src/agent.ts` — the Forma agent definition used by the worker.

A Forma project is a portable folder:

```text
My Project/
  project.json   format version, settings, outline, pages, context, conversation
  pages/         generated HTML/CSS per page (later stages)
  assets/        imported images and documents
  .rig/          project-local agent sessions and state
```

## Development

```sh
npm install
npm run dev:desktop   # wails3 dev via rig; requires wails3 on PATH
npm run typecheck     # root TypeScript checks
npm test              # focused Vitest tests (persistence + worker IPC)
cd app && npm run check && npm run build
cd desktop && go build .
```

For UI-only work, `cd app && npm run dev` renders the app against an in-browser
mock bridge.

## Status

Stage 1 (project persistence, project-owned worker, provider setup, minimal
workspace) is in place. Planning, generation, context extraction, validation,
and export arrive in later stages.
