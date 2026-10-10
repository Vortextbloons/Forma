<script lang="ts">
  import NewProjectForm from "./NewProjectForm.svelte";
  import Icon from "../components/Icon.svelte";
  import ProjectsDialog from "./ProjectsDialog.svelte";

  let { onOpenSettings }: { onOpenSettings: () => void } = $props();

  let showProjects = $state(false);
</script>

<div class="start-screen">
  <header class="start-header">
    <span class="forma-wordmark">Forma</span>
    <span class="spacer"></span>
    <button class="btn btn-ghost" type="button" onclick={onOpenSettings}>
      <Icon name="gear" size={14} /> Settings
    </button>
  </header>

  <div class="start-scroll">
    <section class="start-hero">
      <NewProjectForm onOpenLibrary={() => (showProjects = true)} />
    </section>
  </div>
</div>

{#if showProjects}
  <ProjectsDialog onclose={() => (showProjects = false)} />
{/if}
