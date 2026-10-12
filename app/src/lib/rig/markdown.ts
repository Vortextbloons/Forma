import { escapeHtml, highlightCode } from "./highlight";

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const parts: Array<{ type: "md"; text: string } | { type: "code"; html: string }> = [];
  let md: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const fence = /^\s*(`{3,}|~{3,})\s*(\S*)\s*$/.exec(lines[i] ?? "");
    if (fence?.[1]) {
      const mark = fence[1][0] ?? "`";
      const width = fence[1].length;
      const language = fence[2] || undefined;
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s*\\${mark}{${width},}\\s*$`).test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      i += 1;
      if (md.length > 0) {
        parts.push({ type: "md", text: md.join("\n") });
        md = [];
      }
      parts.push({
        type: "code",
        html: `<pre class="pre"><code class="hljs">${highlightCode(code.join("\n"), language)}</code></pre>`,
      });
    } else {
      md.push(lines[i] ?? "");
      i += 1;
    }
  }
  if (md.length > 0) parts.push({ type: "md", text: md.join("\n") });
  return parts.map((part) => (part.type === "code" ? part.html : renderBlocks(part.text))).join("");
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function indentOf(indent: string): number {
  return indent.replace(/\t/g, "  ").length;
}

function renderBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length > 0) {
      out.push(`<p>${para.map((line) => renderInline(line)).join("<br>")}</p>`);
      para = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^\s*$/.test(line)) {
      flushPara();
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      flushPara();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? "")) {
      flushPara();
      const table = renderTable(lines, i);
      out.push(table.html);
      i = table.next;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      out.push("<hr>");
      i += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) {
        quote.push((lines[i] ?? "").replace(/^\s*> ?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderBlocks(quote.join("\n"))}</blockquote>`);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flushPara();
      const list = renderList(lines, i);
      out.push(list.html);
      i = list.next;
      continue;
    }
    para.push(line);
    i += 1;
  }
  flushPara();
  return out.join("");
}

function renderList(lines: string[], start: number): { html: string; next: number } {
  const first = LIST_ITEM.exec(lines[start] ?? "");
  if (!first?.[2]) return { html: "", next: start + 1 };
  const ordered = /^\d/.test(first[2]);
  const base = indentOf(first[1] ?? "");
  const tag = ordered ? "ol" : "ul";
  const startNum = ordered ? Number.parseInt(first[2], 10) : 1;
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const match = LIST_ITEM.exec(lines[i] ?? "");
    if (!match?.[2] || match[3] === undefined) break;
    const indent = indentOf(match[1] ?? "");
    if (indent < base || /^\d/.test(match[2]) !== ordered) break;
    if (indent > base) {
      if (items.length === 0) break;
      const nested = renderList(lines, i);
      items[items.length - 1] = (items[items.length - 1] ?? "").replace(/<\/li>$/, `${nested.html}</li>`);
      i = nested.next;
      continue;
    }
    i += 1;
    const textLines: string[] = [match[3]];
    const nested: string[] = [];
    while (i < lines.length) {
      const cont = lines[i] ?? "";
      if (/^\s*$/.test(cont)) {
        let j = i + 1;
        while (j < lines.length && /^\s*$/.test(lines[j] ?? "")) j += 1;
        if (j >= lines.length) {
          i = j;
          break;
        }
        const peek = LIST_ITEM.exec(lines[j] ?? "");
        if (peek?.[2] && indentOf(peek[1] ?? "") >= base) {
          i = j;
          continue;
        }
        if (/^\s+\S/.test(lines[j] ?? "")) {
          i = j;
          continue;
        }
        break;
      }
      const sub = LIST_ITEM.exec(cont);
      if (sub?.[2] && indentOf(sub[1] ?? "") > base) {
        const child = renderList(lines, i);
        nested.push(child.html);
        i = child.next;
        continue;
      }
      if (sub) break;
      textLines.push(cont.trim());
      i += 1;
    }
    items.push(`<li>${renderTaskItem(textLines)}${nested.join("")}</li>`);
  }
  const startAttr = ordered && startNum !== 1 && Number.isFinite(startNum) ? ` start="${startNum}"` : "";
  return { html: `<${tag}${startAttr}>${items.join("")}</${tag}>`, next: i };
}

