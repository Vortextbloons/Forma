# Changelog

All notable changes to [Forma](https://github.com/Vortextbloons/Forma) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No user-facing changes yet._

---

## [0.4.5] - 2026-10-10

### Added

- **In-place project switching** — opening another project rebinds the worker with `workspace.switch` instead of always restarting Chromium; sessions stay under the correct project folder.
- **Web & image defaults** — global toggles for web search and image finder in Settings, plus per-project overrides (follow global, on, or off).
- **Model picker on element feedback** — choose provider and model from the page-preview “Apply change” popover before sending a targeted refine.
- **Faster export** — PDF, PNG, and PPTX export compose and render pages with limited concurrency instead of strictly one page at a time.

### Changed

- **Settings → Web & images** — research and photo-search controls moved here from the Design panel; API key copy updated to match.
- **Design style tiles** — preset previews use sample headlines and artwork instead of abstract wireframes.
- **New project flow** — density and related options collapse under “More options” on the creation screen.
- **Chat thumbnail rail** — poster projects get the same preview rail with poster-specific labels (no slide numbers).
- **Model picker menus** — provider/model submenus flip to the left when needed and stay within the viewport on scroll and resize.
- **Page preview feedback** — popover placement prefers the side with more room above or below the selection.

### Fixed

- **Project open/create** — surfaces an error if the worker reports a different project directory than the one you opened.
- **Editable PPTX export** — slide objects are created in page order when rendering runs in parallel.

---

## [0.4.1] - 2026-10-10

### Added

- **Composer selection banner** — when an element is targeted, the input shows the element label, slide/poster context, a short hint, and a control to clear the selection before sending.
- **Element edits in chat history** — user messages display an “Element edit” header with the selected text so the thread reads clearly after refine.
- **CHANGELOG.md** — version history for the app; linked from the README and used as the source for GitHub Release notes.

### Changed

- **Message store** — user sends store optional element metadata; reopening a project re-derives element context from saved refine payloads so the timeline matches what you saw when you sent the message.
- **Release workflow** — tagged builds publish the matching `CHANGELOG.md` section instead of auto-generated release notes.

### Fixed

- **Page preview feedback popover** — clicking outside dismisses the anchor without leaving the feedback panel in a stuck open state.
- **Refine send path** — element label is attached to the visible user message, not only the worker payload.

---

## [0.4.0] - 2026-10-09

### Added

- **Click-to-refine in the page preview** — hover highlights an element; click to lock the selection and send targeted refine requests from chat with selector, HTML snippet, and bounds attached to the agent context.
- **Element selection plumbing** — shared `elementSelectionScript` in the render pipeline and preview iframe messaging (`forma:element-selected`, `forma:selection`) so the UI and worker agree on what is selected.
- **Editable PowerPoint export** — `addEditableArtwork` walks the live DOM and emits shapes, text runs, and images into PPTX instead of a flat screenshot where structure allows.
- **Chat panel context for selections** — refine scope automatically narrows to the selected page and element; the chat header reflects the active target.
- **Project schema support** for selection-related metadata used during refine and export flows.

### Changed

- **Export dialog** — options aligned with editable vs raster export behavior.
- **Model and thinking pickers** — small UX tweaks for long model lists and thinking presets.
- **Agent prompts** — instructions for element-scoped edits and safer handling of partial HTML feedback.
- **Artwork worker** — commands and rendering hooks for selection-aware generation and export.

### Fixed

- Refine requests that included an element context clear the selection after send so later messages are not stuck on a stale target.

---

## [0.3.0] - 2026-10-10

### Added

- **In-app updates (Windows)** — Settings → App & worker can check GitHub Releases, verify the installer digest, download, and silently reinstall while saving open work (`UpdateService` in the desktop shell).
- **GitHub Actions release pipeline** — pushing a `v*` tag builds the NSIS installer on `windows-latest` (Node 26, Wails 3 beta, NSIS) and publishes a GitHub Release with the setup executable.
- **Release build script** — `desktop/scripts/release.ps1` bundles the Vite app, worker runtime, prompts, and vendor bits into a signed Windows installer layout.
- **Projects library dialog** — browse, open, and manage recent projects from the start screen without digging through the file system.
- **Design profile form** — capture and edit a structured design profile (themes, typography, color direction) alongside the existing design settings.
- **Theme presets** — server-side theme helpers wired into project creation and artwork composition.
- **Bundled Tesseract English data** — OCR for scanned PDFs and images works out of the box without a separate language pack download.
- **Prompt library** — `Prompts/design.md` and `Prompts/Unslop.md` checked into the repo for consistent agent behavior.

### Changed

- **Start screen** — reworked layout: quicker paths to new project, recent work, and settings.
- **Settings dialog** — surfaces app version, worker status, and update controls.
- **Assets panel** — improved handling of project media and context attachments.
- **New project form** — small fields added for poster/slide defaults introduced in 0.2.
- **README** — product-focused description (describe → plan → generate → refine → export) and install/update instructions.
- **Windows installer metadata** — product name, version, and NSIS release template aligned with Forma branding.

### Fixed

- **Browser lifecycle** — Puppeteer instances are launched and torn down more reliably during render/export (fewer orphaned Chromium processes).
- **OCR worker cache** — cache directory handling adjusted for repeatable test runs and cleaner shutdown.
- **Vitest** — shared test setup for worker/browser cleanup; export and extraction tests updated for stricter isolation.

---

## [0.2.0] - 2026-10-09

### Added

- **End-to-end presentation workflow** — project store drives outline → generate → preview → refine with live page thumbnails and a full workspace shell.
- **Outline editor** — review and edit the proposed slide/poster structure before artwork runs.
- **Page preview** — iframe preview of rendered HTML artwork per page.
- **Export dialog** — PDF and high-resolution PNG export with page selection and print/screen-oriented options.
- **Context ingestion** — import PDFs, office documents, images, and pasted text; extract text (including OCR) for the agent.
- **Artwork worker** — dedicated commands for generating, validating, and exporting HTML slides/posters via headless browser rendering.
- **Research tools** — web search and image discovery to match the user’s stated visual direction.
- **Project tools** — rich agent tool surface for pages, design, assets, and conversation sessions on disk.
- **Design panel & profiles** — tune layout, typography, and visual tone per project.
- **Syntax highlighting** — code blocks in chat use Highlight.js with a shared rig highlight helper.
- **Credential storage** — Windows DPAPI-backed API key storage for providers.
- **Validation layer** — HTML artwork checks before export (accessibility-ish structure, size, and content rules).
- **Test suite** — broad coverage for artwork, export, extraction, chat, projects, tools, validation, and worker commands.

### Changed

- **Chat panel** — tighter integration with project scope (whole deck vs single slide vs poster).
- **Thumbnail rail** — reorder and select slides with clearer active state.
- **Model & provider UI** — picker and provider manager aligned with multi-provider rig bridge.
- **Bridge** — expanded Wails/native bridge for file picks, worker RPC, and project events.
- **Desktop shell** — worker service orchestration; workspace paths for project folders.
- **App styling** — large `forma.css` pass for studio-like density and readability.

### Removed

- Legacy rig file helpers and unused layout shell pieces superseded by the Forma workspace.

---

## [0.1.0] - 2026-10-09

### Added

- **Forma desktop app (Windows)** — Wails 3 + Svelte 5 shell embedding the rig agent UI for a local-first studio.
- **Project model on disk** — schema, atomic writes, recent projects, sessions, and page metadata.
- **Start screen & new project flow** — choose slides or poster, dimensions, and an initial brief.
- **Core workspace** — header, status bar, chat panel, assets panel, design settings, and settings dialog.
- **Worker host** — Node worker entrypoint with command routing for long-running jobs.
- **Conversation UI** — messages, composer, thinking indicator, tool renderers, and approval flows from rig.
- **Desktop services** — file service and worker service bridging the Go host to the embedded runtime.
- **Build scaffolding** — Windows-focused Wails taskfiles, icons, and dev/build PowerShell scripts.

[Unreleased]: https://github.com/Vortextbloons/Forma/compare/dc19eed...HEAD
[0.4.5]: https://github.com/Vortextbloons/Forma/commit/dc19eed
[0.4.1]: https://github.com/Vortextbloons/Forma/commit/cfa6cea
[0.4.0]: https://github.com/Vortextbloons/Forma/commit/05d6795
[0.3.0]: https://github.com/Vortextbloons/Forma/releases/tag/v0.3.0
[0.2.0]: https://github.com/Vortextbloons/Forma/commit/18b06cc
[0.1.0]: https://github.com/Vortextbloons/Forma/commit/a626832
