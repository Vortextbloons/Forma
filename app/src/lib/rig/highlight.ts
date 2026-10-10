import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { basename } from "./format";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("go", go);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

const EXTENSIONS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  html: "xml",
  htm: "xml",
  svelte: "xml",
  vue: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  conf: "ini",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  pwsh: "powershell",
  py: "python",
  go: "go",
  rs: "rust",
  sql: "sql",
  diff: "diff",
  patch: "diff",
};

const AUTO_DETECT_MAX = 12000;
const HIGHLIGHT_MAX = 100000;

export function languageForPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return EXTENSIONS[name.slice(dot + 1).toLowerCase()];
}

const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  html: "xml",
  htm: "xml",
  svg: "xml",
  vue: "xml",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  ps1: "powershell",
  pwsh: "powershell",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
  golang: "go",
  patch: "diff",
};

export function highlightCode(code: string, language?: string): string {
  if (code.length > HIGHLIGHT_MAX) return escapeHtml(code);
  try {
    const name =
      language !== undefined ? (LANGUAGE_ALIASES[language.toLowerCase()] ?? language) : undefined;
    if (name !== undefined && hljs.getLanguage(name)) {
      return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
    }
    if (code.length <= AUTO_DETECT_MAX) {
      const result = hljs.highlightAuto(code);
      if (result.language) return result.value;
    }
  } catch {
    return escapeHtml(code);
  }
  return escapeHtml(code);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
