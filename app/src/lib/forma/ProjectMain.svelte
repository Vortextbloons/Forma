<script lang="ts">
  import PageIcon from "./PageIcon.svelte";
  import { projectStore } from "./projectStore.svelte";
  import { DENSITY_LABELS, OUTPUT_LABELS, STYLE_LABELS, countLabel } from "./types";
  import { effectiveSize } from "../../../../src/projects/size.ts";

  const project = $derived(projectStore.current?.project);
  const size = $derived(project ? effectiveSize(project.settings) : null);
  const meta = $derived.by(() => {
    if (!project) return [];
    const settings = project.settings;
    const rows: Array<[string, string]> = [
      ["Style", STYLE_LABELS[settings.style]],
      ["Density", DENSITY_LABELS[settings.density]],
    ];
    if (settings.output === "slides") {
      rows.push(["Slides", String(settings.slideCount)]);
    } else {
      rows.push(["Poster", settings.posterKind === "digital" ? "Digital" : "Print"]);
    }
    return rows;
  });
</script>

<main class="project-main">
  {#if project && size}
    <div class="brief-card">
      <div class="brief-head">
        <PageIcon width={size.width} height={size.height} size={22} />
        <span class="brief-kicker">{OUTPUT_LABELS[project.settings.output]}</span>
      </div>
      <h1>{project.name}</h1>
      <p class="brief-prompt">{project.prompt}</p>
      <dl class="brief-meta">
        {#each meta as [label, value] (label)}
          <div>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        {/each}
      </dl>
      <p class="muted small">
        {countLabel(project.context.length, "context item")} · {project.mode === "plan"
          ? "Plan first"
          : "Create directly"}
      </p>
    </div>
  {/if}
</main>