function renderTaskItem(textLines: string[]): string {
  const first = textLines[0] ?? "";
  const task = /^\[([ xX])\]\s+(.*)$/.exec(first);
  if (task) {
    const checked = task[1]?.toLowerCase() === "x" ? " checked" : "";
    const rest = [task[2] ?? "", ...textLines.slice(1)].map((line) => renderInline(line)).join("<br>");
    return `<input type="checkbox" disabled${checked}> ${rest}`;
  }
  return textLines.map((line) => renderInline(line)).join("<br>");
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-") || /[^:|\-\s]/.test(trimmed)) return false;
  return trimmed
    .split("|")
    .some((cell) => cell.includes("-") && /^\s*:?-+:?\s*$/.test(cell));
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((cell) => cell.trim());
}

function renderTable(lines: string[], start: number): { html: string; next: number } {
  const header = splitRow(lines[start] ?? "");
  const separators = splitRow(lines[start + 1] ?? "");
  const aligns = separators.map((cell) =>
    cell.startsWith(":") && cell.endsWith(":") && cell.length > 2
      ? "center"
      : cell.endsWith(":")
        ? "right"
        : cell.startsWith(":")
          ? "left"
          : "",
  );
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || !line.includes("|")) break;
    rows.push(splitRow(line));
    i += 1;
  }
  const alignAttr = (index: number): string => {
    const align = aligns[index] ?? "";
    return align === "" ? "" : ` style="text-align:${align}"`;
  };
  const head = header.map((cell, index) => `<th${alignAttr(index)}>${renderInline(cell)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${header.map((_, index) => `<td${alignAttr(index)}>${renderInline(row[index] ?? "")}</td>`).join("")}</tr>`,
    )
    .join("");
  return {
    html: `<div class="md-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    next: i,
  };
}

function safeUrl(raw: string): string | undefined {
  const url = raw.trim().replace(/[\u0000-\u0020]+/g, "");
  if (/^(https?:\/\/|mailto:|#[^\s]*$)/i.test(url)) return url;
  return undefined;
}

function renderInline(text: string): string {
  const stash: string[] = [];
  const token = (html: string): string => `\u0000${stash.push(html) - 1}\u0000`;
  let out = escapeHtml(text);
  out = out.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, (_match, char: string) => token(char));
  out = out.replace(/(`+)(.+?)\1/g, (_match, _ticks: string, code: string) => token(`<code>${code}</code>`));
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, alt: string, src: string) => {
      const url = safeUrl(src);
      if (!url) return alt === "" ? "" : renderEmphasis(alt);
      return token(`<img src="${url}" alt="${alt}">`);
    },
  );
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, label: string, href: string) => {
      const url = safeUrl(href);
      if (!url) return renderEmphasis(label);
      return token(`<a href="${url}" target="_blank" rel="noreferrer">${renderEmphasis(label)}</a>`);
    },
  );
  out = out.replace(/<((?:https?:\/\/|mailto:)[^<>\s]+)>/g, (match, url: string) => {
    const safe = safeUrl(url);
    if (!safe) return match;
    return token(`<a href="${safe}" target="_blank" rel="noreferrer">${url}</a>`);
  });
  out = out.replace(/<([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>/g, (match, email: string) => {
    const safe = safeUrl(`mailto:${email}`);
    if (!safe) return match;
    return token(`<a href="${safe}" target="_blank" rel="noreferrer">${email}</a>`);
  });
  out = renderEmphasis(out);
  out = out.replace(/\bhttps?:\/\/[^\s<>\]`"]+/g, (match) => {
    const url = trimTrailingPunctuation(match);
    const safe = safeUrl(url);
    if (!safe) return match;
    const rest = match.slice(url.length);
    return `${token(`<a href="${safe}" target="_blank" rel="noreferrer">${url}</a>`)}${rest}`;
  });
  return out.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => stash[Number(index)] ?? "");
}

function renderEmphasis(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, (_match, inner: string) => `<strong>${inner}</strong>`)
    .replace(/__(.+?)__/g, (_match, inner: string) => `<strong>${inner}</strong>`)
    .replace(/\*([^*\n]+?)\*/g, (_match, inner: string) => `<em>${inner}</em>`)
    .replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, (_match, inner: string) => `<em>${inner}</em>`)
    .replace(/~~(.+?)~~/g, (_match, inner: string) => `<del>${inner}</del>`);
}

function trimTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0 && [".", ",", ";", ":", "!", "?"].includes(url[end - 1] ?? "")) end -= 1;
  let opens = 0;
  for (const char of url.slice(0, end)) {
    if (char === "(") opens += 1;
    if (char === ")") opens -= 1;
  }
  while (end > 0 && url[end - 1] === ")" && opens < 0) {
    opens += 1;
    end -= 1;
  }
  return url.slice(0, end);
}
