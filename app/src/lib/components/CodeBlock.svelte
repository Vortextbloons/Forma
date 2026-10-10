<script lang="ts">
  import { highlightCode } from "../rig/highlight";

  let {
    code,
    language,
    style,
  }: {
    code: string;
    language?: string;
    style?: string;
  } = $props();

  const html = $derived(highlightCode(code, language));
</script>

<pre class="pre" {style}><code class="hljs">{@html html}</code></pre>
