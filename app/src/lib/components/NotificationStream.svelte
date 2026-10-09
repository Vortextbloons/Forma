<script lang="ts">
  import Icon from "./Icon.svelte";
  import { formatClock } from "../rig/format";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";

  const items = notificationStore.items;
</script>

<div>
  {#each items as notification (notification.id)}
    <div class="notification">
      <span style="color:var(--{notification.type});display:flex">
        <Icon name={notification.type === "error" ? "alert" : notification.type === "success" ? "check" : "message"} size={14} />
      </span>
      <div class="notification-body">
        <div class="notification-message">{notification.message}</div>
        <div class="notification-time">{formatClock(notification.timestamp)}</div>
      </div>
      <button
        class="icon-btn"
        type="button"
        title="Dismiss"
        aria-label="Dismiss notification"
        onclick={() => notificationStore.dismiss(notification.id)}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  {:else}
    <div class="empty">No notifications yet.</div>
  {/each}
</div>
