<script lang="ts">
  import Collapsible from "../../components/Collapsible.svelte";
  import ToolHeader from "../../components/ToolHeader.svelte";
  import { asRecord, asString } from "../format";
  import { openUrl } from "../native";
  import type { ToolRendererProps } from "./registry";

  interface SearchResult {
    title: string;
    url: string;
    snippet?: string;
    source?: string;
    publishedAt?: string;
  }

  let { tool }: ToolRendererProps = $props();

  const input = $derived(tool ? asRecord(tool.input) : {});
  const query = $derived(asString(input.query));
  const provider = $derived(input.provider !== undefined ? asString(input.provider) : undefined);

  const output = $derived(tool ? asRecord(tool.output) : {});
  const results = $derived(parseResults(output.results ?? output));
  const isRunning = $derived(tool?.status === "running");

  function parseResults(value: unknown): SearchResult[] {
    if (!Array.isArray(value)) return [];
    const out: SearchResult[] = [];
    for (const raw of value) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.title === "string" && typeof r.url === "string") {
        out.push({
          title: r.title,
          url: r.url,
          snippet: typeof r.snippet === "string" ? r.snippet : undefined,
          source: typeof r.source === "string" ? r.source : undefined,
          publishedAt: typeof r.publishedAt === "string" ? r.publishedAt : undefined,
        });
      }
    }
    return out;
  }

  function open(result: SearchResult): void {
    void openUrl(result.url);
  }
</script>

{#if tool}
  <div class="tool-card">
    <ToolHeader name={tool.toolName} status={tool.status} durationMs={tool.durationMs} />
    <div class="tool-body">
      <div style="word-break:break-word">
        <span class="muted">query: </span><span class="mono">{query}</span>
      </div>
      {#if provider}
        <div class="muted" style="margin-top:2px">provider: {provider}</div>
      {/if}
      {#if tool.error}
        <div class="error-text mono" style="margin-top:6px">
          [{tool.error.code}] {tool.error.message}
        </div>
      {/if}
      {#if isRunning && results.length === 0}
        <span class="muted">searching…</span>
      {/if}
    </div>
    {#if results.length > 0}
      <Collapsible title={`results · ${results.length}`} defaultOpen={true}>
        <div class="tool-body" style="display:flex;flex-direction:column;gap:6px">
          {#each results as result (result.url)}
            <div class="search-result">
              <span class="search-result-title" role="button" tabindex="0" onclick={() => open(result)} onkeydown={(e) => e.key === "Enter" && open(result)}>
                {result.title}
              </span>
              {#if result.snippet}
                <span class="search-result-snippet">{result.snippet}</span>
              {/if}
              <span class="search-result-meta">
                {#if result.source}<span>{result.source}</span>{/if}
                {#if result.publishedAt}<span>{result.publishedAt}</span>{/if}
                <span class="mono">{result.url}</span>
              </span>
            </div>
          {/each}
        </div>
      </Collapsible>
    {/if}
  </div>
{/if}
