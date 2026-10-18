import type { EditCommandMessage, EditElementInfo, EditFrameBody, EditOp } from "./editContract.ts";

/**
 * Interaction script injected into the Edit-mode iframe. Kept separate from
 * the Preview-mode element feedback script (selection.ts). Runs the gesture,
 * text-editing, and live-preview behavior; the host app owns history,
 * persistence, and the inspector.
 */
export function elementEditScript(pageId: string, revision: string, accent: string): string {
  return `<script>(${editScriptBody.toString()})(${JSON.stringify({ pageId, rev: revision, accent })});</script>`;
}

interface EditScriptContext {
  pageId: string;
  rev: string;
  accent: string;
}

function editScriptBody(ctx: EditScriptContext): void {
  const PAGE = ctx.pageId;
  const REV = ctx.rev;
  const root = document.querySelector(".forma-page");
  if (!root) return;

  let selected: Element | null = null;
  let selectedPath: number[] | null = null;
  let gesture: {
    kind: "move" | "resize";
    dir: string;
    ratio: number;
    start: { x: number; y: number };
    rect: { x: number; y: number; width: number; height: number };
    translate: { x: number; y: number };
    moved: boolean;
    styles: { width: string; height: string; translate: string };
  } | null = null;
  let textEdit: {
    el: Element;
    nodeIndex: number;
    span: HTMLElement;
    original: string;
  } | null = null;
  let detached: Document | null = null;
  let paused = false;

  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const outline = document.createElement("div");
  outline.style.cssText = `position:absolute;display:none;border:1.5px solid ${ctx.accent};box-sizing:border-box`;
  overlay.append(outline);
  const handles: HTMLElement[] = [];
  for (const dir of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    const handle = document.createElement("div");
    handle.dataset.formaHandle = dir;
    handle.dataset.formaDir = dir;
    handle.style.cssText = [
      "position:absolute;display:none;width:9px;height:9px;margin:-4.5px",
      `background:${ctx.accent}`,
      "border:1px solid #fff",
      "border-radius:2px",
      "box-sizing:border-box",
      "pointer-events:auto",
      `cursor:${dir}-resize`,
    ].join(";");
    overlay.append(handle);
    handles.push(handle);
  }
  document.body.append(overlay);

  function post(message: EditFrameBody): void {
    parent.postMessage({ pageId: PAGE, rev: REV, ...message }, "*");
  }

  function childPath(el: Element): number[] | null {
    const steps: number[] = [];
    let node: Element | null = el;
    while (node && node !== root) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) return null;
      steps.unshift(Array.prototype.indexOf.call(parent.children, node));
      node = parent;
    }
    return node === root ? steps : null;
  }

  function elementAt(steps: number[]): Element | null {
    let node: Element = root as Element;
    for (const step of steps) {
      const next = node.children[step];
      if (!next) return null;
      node = next;
    }
    return node;
  }

  function editableUnit(el: Element | null): Element | null {
    if (!root || !el || !root.contains(el) || el === root) return null;
    let unit: Element | null = null;
    let node: Element | null = el;
    while (node && node !== root) {
      if (isVisual(node)) unit = node;
      node = node.parentElement;
    }
    return unit || el;
  }

  function computedTranslate(el: Element): { x: number; y: number } {
    const value = getComputedStyle(el).translate;
    if (!value || value === "none") return { x: 0, y: 0 };
    const parts = value.split(/[\s,]+/).map(parseFloat);
    return { x: parts[0] || 0, y: parts[1] || 0 };
  }

  function styleOf(el: Element): CSSStyleDeclaration {
    return (el as HTMLElement).style;
  }

  function hexColor(value: string): string | null {
    const match = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+%?)\s*)?\)$/i);
    if (!match) return null;
    const red = match[1];
    const green = match[2];
    const blue = match[3];
    const alphaText = match[4];
    if (red === undefined || green === undefined || blue === undefined) return null;
    if (alphaText !== undefined) {
      const alpha = alphaText.endsWith("%") ? parseFloat(alphaText) / 100 : parseFloat(alphaText);
      if (alpha < 0.999) return null;
    }
    return "#" + [red, green, blue].map((part) => Math.round(parseFloat(part)).toString(16).padStart(2, "0")).join("");
  }

  function isVisual(el: Element): boolean {
    return /^(SVG|IMG|CANVAS|VIDEO|PICTURE|IFRAME)$/i.test(el.tagName);
  }

  function buildInfo(el: Element, path: number[]): EditElementInfo {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const visual = isVisual(el);
    const hasText = Array.prototype.some.call(el.childNodes, (node: Node) => node.nodeType === 3 && (node.textContent || "").trim());
    const fill = hexColor(style.backgroundColor);
    const kind: EditElementInfo["kind"] = visual ? "image" : hasText ? "text" : fill ? "shape" : "group";
    const info: EditElementInfo = {
      path,
      kind,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      translate: computedTranslate(el),
      opacity: parseFloat(style.opacity),
      resizable: style.transform !== "none" ? false : visual ? "ratio" : "free",
      editableText: hasText && el instanceof HTMLElement,
    };
    if (fill) info.fill = fill;
    if (hasText && el instanceof HTMLElement) {
      info.fontSize = parseFloat(style.fontSize);
      info.color = hexColor(style.color) ?? undefined;
      const align = style.textAlign;
      if (/^(left|center|right|justify)$/.test(align)) info.align = align as EditElementInfo["align"];
      else info.align = (align === "end") !== (style.direction === "rtl") ? "right" : "left";
    }
    return info;
  }

  function drawSelection(): void {
    if (!selected || !selectedPath) {
      outline.style.display = "none";
      for (const handle of handles) handle.style.display = "none";
      return;
    }
    const rect = selected.getBoundingClientRect();
    Object.assign(outline.style, {
      display: "block",
      left: rect.x + "px",
      top: rect.y + "px",
      width: rect.width + "px",
      height: rect.height + "px",
    });
    const info = buildInfo(selected, selectedPath);
    const positions: Record<string, [number, number]> = {
      nw: [rect.x, rect.y], n: [rect.x + rect.width / 2, rect.y], ne: [rect.x + rect.width, rect.y],
      e: [rect.x + rect.width, rect.y + rect.height / 2], se: [rect.x + rect.width, rect.y + rect.height],
      s: [rect.x + rect.width / 2, rect.y + rect.height], sw: [rect.x, rect.y + rect.height],
      w: [rect.x, rect.y + rect.height / 2],
    };
    for (const handle of handles) {
      const dir = handle.dataset.formaDir as string;
      const show = info.resizable === "free" || (info.resizable === "ratio" && dir.length === 2);
      if (!show) {
        handle.style.display = "none";
        continue;
      }
      const spot = positions[dir] as [number, number];
      handle.style.display = "block";
      handle.style.left = spot[0] + "px";
      handle.style.top = spot[1] + "px";
    }
  }

  function select(el: Element, path: number[]): void {
    selected = el;
    selectedPath = path;
    drawSelection();
    post({ type: "forma:edit-selected", info: buildInfo(el, path) });
  }

  function clearSelection(): void {
    selected = null;
    selectedPath = null;
    drawSelection();
    post({ type: "forma:edit-cleared" });
  }

  function round(value: number): number {
    return Math.round(value);
  }

  function startMove(event: PointerEvent): void {
    if (!selected || !selectedPath) return;
    const path = selectedPath;
    const base = computedTranslate(selected);
    const rect = selected.getBoundingClientRect();
    gesture = { kind: "move", dir: "", ratio: 1, start: { x: event.clientX, y: event.clientY }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, translate: base, moved: false, styles: { width: styleOf(selected).width, height: styleOf(selected).height, translate: styleOf(selected).translate } };
    const onMove = (move: PointerEvent): void => {
      if (!gesture || !selected) return;
      const dx = move.clientX - gesture.start.x;
      const dy = move.clientY - gesture.start.y;
      if (!gesture.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      gesture.moved = true;
      styleOf(selected).translate = `${round(base.x + dx)}px ${round(base.y + dy)}px`;
      drawSelection();
    };
    const onUp = (up: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      const current = gesture;
      gesture = null;
      if (!current) return;
      if (selected) drawSelection();
      if (!current.moved || !selected) return;
      const dx = up.clientX - current.start.x;
      const dy = up.clientY - current.start.y;
      const after = { x: round(base.x + dx), y: round(base.y + dy) };
      const before = { x: round(base.x), y: round(base.y) };
      if (after.x === before.x && after.y === before.y) return;
      post({
        type: "forma:edit-commit",
        before: [{ kind: "move", path, x: before.x, y: before.y }],
        after: [{ kind: "move", path, x: after.x, y: after.y }],
      });
      post({ type: "forma:edit-info", info: buildInfo(selected, path) });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function startResize(dir: string, event: PointerEvent): void {
    if (!selected || !selectedPath) return;
    const path = selectedPath;
    const rect = selected.getBoundingClientRect();
    const base = computedTranslate(selected);
    const proportional = isVisual(selected);
    gesture = { kind: "resize", dir, ratio: rect.width / rect.height, start: { x: event.clientX, y: event.clientY }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, translate: base, moved: false, styles: { width: styleOf(selected).width, height: styleOf(selected).height, translate: styleOf(selected).translate } };
    const onMove = (move: PointerEvent): void => {
      if (!gesture || !selected) return;
      const dx = move.clientX - gesture.start.x;
      const dy = move.clientY - gesture.start.y;
      if (!gesture.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      gesture.moved = true;
      let width = rect.width;
      let height = rect.height;
      if (proportional) {
        width = Math.max(4, rect.width + (dir.includes("e") ? dx : -dx));
        height = width / gesture.ratio;
      } else {
        if (dir.includes("e")) width = rect.width + dx;
        if (dir.includes("w")) width = rect.width - dx;
        if (dir.includes("s")) height = rect.height + dy;
        if (dir.includes("n")) height = rect.height - dy;
        width = Math.max(4, width);
        height = Math.max(4, height);
      }
      width = round(width);
      height = round(height);
      const tx = base.x + (dir.includes("w") ? rect.width - width : 0);
      const ty = base.y + (dir.includes("n") ? rect.height - height : 0);
      styleOf(selected).translate = `${round(tx)}px ${round(ty)}px`;
      styleOf(selected).width = width + "px";
      styleOf(selected).height = height + "px";
      drawSelection();
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      const current = gesture;
      gesture = null;
      if (!current) return;
      if (selected) drawSelection();
      if (!current.moved || !selected) return;
      const afterRect = selected.getBoundingClientRect();
      const before: EditOp[] = [{ kind: "style", path, styles: current.styles }];
      const after: EditOp[] = [{ kind: "resize", path, width: round(afterRect.width), height: round(afterRect.height) }];
      const afterTranslate = computedTranslate(selected);
      if (afterTranslate.x !== round(base.x) || afterTranslate.y !== round(base.y)) {
        after.unshift({ kind: "move", path, x: round(afterTranslate.x), y: round(afterTranslate.y) });
      }
      post({ type: "forma:edit-commit", before, after });
      post({ type: "forma:edit-info", info: buildInfo(selected, path) });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function cancelGesture(): void {
    if (!gesture || !selected) return;
    styleOf(selected).translate = gesture.styles.translate;
    if (gesture.kind === "resize") {
      styleOf(selected).width = gesture.styles.width;
      styleOf(selected).height = gesture.styles.height;
    }
    gesture = null;
    drawSelection();
    post({ type: "forma:edit-cancelled" });
  }

  function applySingleOp(target: Element, op: EditOp): void {
    const styled = target as HTMLElement;
    if (op.kind === "move") styled.style.translate = `${round(op.x)}px ${round(op.y)}px`;
    else if (op.kind === "resize") {
      styled.style.width = op.width + "px";
      styled.style.height = op.height + "px";
    } else if (op.kind === "style") {
      for (const property of Object.keys(op.styles)) styled.style.setProperty(property, op.styles[property] as string);
    } else if (op.kind === "text") {
      const node = target.childNodes[op.node];
      if (node && node.nodeType === 3) node.nodeValue = op.value;
    }
  }

  function applyOps(ops: EditOp[]): void {
    for (const op of ops) {
      const el = elementAt(op.path);
      if (!el) continue;
      applySingleOp(el, op);
      if (detached) applyOpToDetached(op);
      if (selected === el) drawSelection();
      post({ type: "forma:edit-info", info: buildInfo(el, op.path) });
    }
  }

  function applyOpToDetached(op: EditOp): void {
    const doc = detached;
    if (!doc) return;
    let node: Element = doc.body;
    for (const step of op.path) {
      const next = node.children[step];
      if (!next) return;
      node = next;
    }
    applySingleOp(node, op);
  }

  const VOID_TAGS = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"];
  const RAW_TEXT_TAGS = ["style", "textarea", "script"];

  function escapeText(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  function escapeAttribute(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }

  function serializeNode(node: Node): string {
    if (node.nodeType === 3) {
      const parent = node.parentElement;
      return parent && RAW_TEXT_TAGS.indexOf(parent.tagName.toLowerCase()) !== -1
        ? (node.nodeValue || "")
        : escapeText(node.nodeValue || "");
    }
    if (node.nodeType === 8) return `<!--${node.nodeValue || ""}-->`;
    if (node.nodeType !== 1) return "";
    const el = node as Element;
    const foreign = Boolean(el.namespaceURI) && el.namespaceURI !== "http://www.w3.org/1999/xhtml";
    const tag = foreign ? el.tagName : el.tagName.toLowerCase();
    let html = `<${tag}`;
    for (const attribute of Array.from(el.attributes)) {
      html += ` ${attribute.name}="${escapeAttribute(attribute.value)}"`;
    }
    html += ">";
    if (VOID_TAGS.indexOf(tag) !== -1) return html;
    const raw = RAW_TEXT_TAGS.indexOf(tag) !== -1;
    for (const child of Array.from(el.childNodes)) {
      html += raw ? (child.nodeValue || "") : serializeNode(child);
    }
    return html + `</${tag}>`;
  }

  function serializeDetached(): string {
    const doc = detached;
    if (!doc) return "";
    let html = "";
    for (const node of Array.from(doc.body.childNodes)) html += serializeNode(node);
    return html;
  }

  function startTextEdit(el: Element, textNode: Node): void {
    const nodeIndex = Array.prototype.indexOf.call(el.childNodes, textNode);
    if (nodeIndex === -1 || !selectedPath) return;
    const span = document.createElement("span");
    span.setAttribute("data-forma-text-run", "");
    span.setAttribute("contenteditable", "true");
    span.style.cssText = "outline:2px solid " + ctx.accent + ";outline-offset:1px";
    span.textContent = textNode.textContent || "";
    el.replaceChild(span, textNode);
    textEdit = { el, nodeIndex, span, original: textNode.textContent || "" };
    drawSelection();
    span.focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    const domSelection = window.getSelection();
    if (domSelection) {
      domSelection.removeAllRanges();
      domSelection.addRange(range);
    }
    post({ type: "forma:edit-text-start", op: { kind: "text", path: selectedPath, node: nodeIndex, value: textEdit.original } });
    span.addEventListener("input", () => {
      post({ type: "forma:edit-text-input", op: { kind: "text", path: selectedPath || [], node: nodeIndex, value: span.textContent || "" } });
    });
    span.addEventListener("blur", () => {
      if (textEdit) finishTextEdit(false);
    });
    span.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Enter") {
        keyEvent.preventDefault();
        finishTextEdit(false);
      } else if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        finishTextEdit(true);
      }
    });
  }

  function finishTextEdit(cancelled: boolean): void {
    const editing = textEdit;
    if (!editing) return;
    textEdit = null;
    const value = editing.span.textContent || "";
    const textNode = document.createTextNode(cancelled ? editing.original : value);
    editing.el.replaceChild(textNode, editing.span);
    applyOpToDetached({ kind: "text", path: selectedPath || [], node: editing.nodeIndex, value: textNode.data });
    if (selected) drawSelection();
    post({
      type: "forma:edit-text-end",
      cancelled,
      op: cancelled ? null : { kind: "text", path: selectedPath || [], node: editing.nodeIndex, value },
    });
    if (selected) post({ type: "forma:edit-info", info: buildInfo(selected, selectedPath || []) });
  }

  document.addEventListener("pointerdown", (event) => {
    if (paused || textEdit || !(event.target instanceof Element)) return;
    const handle = event.target.closest("[data-forma-handle]");
    if (selected && handle && (handle as HTMLElement).dataset.formaDir) {
      event.preventDefault();
      startResize((handle as HTMLElement).dataset.formaDir as string, event);
      return;
    }
    const hit = editableUnit(event.target);
    if (!hit) {
      if (selected) clearSelection();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const path = childPath(hit);
    if (!path) return;
    if (hit !== selected) select(hit, path);
    startMove(event);
  }, true);

  document.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("dragstart", (event) => event.preventDefault(), true);

  document.addEventListener("dblclick", (event) => {
    if (paused || textEdit || gesture || !(event.target instanceof Element)) return;
    const hit = editableUnit(event.target);
    if (!hit) return;
    const path = childPath(hit);
    if (!path) return;
    if (hit !== selected) select(hit, path);
    const info = buildInfo(hit, path);
    if (!info.editableText) return;
    let textNode: Node | null = null;
    const range = typeof document.caretRangeFromPoint === "function"
      ? document.caretRangeFromPoint(event.clientX, event.clientY)
      : null;
    if (range && range.startContainer.nodeType === 3 && hit.contains(range.startContainer)) textNode = range.startContainer;
    if (!textNode) {
      textNode = Array.prototype.find.call(hit.childNodes, (node: Node) => node.nodeType === 3 && (node.textContent || "").trim()) || null;
    }
    if (!textNode) return;
    event.preventDefault();
    startTextEdit(hit, textNode);
  });

  document.addEventListener("keydown", (event) => {
    if (paused) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      if (gesture) {
        cancelGesture();
        event.preventDefault();
      } else if (textEdit) {
        finishTextEdit(true);
        event.preventDefault();
      } else if (selected) {
        clearSelection();
        event.preventDefault();
      }
      return;
    }
    if (textEdit) return;
    if ((event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z" || event.key === "y" || event.key === "Y")) {
      event.preventDefault();
      const redo = event.key.toLowerCase() === "y" || event.shiftKey;
      post({ type: redo ? "forma:edit-redo" : "forma:edit-undo" });
      return;
    }
    if (!selected || !selectedPath) return;
    const step = event.shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -step;
    else if (event.key === "ArrowRight") dx = step;
    else if (event.key === "ArrowUp") dy = -step;
    else if (event.key === "ArrowDown") dy = step;
    else return;
    event.preventDefault();
    const path = selectedPath;
    const base = computedTranslate(selected);
    const before: EditOp = { kind: "move", path, x: round(base.x), y: round(base.y) };
    const after: EditOp = { kind: "move", path, x: round(base.x + dx), y: round(base.y + dy) };
    styleOf(selected).translate = `${after.x}px ${after.y}px`;
    drawSelection();
    post({ type: "forma:edit-commit", before: [before], after: [after] });
    post({ type: "forma:edit-info", info: buildInfo(selected, path) });
  }, true);

  document.addEventListener("wheel", (event) => {
    if (event.ctrlKey) return;
    const deltaY = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? window.innerHeight : 1);
    post({ type: "forma:page-wheel", deltaY });
  }, { passive: true });

  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const data = event.data as EditCommandMessage | null;
    if (!data || data.rev !== REV) return;
    if (data.type === "forma:edit-init") {
      detached = new DOMParser().parseFromString(data.html, "text/html");
    } else if (data.type === "forma:edit-apply") {
      applyOps(data.ops);
    } else if (data.type === "forma:edit-select") {
      const el = elementAt(data.path);
      if (el) select(el, data.path);
    } else if (data.type === "forma:edit-clear") {
      if (textEdit) finishTextEdit(true);
      if (selected) clearSelection();
    } else if (data.type === "forma:edit-pause") {
      paused = data.paused;
      if (paused && gesture) cancelGesture();
      overlay.style.visibility = paused ? "hidden" : "";
    } else if (data.type === "forma:edit-serialize") {
      if (data.finishText && textEdit) finishTextEdit(false);
      post({ type: "forma:edit-source", seq: data.seq, html: serializeDetached() });
    }
  });

  post({ type: "forma:edit-ready" });
}
