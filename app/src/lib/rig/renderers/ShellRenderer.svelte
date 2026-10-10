<script lang="ts">
  import Collapsible from "../../components/Collapsible.svelte";
  import CodeBlock from "../../components/CodeBlock.svelte";
  import ToolHeader from "../../components/ToolHeader.svelte";
  import ToolProgress from "../../tools/ToolProgress.svelte";
  import { asNumber, asRecord, asString } from "../format";
  import { sendCommand } from "../bridge";
  import type { ToolRendererProps } from "./registry";

  let { sessionId, tool }: ToolRendererProps = $props();

  const input = $derived(tool ? asRecord(tool.input) : {});
  const command = $derived(asString(input.command));
  const cwd = $derived(input.cwd !== undefined ? asString(input.cwd) : undefined);

  const output = $derived(tool ? asRecord(tool.output) : {});
  const stdout = $derived(asString(output.stdout));
  const stderr = $derived(asString(output.stderr));
  const exitCode = $derived(
    asNumber(output.exitCode) ?? asNumber(output.exit_code) ?? asNumber(output.code),
  );

  const isRunning = $derived(tool?.status === "running");
  const showStdout = $derived(stdout !== "");
  const showStderr = $derived(stderr !== "");
  const long = $derived(stdout.length > 400 || stderr.length > 400);

  function abort(): void {
    if (tool?.toolCallId) void sendCommand("abort", { sessionId });
  }
</script>

{#if tool}
  <div class="tool-card">
    <ToolHeader name={tool.toolName} status={tool.status} durationMs={tool.durationMs}>
      {#snippet actions()}
        {#if isRunning}
          <button class="btn btn-sm" type="button" onclick={abort} aria-label="Stop this command">
            stop
          </button>
        {/if}
      {/snippet}
    </ToolHeader>
    <div class="tool-body">
      <CodeBlock code={command} language="bash" />
      {#if cwd}
        <div class="muted mono" style="margin-top:2px">{cwd}</div>
      {/if}
      {#if tool.progress?.message}
        <div style="margin-top:6px"><ToolProgress {tool} /></div>
      {/if}
      {#if !isRunning && exitCode !== undefined}
        <div style="margin-top:6px">
          <span class="badge {exitCode === 0 ? 'badge-completed' : 'badge-failed'}">
            exit {exitCode}
          </span>
        </div>
      {/if}
      {#if tool.error}
        <div class="error-text mono" style="margin-top:6px">
          [{tool.error.code}] {tool.error.message}
        </div>
      {/if}
    </div>
    {#if showStdout}
      <Collapsible title="stdout" defaultOpen={!long}>
        <CodeBlock code={stdout} />
      </Collapsible>
    {/if}
    {#if showStderr}
      <Collapsible title="stderr" defaultOpen={!long && !showStdout}>
        <CodeBlock code={stderr} />
      </Collapsible>
    {/if}
  </div>
{/if}
