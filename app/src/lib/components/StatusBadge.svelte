<script lang="ts">
  import type {
    SessionStatus,
    SubagentStatus,
    TodoStatus,
    ToolStatus,
  } from "../rig/types";

  type AnyStatus = SessionStatus | SubagentStatus | TodoStatus | ToolStatus;

  let { status }: { status: AnyStatus } = $props();

  function label(status: AnyStatus): string {
    switch (status) {
      case "running":
        return "running";
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      case "cancelled":
        return "cancelled";
      case "waiting":
        return "waiting for you";
      case "approval":
        return "approval";
      case "in_progress":
        return "in progress";
      case "pending":
        return "pending";
      case "idle":
        return "idle";
      default:
        return String(status);
    }
  }
</script>

<span class="badge badge-{status}">
  {#if status === "running" || status === "pending"}
    <span class="dot"></span>
  {/if}
  {label(status)}
</span>
