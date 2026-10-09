# Tools

The agent's tools live in `src/agent.ts` (`tools: [...]`).

Built-in tools are namespaced and configured per agent:

```ts
tools: [
  tools.files.read(),      // read files
  tools.files.search(),    // grep
  tools.files.list(),      // ls
  tools.files.write(),     // write (permission-gated)
  tools.files.edit(),      // edit (permission-gated)
  tools.shell(),           // shell commands (permission-gated)
  tools.web(),             // web search + fetch (requires API key + capability)
  tools.mcp(),             // read-only MCP server report
],
```

`question` (ask the user) and `todo` (task planning) are **capabilities**, not
tool factories: enable them in `rig.config.ts` (`capabilities.question` /
`capabilities.todo`) and the upstream extensions register the tools for the
agent automatically.

Custom tools are `defineTool({ name, description, input: z.object(...), execute })`
modules — see `src/tools/example.ts`. Add one with `rig add tool <name>`.

See `rig docs tools` for the full documentation.
