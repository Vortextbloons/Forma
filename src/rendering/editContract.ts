// Typed contract between the Edit-mode canvas (host app) and the edit script
// running inside the sandboxed artwork iframe.

/** Structural child indices from the `.forma-page` root element. */
export type EditPath = number[];

export type EditElementKind = "text" | "shape" | "image" | "group";

export interface EditRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditElementInfo {
  path: EditPath;
  kind: EditElementKind;
  rect: EditRect;
  translate: { x: number; y: number };
  opacity: number;
  resizable: "free" | "ratio" | false;
  fill?: string;
  editableText?: boolean;
  fontSize?: number;
  color?: string;
  align?: "left" | "center" | "right" | "justify";
}

/** A single property-level change. Values are absolute (not deltas). */
export type EditOp =
  | { kind: "move"; path: EditPath; x: number; y: number }
  | { kind: "resize"; path: EditPath; width: number; height: number }
  | { kind: "style"; path: EditPath; styles: Record<string, string> }
  | { kind: "text"; path: EditPath; node: number; value: string };

export interface EditHistoryEntry {
  before: EditOp[];
  after: EditOp[];
}

/** Message bodies posted from the edit iframe to the host app. */
export type EditFrameBody =
  | { type: "forma:edit-ready" }
  | { type: "forma:edit-selected"; info: EditElementInfo }
  | { type: "forma:edit-cleared" }
  | { type: "forma:edit-commit"; before: EditOp[]; after: EditOp[] }
  | { type: "forma:edit-text-start"; op: EditOp }
  | { type: "forma:edit-text-input"; op: EditOp }
  | { type: "forma:edit-text-end"; op: EditOp | null; cancelled: boolean }
  | { type: "forma:edit-cancelled" }
  | { type: "forma:edit-info"; info: EditElementInfo }
  | { type: "forma:edit-undo" }
  | { type: "forma:edit-redo" }
  | { type: "forma:edit-source"; seq: number; html: string }
  | { type: "forma:page-wheel"; deltaY: number };

/** Messages posted from the edit iframe to the host app. */
export type EditFrameMessage = EditFrameBody & { pageId: string; rev: string };

/** Messages posted from the host app into the edit iframe. */
export type EditCommandMessage =
  | { type: "forma:edit-init"; rev: string; html: string }
  | { type: "forma:edit-apply"; rev: string; ops: EditOp[] }
  | { type: "forma:edit-select"; rev: string; path: EditPath }
  | { type: "forma:edit-clear"; rev: string }
  | { type: "forma:edit-pause"; rev: string; paused: boolean }
  | { type: "forma:edit-serialize"; rev: string; seq: number; finishText?: boolean };

export function isEditFrameMessage(data: unknown): data is EditFrameMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as { type?: unknown }).type === "string" &&
    ((data as { type: string }).type.startsWith("forma:edit-") ||
      (data as { type: string }).type === "forma:page-wheel") &&
    typeof (data as { pageId?: unknown }).pageId === "string" &&
    typeof (data as { rev?: unknown }).rev === "string"
  );
}
