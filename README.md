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
- `src/projects/` — project format, atomic writes, page operations, context imports, recents.
- `src/forma/` — prompts, model capability checks, and the worker event sink.
- `src/extraction/` — PDF text extraction (PDF.js) and scanned-page OCR (Tesseract.js).
- `src/rendering/` — page composition and Chromium layout validation.
- `src/settings/` — per-user search credentials (DPAPI-protected).
- `src/agent.ts` — the Forma agent definition used by the worker.

A Forma project is a portable folder:

```text
My Project/
  project.json   format version, settings, outline, pages, context, conversation
  pages/         generated HTML/CSS per page
  assets/        imported images and documents
  .rig/          project-local agent sessions and state
```

## Development

```sh
npm install
npm run dev:desktop   # wails3 dev via rig; requires wails3 on PATH
npm run typecheck     # root TypeScript checks
npm test              # focused Vitest tests (persistence, artwork, extraction, worker IPC)
cd app && npm run check && npm run build
cd desktop && go build .
```

For UI-only work, `cd app && npm run dev` renders the app against an in-browser
mock bridge.

## Status

Stages 1–3 are in place: project persistence, the project-owned worker and
provider setup, outline planning, artwork generation and refinement, slide
controls, context ingestion with PDF/OCR extraction, research and photo search
(enforced by project toggles), and Chromium layout validation. Export and
standalone Windows packaging are the remaining stage.
