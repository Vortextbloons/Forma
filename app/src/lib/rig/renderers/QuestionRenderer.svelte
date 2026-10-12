<script lang="ts">
  import { asRecord, asString } from "../format";
  import { messageStore } from "../stores/messageStore.svelte";
  import type { QuestionInteraction } from "../types";
  import type { ToolRendererProps } from "./registry";
  import DesignPreview from "../../forma/DesignPreview.svelte";
  import type { DesignProposal } from "../../../../../src/tools/design.ts";
  import { designProfileSchema } from "../../../../../src/projects/design.ts";

  let { sessionId, tool }: ToolRendererProps = $props();

  const linked = $derived(messageStore.findInteractionByToolCall(sessionId, tool?.toolCallId));
  const toolInput = $derived(tool ? asRecord(tool.input) : {});
  const toolQuestion = $derived(asString(toolInput.question) || (tool?.toolName === "propose_design" ? `Use ${asString(toolInput.name)} for this project?` : ""));
  const question = $derived.by(() => {
    const linkedInteraction = linked?.interaction;
    if (linkedInteraction?.kind === "question") return linkedInteraction.question;
    return toolQuestion;
  });
  const proposal = $derived.by(() => {
    const linkedInteraction = linked?.interaction;
    const candidate =
      (linkedInteraction?.kind === "question"
        ? (linkedInteraction as QuestionInteraction & { designProposal?: DesignProposal }).designProposal
        : undefined) ??
      (tool?.toolName === "propose_design" ? (toolInput as unknown as DesignProposal) : undefined);
    if (!candidate) return undefined;
    const parsed = designProfileSchema.safeParse(candidate.profile);
    return parsed.success ? { ...candidate, profile: parsed.data } : undefined;
  });
  const answered = $derived(tool?.status === "completed");
  const answerText = $derived(answered ? renderAnswer(linked?.result ?? tool?.output) : "");

  function renderAnswer(value: unknown): string {
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").join(", ");
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null) {
      const r = asRecord(value);
      if (typeof r.result === "string") return r.result;
      if (typeof r.answer === "string") return r.answer;
      if (typeof r.approved === "boolean") {
        if (r.approved) return "approved";
        return typeof r.feedback === "string" && r.feedback !== "" ? r.feedback : "kept current design";
      }
    }
    return "";
  }
</script>

{#if question !== "" || proposal}
  <div class="question-card">
    <div class="question-body">
      <div class="question-text">{question}</div>
      {#if proposal}
        <DesignPreview profile={proposal.profile} name={proposal.name} rationale={proposal.rationale} />
      {/if}
      {#if answered}
        <div class="question-answer">
          <span class="muted">answered: </span>{answerText || "—"}
        </div>
      {:else}
        <p class="muted small question-waiting">Waiting for your answer…</p>
      {/if}
    </div>
  </div>
{/if}
