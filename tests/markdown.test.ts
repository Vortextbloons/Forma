import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../app/src/lib/rig/markdown.ts";

describe("chat markdown", () => {
  it("renders headings, bold, italic, and strikethrough", () => {
    const html = renderMarkdown("# Title\n\nSome **bold**, *italic*, and ~~old~~ text.");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<del>old</del>");
    expect(html).not.toContain("**");
  });

  it("renders fenced code with syntax highlighting", () => {
    const html = renderMarkdown('```ts\nconst x: number = 1;\n```');
    expect(html).toContain('<pre class="pre"><code class="hljs">');
    expect(html).toContain("const");
    expect(html).not.toContain("```");
  });

  it("treats an unclosed fence as code so streaming stays readable", () => {
    const html = renderMarkdown("Working on it:\n```js\nconst x = 1;");
    expect(html).toContain('<pre class="pre"><code class="hljs">');
  });

  it("renders nested lists and task items", () => {
    const html = renderMarkdown("- one\n  - nested\n- [x] done\n1. first\n2. second");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one<ul>");
    expect(html).toContain('type="checkbox" disabled checked');
    expect(html).toContain("<ol>");
  });

  it("links http urls and rejects javascript urls", () => {
    const html = renderMarkdown("[docs](https://example.com) and [evil](javascript:alert(1))");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer">docs</a>');
    expect(html).not.toContain("javascript:");
  });

  it("escapes raw html from model output", () => {
    const html = renderMarkdown('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders quotes, rules, tables, and line breaks", () => {
    const html = renderMarkdown("> quoted\n\n---\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nline one\nline two");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("line one<br>line two");
  });
});
