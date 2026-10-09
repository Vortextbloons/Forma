# Prompts

The agent's core instructions live in `src/agent.ts` (`instructions`). As the
agent grows, split them into prompt files here — one topic per file — and
compose them in the agent module:

```ts
// src/agent.ts
import { readFileSync } from "node:fs";

const loadPrompt = (name: string): string =>
  readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8");

export default defineAgent({
  // ...
  instructions: [
    loadPrompt("system.md"),
    loadPrompt("style.md"),
    loadPrompt("tools.md"),
  ].join("\n\n"),
});
```

Conventions:

- Keep each file under ~100 lines; a wall of text degrades model focus.
- Put hard rules (what the agent must NEVER do) first in `system.md`.
- Put style preferences and domain notes in separate files so they can be
  swapped per project without touching the agent module.

Rig v0.2 loads prompt files itself only through this pattern (the Pi SDK's
resource loader integration is a later milestone); the pattern above is the
supported way today.
