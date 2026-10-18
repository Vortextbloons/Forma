import { sendCommand } from "../rig/bridge";
import { notificationStore } from "../rig/stores/notificationStore.svelte";
import { projectStore } from "./projectStore.svelte";
import type {
  EditCommandMessage,
  EditElementInfo,
  EditFrameBody,
  EditFrameMessage,
  EditHistoryEntry,
  EditOp,
} from "../../../../src/rendering/editContract.ts";

export type { EditElementInfo, EditOp };

interface EditSessionState {
  pageId: string;
  /** Worker token of the last saved source; also used for stale-save rejection. */
  rev: string;
  /** Revision the mounted frame was composed from (differs from rev after saves). */
  frameRev: string | null;
  /** Original source at session load; re-sent to the frame on (re)build. */
  html: string;
  css: string;
  undo: EditHistoryEntry[];
  redo: EditHistoryEntry[];
  sourceVersion: number;
  savedVersion: number;
  selectedPath: number[] | null;
  textBefore: EditOp | null;
}

let editMode = $state(false);
let info = $state<EditElementInfo | null>(null);
let saveFailure = $state<string | null>(null);
let sessions = $state<Record<string, EditSessionState>>({});
let frameEpochs = $state<Record<string, number>>({});
let historyVersion = $state(0);

let boundDir = "";
let framePost: ((message: EditCommandMessage) => void) | null = null;
let framePostPageId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savePumping = false;
let saveChain: Promise<void> = Promise.resolve();
let serializeWaiter: { seq: number; resolve: (html: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
let serializeSeq = 0;

function sameProject(): boolean {
  return projectStore.current?.dir === boundDir && boundDir !== "";
}

function activeSession(): EditSessionState | null {
  const pageId = projectStore.selectedPageId;
  if (!pageId || !sameProject()) return null;
  return sessions[pageId] ?? null;
}

function dirtySessions(): EditSessionState[] {
  if (!sameProject()) return [];
  return Object.values(sessions).filter((session) => session.savedVersion < session.sourceVersion);
}

function paused(): boolean {
  return projectStore.run !== null || projectStore.exporting;
}

function postToFrame(session: EditSessionState, message: EditCommandMessage): void {
  if (!framePost || framePostPageId !== session.pageId || !session.frameRev) return;
  framePost(message);
}

function trackOps(session: EditSessionState, ops: EditOp[]): void {
  session.sourceVersion += ops.length;
}

function pushHistory(session: EditSessionState, before: EditOp[], after: EditOp[]): void {
  session.undo.push({ before, after });
  if (session.undo.length > 100) session.undo.shift();
  session.redo = [];
  historyVersion += 1;
}

function round(value: number): number {
  return Math.round(value);
}

function ensureSession(pageId: string): Promise<EditSessionState | null> {
  return withErrorReporting(async () => {
    const project = projectStore.current;
    if (!project || !project.project.pages.includes(pageId)) return null;
    if (boundDir !== project.dir) resetAll();
    boundDir = project.dir;
    const existing = sessions[pageId];
    if (existing) return existing;
    const data = await sendCommand("artwork.readEditable", { dir: project.dir, pageId }) as {
      html?: unknown;
      css?: unknown;
      revision?: unknown;
    };
    if (typeof data.html !== "string" || typeof data.revision !== "string") {
      throw new Error("The worker returned an invalid editable page");
    }
    if (projectStore.current?.dir !== project.dir) return null;
    const session: EditSessionState = {
      pageId,
      rev: data.revision,
      frameRev: null,
      html: data.html,
      css: typeof data.css === "string" ? data.css : "",
      undo: [],
      redo: [],
      sourceVersion: 0,
      savedVersion: 0,
      selectedPath: null,
      textBefore: null,
    };
    sessions[pageId] = session;
    frameEpochs[pageId] = (frameEpochs[pageId] ?? 0) + 1;
    return session;
  }) as Promise<EditSessionState | null>;
}

async function withErrorReporting<T>(task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    saveFailure = message;
    projectStore.setEditorSaveStatus("error");
    notificationStore.push({ type: "error", message });
    return undefined;
  }
}

async function saveSession(session: EditSessionState): Promise<void> {
  const project = projectStore.current;
  if (!project || project.dir !== boundDir) return;
  projectStore.setEditorSaveStatus("saving");
  const seqId = ++serializeSeq;
  const versionAtRequest = session.sourceVersion;
  const html = await requestSource(session, seqId);
  if (projectStore.current?.dir !== boundDir) return;
  const data = await sendCommand("artwork.saveEditable", {
    dir: project.dir,
    pageId: session.pageId,
    html,
    css: session.css,
    revision: session.rev,
  }) as { revision?: unknown };
  if (typeof data.revision === "string") session.rev = data.revision;
  session.html = html;
  session.savedVersion = versionAtRequest;
  projectStore.invalidateComposed(session.pageId);
}

function requestSource(session: EditSessionState, seqId: number, finishText = false): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (serializeWaiter?.seq === seqId) {
        serializeWaiter = null;
        reject(new Error("The editor canvas did not respond. Retry the save."));
      }
    }, 5_000);
    serializeWaiter = { seq: seqId, resolve, reject, timer };
    postToFrame(session, { type: "forma:edit-serialize", rev: session.frameRev as string, seq: seqId, finishText });
  });
}

