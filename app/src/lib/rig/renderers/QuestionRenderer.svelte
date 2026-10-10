<script lang="ts">
  import { asBoolean, asRecord, asString } from "../format";
  import { sendCommand } from "../bridge";
  import { openUrl } from "../native";
  import { messageStore } from "../stores/messageStore.svelte";
  import type { QuestionInteraction, QuestionOption } from "../types";
  import type { ToolRendererProps } from "./registry";










  let { sessionId, tool, interaction }: ToolRendererProps = $props();

  const live = $derived(
    interaction && interaction.interaction.kind === "question"
      ? (interaction.interaction as QuestionInteraction)
      : undefined,
  );



  const linked = $derived(
    !live && tool
      ? messageStore.findInteractionByToolCall(sessionId, tool.toolCallId)
      : undefined,
  );

  const toolInput = $derived(tool ? asRecord(tool.input) : {});
  const toolQuestion = $derived(asString(toolInput.question));
  const toolOptions = $derived(parseOptions(toolInput.options));

  const active = $derived(
    live ??
      (linked?.status === "pending" ? (linked.interaction as QuestionInteraction) : undefined) ??
      (toolQuestion !== ""
        ? ({
            kind: "question",
            id: "",
            sessionId,
            createdAt: "",
            question: toolQuestion,
            options: toolOptions,
            multiple: asBoolean(toolInput.multiple) ?? undefined,
            allowCustom: asBoolean(toolInput.allowCustom) ?? undefined,
            placeholder: typeof toolInput.placeholder === "string" ? toolInput.placeholder : undefined,
          } as QuestionInteraction)
        : undefined),
  );

  const answered = $derived(
    live ? interaction?.status === "resolved" : tool?.status === "completed",
  );
  const answerText = $derived(
    answered ? renderAnswer(interaction?.result ?? linked?.result ?? tool?.output) : undefined,
  );

  const secret = $derived((active as { secret?: boolean } | undefined)?.secret === true);
  const authUrl = $derived((active as { authUrl?: string } | undefined)?.authUrl);
  const authInfo = $derived((active as { authInfo?: string } | undefined)?.authInfo);

  let selected = $state<string[]>([]);
  let customText = $state("");

  function parseOptions(value: unknown): QuestionOption[] {
    if (!Array.isArray(value)) return [];
    const out: QuestionOption[] = [];
    for (const raw of value) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.label === "string" && typeof r.value === "string") {
        out.push({
          label: r.label,
          value: r.value,
          description: typeof r.description === "string" ? r.description : undefined,
        });
      }
    }
    return out;
  }

  function toggleOption(option: QuestionOption): void {
    if (!active || answered) return;
    if (active.multiple === true) {
      selected = selected.includes(option.value)
        ? selected.filter((v) => v !== option.value)
        : [...selected, option.value];
    } else {
      void submit([option.value]);
    }
  }

  function submit(value: string | string[]): void {
    if (!active || active.id === "") return;
    void sendCommand("resolveInteraction", {
      sessionId,
      interactionId: active.id,
      kind: "question",
      result: value,
    });
  }

  function submitCustom(): void {
    const text = customText.trim();
    if (!text) return;
    if (active?.multiple === true) {
      void submit([...selected, text]);
    } else {
      void submit(text);
    }
  }

  function submitMulti(): void {
    if (selected.length > 0) void submit([...selected]);
  }

  function renderAnswer(value: unknown): string {
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").join(", ");
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null) {
      const r = asRecord(value);
      if (typeof r.result === "string") return r.result;
      if (typeof r.answer === "string") return r.answer;
    }
    return "";
  }
</script>

{#if active}
  <div class="question-card">
    <div class="question-body">
      <div class="question-text">{active.question}</div>
      {#if answered}
        <div class="question-answer">
          <span class="muted">answered: </span>{answerText || "—"}
        </div>
      {:else if active.multiple === true}
        <div class="question-options">
          {#each active.options ?? [] as option (option.value)}
            <button
              class="question-option"
              class:question-option-selected={selected.includes(option.value)}
              type="button"
              onclick={() => toggleOption(option)}
            >
              {option.label}
            </button>
          {/each}
        </div>
        {#if active.allowCustom === true}
          <div class="question-custom">
            <input
              class="input"
              type={secret ? "password" : "text"}
              autocomplete="off"
              placeholder={active.placeholder ?? "Type your own answer…"}
              bind:value={customText}
              onkeydown={(e) => {
                if (e.key === "Enter") submitCustom();
              }}
            />
            <button class="btn" type="button" onclick={submitCustom}>add</button>
          </div>
        {/if}
        <div>
          <button class="btn btn-accent" type="button" onclick={submitMulti} disabled={selected.length === 0}>
            confirm
          </button>
        </div>
      {:else}
        {#if authUrl || authInfo}
          <div class="auth-assist">
            {#if authInfo}<span class="muted small">{authInfo}</span>{/if}
            {#if authUrl}
              <button class="btn btn-sm" type="button" onclick={() => void openUrl(authUrl)}>
                Open sign-in page
              </button>
              <button class="btn btn-sm btn-ghost" type="button" onclick={() => submit("")}>
                Cancel sign-in
              </button>
            {/if}
          </div>
        {/if}
        <div class="question-options">
          {#each active.options ?? [] as option (option.value)}
            <button class="question-option" type="button" onclick={() => toggleOption(option)}>
              {option.label}
            </button>
          {/each}
        </div>
        {#if (active.allowCustom === true || (active.options ?? []).length === 0)}
          <div class="question-custom">
            <input
              class="input"
              type={secret ? "password" : "text"}
              autocomplete="off"
              placeholder={active.placeholder ?? "Type your answer…"}
              bind:value={customText}
              onkeydown={(e) => {
                if (e.key === "Enter") submitCustom();
              }}
            />
            <button class="btn" type="button" onclick={submitCustom}>answer</button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}
