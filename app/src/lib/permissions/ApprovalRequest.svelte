<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { prettyJson } from "../rig/format";
  import { permissionStore } from "../rig/stores/permissionStore.svelte";
  import type { ApprovalRequestEntry } from "../rig/stores/permissionStore.svelte";

  let { sessionId, request }: { sessionId: string; request: ApprovalRequestEntry } = $props();

  function resolve(decision: "allow" | "deny", scope: "once" | "session"): void {
    void permissionStore.resolve(request, decision, scope);
  }
</script>

<div class="approval-card">
  <div class="approval-head">
    <Icon name="alert" size={14} />
    <span style="font-weight:600">{request.toolName}</span>
    <span class="chip mono">approval</span>
  </div>
  <div class="approval-body">
    {#if request.reason}
      <div class="question-text muted">{request.reason}</div>
    {/if}
    <div class="mono pre" style="max-height:140px">{prettyJson(request.input)}</div>
    <div class="approval-actions">
      <button class="btn btn-danger" type="button" onclick={() => resolve("deny", "once")}>
        Deny
      </button>
      <button class="btn" type="button" onclick={() => resolve("allow", "once")}>
        Allow once
      </button>
      <button class="btn btn-accent" type="button" onclick={() => resolve("allow", "session")}>
        Allow for session
      </button>
    </div>
  </div>
</div>
