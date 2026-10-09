<script lang="ts">
  import Collapsible from "../../components/Collapsible.svelte";
  import ToolHeader from "../../components/ToolHeader.svelte";
  import Icon from "../../components/Icon.svelte";
  import { asRecord, asString } from "../format";
  import { todoStore } from "../stores/todoStore.svelte";
  import type { ToolRendererProps } from "./registry";

  let { sessionId, tool }: ToolRendererProps = $props();

  const input = $derived(tool ? asRecord(tool.input) : {});
  const action = $derived(asString(input.action ?? "list"));

  const liveTodos = $derived(todoStore.bySession(sessionId));
  const completed = $derived(liveTodos.filter((t) => t.status === "completed").length);
  const isRunning = $derived(tool?.status === "running");
</script>

{#if tool}
  <div class="tool-card">
    <ToolHeader name={tool.toolName} status={tool.status} durationMs={tool.durationMs} />
    <div class="tool-body">
      <span class="muted">action: </span><span class="mono">{action}</span>
      {#if tool.error}
        <div class="error-text mono" style="margin-top:6px">
          [{tool.error.code}] {tool.error.message}
        </div>
      {/if}
      {#if !tool.error && liveTodos.length === 0 && !isRunning}
        <span class="muted">no plan yet</span>
      {/if}
    </div>
    {#if liveTodos.length > 0}
      <Collapsible title={`plan · ${completed}/${liveTodos.length} done`} defaultOpen={!isRunning}>
        <div class="tool-body">
          {#each liveTodos as todo (todo.id)}
            <div class="todo-item">
              <span class="todo-check" class:todo-check-completed={todo.status === "completed"}>
                {#if todo.status === "completed"}
                  <Icon name="check" size={9} strokeWidth={3} />
                {/if}
              </span>
              <span class="todo-title" class:todo-title-completed={todo.status === "completed"} class:todo-title-in_progress={todo.status === "in_progress"}>
                {todo.title}
              </span>
            </div>
          {/each}
        </div>
      </Collapsible>
    {/if}
  </div>
{/if}