function pump(): Promise<void> {
  if (savePumping) return saveChain;
  savePumping = true;
  const run = (async () => {
    try {
      while (dirtySessions().length > 0) {
        for (const session of dirtySessions()) {
          try {
            await saveSession(session);
          } catch (error) {
            saveFailure = error instanceof Error ? error.message : String(error);
            projectStore.setEditorSaveStatus("error");
            return;
          }
          if (!sameProject()) return;
        }
      }
      saveFailure = null;
      projectStore.setEditorSaveStatus("saved");
    } finally {
      savePumping = false;
    }
  })();
  saveChain = run.then(() => undefined, () => undefined);
  return saveChain;
}

function scheduleSave(delayMs = 0): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    void pump().catch(() => undefined);
  }, delayMs);
}

async function flush(): Promise<void> {
  await saveChain;
  const session = activeSession();
  if (session?.textBefore) await requestSource(session, ++serializeSeq, true);
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  await pump();
  if (saveFailure) throw new Error(saveFailure);
  if (dirtySessions().length > 0) throw new Error("Save the edited artwork before continuing.");
}

function resetAll(): void {
  if (saveTimer) clearTimeout(saveTimer);
  if (serializeWaiter) {
    clearTimeout(serializeWaiter.timer);
    serializeWaiter.reject(new Error("The editor was closed."));
    serializeWaiter = null;
  }
  saveTimer = undefined;
  sessions = {};
  frameEpochs = {};
  info = null;
  saveFailure = null;
  editMode = false;
  framePost = null;
  framePostPageId = null;
  boundDir = "";
}

