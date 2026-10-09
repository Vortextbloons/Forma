# forma

A specialized AI agent built with [Rig](https://github.com/anomalyco/rig) — a
thin starter foundation on top of the Pi SDK.

## Quick start

```sh
npm install
npm run chat        # interactive REPL
npm run dev         # run + watch (event log)
npm run inspect     # project report
npm run doctor      # environment health checks
```

One-shot:

```sh
npm run run -- "summarize the README"
```

## Project layout

- `src/agent.ts` — the agent definition (instructions, model, tools)
- `src/tools/` — custom tools (`defineTool`)
- `src/prompts/` — split instruction files (see `src/prompts/README.md`)
- `rig.config.ts` — runtime configuration
- `tests/` — vitest tests (see `tests/agent.test.ts`)
- `docs/` — project docs (sessions, tools, worktrees)

## Docs

- `rig docs` lists all shipped rig topics (agent, tools, runtime, events,
  sessions, workspaces, worktrees, subagents, mcp, web, desktop, testing,
  configuration, cli, versioning)
- `AGENTS.md` — guidance for coding agents working in this repo

## Requirements

Node >= 26. The pi SDK's `faux` provider enables offline testing — see
`AGENTS.md` for `RIG_FAUX_SCRIPT`.