export const editStore = {
  get editMode() {
    return editMode;
  },
  get info() {
    return info;
  },
  get saveFailure() {
    return saveFailure;
  },
  get paused() {
    return paused();
  },
  get loading() {
    const pageId = projectStore.selectedPageId;
    return Boolean(pageId && editMode && !sessions[pageId] && sameProject());
  },
  canUndo(): boolean {
    void historyVersion;
    return (activeSession()?.undo.length ?? 0) > 0;
  },
  canRedo(): boolean {
    void historyVersion;
    return (activeSession()?.redo.length ?? 0) > 0;
  },
  frameKey(pageId: string): number {
    return frameEpochs[pageId] ?? 0;
  },
  hasSession(pageId: string): boolean {
    return Boolean(sessions[pageId]);
  },
  ensureSession(pageId: string): Promise<EditSessionState | null> {
    return ensureSession(pageId);
  },

  async enter(): Promise<void> {
    const pageId = projectStore.selectedPageId;
    if (!pageId || !projectStore.current?.project.pages.includes(pageId)) return;
    const session = await ensureSession(pageId);
    if (session) editMode = true;
  },

  async exit(): Promise<boolean> {
    if (!editMode) return true;
    try {
      await flush();
    } catch {
      return false;
    }
    editMode = false;
    info = null;
    return true;
  },

  async selectPage(pageId: string): Promise<boolean> {
    if (!editMode) {
      projectStore.selectPage(pageId);
      return true;
    }
    if (pageId === projectStore.selectedPageId) return true;
    try {
      await flush();
    } catch {
      notificationStore.push({ type: "error", message: "Save the edited artwork before switching slides." });
      return false;
    }
    projectStore.selectPage(pageId);
    return true;
  },

  attachFrame(post: ((message: EditCommandMessage) => void) | null, pageId: string | null): void {
    if (post === null && framePostPageId !== pageId) return;
    framePost = post;
    framePostPageId = pageId;
  },

  noteFrameBuilt(pageId: string, rev: string): void {
    const session = sessions[pageId];
    if (!session) return;
    session.frameRev = rev;
    session.selectedPath = null;
    info = null;
  },

  handleFrameMessage(message: EditFrameMessage): void {
    const session = sessions[message.pageId];
    if (!session || session.frameRev !== message.rev) return;
    switch (message.type) {
      case "forma:page-wheel":
        return;
      case "forma:edit-ready": {
        info = null;
        session.selectedPath = null;
        postToFrame(session, { type: "forma:edit-init", rev: session.frameRev as string, html: session.html });
        return;
      }
      case "forma:edit-selected": {
        session.selectedPath = message.info.path;
        info = message.info;
        return;
      }
      case "forma:edit-cleared": {
        session.selectedPath = null;
        info = null;
        return;
      }
      case "forma:edit-info": {
        if (!session.selectedPath || message.info.path.join(",") === session.selectedPath.join(",")) info = message.info;
        return;
      }
      case "forma:edit-commit": {
        if (paused()) return;
        trackOps(session, message.after);
        pushHistory(session, message.before, message.after);
        postToFrame(session, { type: "forma:edit-apply", rev: session.frameRev as string, ops: message.after });
        scheduleSave();
        return;
      }
      case "forma:edit-text-start": {
        session.textBefore = message.op;
        return;
      }
      case "forma:edit-text-input": {
        if (paused()) return;
        trackOps(session, [message.op]);
        postToFrame(session, { type: "forma:edit-apply", rev: session.frameRev as string, ops: [message.op] });
        scheduleSave(500);
        return;
      }
      case "forma:edit-text-end": {
        const before = session.textBefore;
        session.textBefore = null;
        if (message.cancelled && before) {
          trackOps(session, [before]);
          postToFrame(session, { type: "forma:edit-apply", rev: session.frameRev as string, ops: [before] });
          scheduleSave();
          return;
        }
        if (!before || !message.op) return;
        if (JSON.stringify(before) === JSON.stringify(message.op)) return;
        if (paused()) return;
        trackOps(session, [message.op]);
        pushHistory(session, [before], [message.op]);
        postToFrame(session, { type: "forma:edit-apply", rev: session.frameRev as string, ops: [message.op] });
        scheduleSave();
        return;
      }
      case "forma:edit-cancelled":
        return;
      case "forma:edit-undo":
        editStore.undo();
        return;
      case "forma:edit-redo":
        editStore.redo();
        return;
      case "forma:edit-source": {
        if (serializeWaiter?.seq === message.seq) {
          const waiter = serializeWaiter;
          serializeWaiter = null;
          clearTimeout(waiter.timer);
          waiter.resolve(message.html);
        }
        return;
      }
    }
  },

  setTranslate(x: number, y: number): void {
    const element = info;
    if (!element || paused() || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const after: EditOp = { kind: "move", path: element.path, x: round(x), y: round(y) };
    const before: EditOp = { kind: "move", path: element.path, x: round(element.translate.x), y: round(element.translate.y) };
    commitParent([before], [after]);
  },

  setSize(width: number, height: number): void {
    const element = info;
    if (!element || element.resizable === false || paused() || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const after: EditOp = { kind: "resize", path: element.path, width: round(width), height: round(height) };
    const before: EditOp = { kind: "resize", path: element.path, width: round(element.rect.width), height: round(element.rect.height) };
    commitParent([before], [after]);
  },

  setStyles(styles: Record<string, string>): void {
    const element = info;
    if (!element || paused()) return;
    const beforeStyles: Record<string, string> = {};
    for (const property of Object.keys(styles)) {
      const current = currentStyleValue(element, property);
      if (current === undefined) return;
      beforeStyles[property] = current;
    }
    commitParent([{ kind: "style", path: element.path, styles: beforeStyles }], [{ kind: "style", path: element.path, styles }]);
  },

  nudge(dx: number, dy: number): void {
    const element = info;
    if (!element || paused()) return;
    const after: EditOp = { kind: "move", path: element.path, x: round(element.translate.x + dx), y: round(element.translate.y + dy) };
    const before: EditOp = { kind: "move", path: element.path, x: round(element.translate.x), y: round(element.translate.y) };
    commitParent([before], [after]);
  },

  undo(): void {
    const session = activeSession();
    if (!session || paused()) return;
    const entry = session.undo.pop();
    if (!entry) return;
    session.redo.push(entry);
    historyVersion += 1;
    trackOps(session, entry.before);
    postToFrame(session, { type: "forma:edit-apply", rev: session.frameRev as string, ops: entry.before });
    scheduleSave();
  },

  redo(): void {
    const session = activeSession();
    if (!session || paused()) return;
    const entry = session.redo.pop();
    if (!entry) return;
    session.undo.push(entry);
    historyVersion += 1;
    trackOps(session, entry.after);
    postToFrame(session, { type: "forma:edit-apply", rev: session.frameRev as string, ops: entry.after });
    scheduleSave();
  },

  clearSelection(): void {
    const session = activeSession();
    info = null;
    if (!session?.selectedPath) return;
    session.selectedPath = null;
    postToFrame(session, { type: "forma:edit-clear", rev: session.frameRev as string });
  },

  async retrySave(): Promise<void> {
    saveFailure = null;
    await pump();
  },

  async discardDraft(): Promise<void> {
    const pageId = projectStore.selectedPageId;
    if (!pageId) return;
    if (saveTimer) clearTimeout(saveTimer);
    delete sessions[pageId];
    frameEpochs[pageId] = (frameEpochs[pageId] ?? 0) + 1;
    info = null;
    saveFailure = null;
    if (dirtySessions().length === 0) projectStore.setEditorSaveStatus("saved");
    await withErrorReporting(() => ensureSession(pageId).then(() => undefined));
  },
};

function commitParent(before: EditOp[], after: EditOp[]): void {
  const session = activeSession();
  if (!session) return;
  trackOps(session, after);
  pushHistory(session, before, after);
  postToFrame(session, { type: "forma:edit-apply", rev: session.frameRev as string, ops: after });
  scheduleSave();
}

function currentStyleValue(element: EditElementInfo, property: string): string | undefined {
  switch (property) {
    case "opacity":
      return String(element.opacity);
    case "font-size":
      return element.fontSize === undefined ? undefined : `${element.fontSize}px`;
    case "color":
      return element.color;
    case "text-align":
      return element.align;
    case "background-color":
      return element.fill;
    default:
      return undefined;
  }
}

function resetPage(pageId: string): void {
  if (!sessions[pageId]) return;
  delete sessions[pageId];
  frameEpochs[pageId] = (frameEpochs[pageId] ?? 0) + 1;
  if (projectStore.selectedPageId === pageId) info = null;
}

projectStore.setEditorHooks({
  flush: () => flush(),
  reset: () => resetAll(),
  resetPage: (pageId: string) => resetPage(pageId),
});
