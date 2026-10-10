import { getBridge, openProjectDir, sendCommand, waitForReady } from "../rig/bridge";
import { notificationStore } from "../rig/stores/notificationStore.svelte";
import { sessionStore } from "../rig/stores/sessionStore.svelte";
import { messageStore } from "../rig/stores/messageStore.svelte";
import { modelStore } from "../rig/stores/modelStore.svelte";
import { isFormaDomainEvent, type FormaDomainEvent, type SessionStatus } from "../rig/types";
import {
  parseProjectLibrary,
  parseProjectSnapshot,
  parseSearchCredentials,
  parseStoredExtraction,
  parseValidationReport,
  type ContextRole,
  type FormaRunState,
  type ProjectFile,
  type ProjectListEntry,
  type ProjectSettings,
  type ProjectSnapshot,
  type SearchCredentialStatus,
  type SearchProviderId,
  type StoredExtraction,
  type ValidationReport,
} from "./types";

export type SaveStatus = "saved" | "saving" | "error";
export type ChatTarget = { scope: "page" | "project"; pageId?: string };

let current = $state<ProjectSnapshot | null>(null);
let library = $state<ProjectListEntry[]>([]);
let libraryHome = $state("");
let boundDir = $state("");
let saveStatus = $state<SaveStatus>("saved");
let lastError = $state<string | null>(null);
let run = $state<FormaRunState | null>(null);
let validation = $state<ValidationReport | null>(null);
let validating = $state(false);
let selectedPageId = $state<string | null>(null);
let zoom = $state<number | "fit">("fit");
let needsImageModel = $state(false);
let composed = $state<Record<string, { html: string; missing: string[] }>>({});
let searchCredentials = $state<Record<SearchProviderId, SearchCredentialStatus>>({
  exa: { configured: false },
  pexels: { configured: false },
});

let opening = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSettings: ProjectSettings | null = null;

const GENERATING_STATUSES: SessionStatus[] = ["running", "waiting", "approval"];
const composing = new Map<string, Promise<string | null>>();

function reportError(error: unknown, action: string): void {
  const message = error instanceof Error ? error.message : String(error);
  lastError = message;
  notificationStore.push({ type: "error", message: `${action}: ${message}` });
}

async function stopActiveGeneration(): Promise<void> {
  const sessionId = sessionStore.activeSessionId;
  if (!sessionId || !GENERATING_STATUSES.includes(sessionStore.statusOf(sessionId))) return;
  try {
    await sendCommand("abort", { sessionId }, { timeoutMs: 5_000 });
  } catch {
    lastError = null;
  }
}

export async function loadProjects(): Promise<void> {
  try {
    const parsed = parseProjectLibrary(await sendCommand("project.list"));
    library = parsed.projects;
    libraryHome = parsed.home;
  } catch {
    library = [];
  }
}

export interface CreateProjectInput {
  name: string;
  prompt: string;
  mode: "plan" | "create";
  settings: ProjectSettings;
}

export async function createProject(input: CreateProjectInput): Promise<void> {
  await stopActiveGeneration();
  await flushProjectChanges();
  opening = true;
  saveStatus = "saving";
  try {
    const created = await sendCommand(
      "project.create",
      {
        name: input.name,
        prompt: input.prompt,
        mode: input.mode,
        settings: input.settings,
      },
      { timeoutMs: 0 },
    );
    const createdSnapshot = parseProjectSnapshot(created);
    await openProjectDir(createdSnapshot.dir);
    await waitForReady(60_000);
    const data = await sendCommand(
      "project.open",
      { dir: createdSnapshot.dir },
      { timeoutMs: 60_000 },
    );
    await attach(parseProjectSnapshot(data));
  } catch (error) {
    saveStatus = "error";
    throw error;
  } finally {
    opening = false;
  }
}

export async function openProject(dir: string): Promise<void> {
  await stopActiveGeneration();
  await flushProjectChanges();
  opening = true;
  saveStatus = "saving";
  try {
    await openProjectDir(dir);
    await waitForReady(60_000);
    const data = await sendCommand("project.open", { dir }, { timeoutMs: 60_000 });
    await attach(parseProjectSnapshot(data));
  } catch (error) {
    saveStatus = "error";
    throw error;
  } finally {
    opening = false;
  }
}

async function attach(snapshot: ProjectSnapshot): Promise<void> {
  current = snapshot;
  boundDir = snapshot.dir;
  saveStatus = "saved";
  lastError = null;
  run = null;
  validation = null;
  composed = {};
  selectedPageId = snapshot.project.pages[0] ?? null;
  needsImageModel = false;
  await loadProjects();
  await refreshSearchCredentials();
  await ensureConversation();
}

export async function ensureConversation(): Promise<void> {
  if (!current) return;
  const ids = [...current.project.conversation.sessionIds].reverse();
  for (const id of ids) {
    if (await sessionStore.resume(id)) return;
  }
  await newChat();
}

export async function newChat(): Promise<void> {
  if (!current || run) return;
  const info = await sessionStore.newSession("Project chat");
  if (info) {
    await setConversation([...current.project.conversation.sessionIds, info.id]);
  } else {
    reportError(new Error("Could not create a session. Try again."), "Could not start a new chat");
  }
}

export async function selectChat(id: string): Promise<void> {
  if (!current || run || !current.project.conversation.sessionIds.includes(id)) return;
  if (!await sessionStore.resume(id)) {
    reportError(new Error("The conversation could not be loaded. Try again."), "Could not open chat");
  }
}

async function setConversation(sessionIds: string[]): Promise<void> {
  if (!current) return;
  try {
    const data = await sendCommand("project.setConversation", {
      dir: current.dir,
      sessionIds,
    });
    current = parseProjectSnapshot(data);
  } catch (error) {
    reportError(error, "Could not record the conversation");
  }
}

export async function refreshProject(): Promise<void> {
  if (!current) return;
  try {
    const data = await sendCommand("project.open", { dir: current.dir }, { timeoutMs: 60_000 });
    current = parseProjectSnapshot(data);
  } catch {
    // the worker may be restarting; events will repopulate state
  }
}

export function updateSettings(settings: ProjectSettings): void {
  if (!current) return;
  pendingSettings = settings;
  current = { ...current, project: { ...current.project, settings } };
  composed = {};
  validation = null;
  saveStatus = "saving";
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushSettings();
  }, 350);
}

export interface BriefPatch {
  name?: string;
  prompt?: string;
  mode?: ProjectFile["mode"];
}

let pendingBrief: BriefPatch | null = null;
let briefTimer: ReturnType<typeof setTimeout> | undefined;
let briefSaving: Promise<void> | undefined;
let settingsSaving: Promise<void> | undefined;
let outlineSaving: Promise<void> | undefined;
let outlineTimer: ReturnType<typeof setTimeout> | undefined;
let pendingOutline: Parameters<typeof updateOutline>[0] | null = null;

export function updateBrief(patch: BriefPatch): void {
  if (!current) return;
  pendingBrief = { ...(pendingBrief ?? {}), ...patch };
  current = { ...current, project: { ...current.project, ...patch } };
  saveStatus = "saving";
  if (briefTimer) clearTimeout(briefTimer);
  briefTimer = setTimeout(() => {
    void flushBrief();
  }, 350);
}

async function flushBrief(): Promise<void> {
  await briefSaving;
  const patch = pendingBrief;
  if (!patch || !current) return;
  pendingBrief = null;
  const dir = current.dir;
  briefSaving = (async () => {
    try {
      const data = await sendCommand("project.updateBrief", { dir, ...patch });
      applyProjectPayload(data);
      saveStatus = pendingBrief || pendingSettings ? "saving" : "saved";
      if (patch.name !== undefined) await loadProjects();
    } catch (error) {
      pendingBrief = { ...patch, ...(pendingBrief ?? {}) };
      saveStatus = "error";
      reportError(error, "Could not save the brief");
    }
  })();
  await briefSaving;
}

async function flushSettings(): Promise<void> {
  await settingsSaving;
  const settings = pendingSettings;
  if (!settings || !current) return;
  pendingSettings = null;
  const dir = current.dir;
  settingsSaving = (async () => {
    try {
      const data = await sendCommand("project.updateSettings", { dir, settings });
      applyProjectPayload(data);
      saveStatus = pendingBrief || pendingSettings ? "saving" : "saved";
    } catch (error) {
      pendingSettings ??= settings;
      saveStatus = "error";
      reportError(error, "Could not save design settings");
    }
  })();
  await settingsSaving;
}

async function flushProjectChanges(): Promise<void> {
  clearTimeout(briefTimer);
  clearTimeout(saveTimer);
  await flushBrief();
  await flushSettings();
  await flushOutline();
  if (pendingBrief || pendingSettings || pendingOutline || saveStatus === "error") {
    throw new Error("Save the project changes before starting.");
  }
}

export function needsDesignApply(): boolean {
  const project = current?.project;
  if (!project || project.pages.length === 0) return false;
  return project.artworkRevision !== project.settingsRevision;
}

function expectedPages(): number {
  const project = current?.project;
  if (!project) return 0;
  if (project.settings.output === "poster") return 1;
  return project.outline?.length ?? project.settings.slideCount;
}

async function startArtwork(
  command: "artwork.plan" | "artwork.generate" | "artwork.applyDesign" | "artwork.refine",
  params: Record<string, unknown>,
  kind: FormaRunState["kind"],
  failureLabel: string,
): Promise<void> {
  if (!current || run) return;
  const sessionId = sessionStore.activeSessionId;
  run = {
    kind,
    total: expectedPages(),
    completed: 0,
    startedAt: new Date().toISOString(),
  };
  needsImageModel = false;
  try {
    await flushProjectChanges();
    const data = await sendCommand(
      command,
      { dir: current.dir, ...params, model: modelStore.selectedModel, ...(sessionId ? { sessionId } : {}) },
      { timeoutMs: 0 },
    );
    applyProjectPayload(data);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "CANCELLATION_ERROR") {
      void refreshProject();
    } else {
      reportError(error, failureLabel);
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { details?: { reason?: string } }).details?.reason === "images-unsupported"
      ) {
        needsImageModel = true;
      }
    }
  } finally {
    run = null;
  }
}

function applyProjectPayload(data: unknown): void {
  try {
    const snapshot = parseProjectSnapshot(data);
    current = { ...snapshot, project: { ...snapshot.project, ...(pendingBrief ?? {}), settings: pendingSettings ?? snapshot.project.settings } };
    if (!selectedPageId || !current.project.pages.includes(selectedPageId)) {
      selectedPageId = current.project.pages[0] ?? null;
    }
    saveStatus = "saved";
  } catch {
    // commands without a project payload leave the current snapshot alone
  }
}

export async function plan(): Promise<void> {
  if (run) return;
  updateBrief({ mode: "plan" });
  await startArtwork("artwork.plan", {}, "outline", "Could not draft the outline");
}

export async function generate(): Promise<void> {
  if (run) return;
  updateBrief({ mode: "create" });
  await startArtwork("artwork.generate", {}, "artwork", "Could not generate the artwork");
}

export async function applyDesign(): Promise<void> {
  if (run) return;
  updateBrief({ mode: "create" });
  await startArtwork("artwork.applyDesign", {}, "design", "Could not apply the design changes");
}

export async function sendRefine(
  message: string,
  target: ChatTarget,
  mode: "plan" | "build" = "build",
): Promise<void> {
  const sessionId = sessionStore.activeSessionId;
  if (!current || run || !sessionId) return;
  messageStore.addUserMessage(sessionId, message);
  await startArtwork(
    "artwork.refine",
    {
      scope: target.scope,
      ...(target.scope === "page" && target.pageId ? { pageId: target.pageId } : {}),
      message,
      mode,
    },
    "refine",
    "Could not apply the refinement",
  );
}

export async function sendChat(
  message: string,
  target: ChatTarget,
  mode: "plan" | "build" = "build",
): Promise<void> {
  await sendRefine(message, target, mode);
}

export function stageOutline(outline: Parameters<typeof updateOutline>[0]): void {
  pendingOutline = outline;
  saveStatus = "saving";
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(() => { void flushOutline(); }, 600);
}

async function flushOutline(): Promise<void> {
  clearTimeout(outlineTimer);
  await outlineSaving;
  if (!pendingOutline) return;
  const outline = pendingOutline;
  pendingOutline = null;
  outlineSaving = updateOutline(outline);
  await outlineSaving;
}

export async function updateOutline(
  outline: Array<{
    id?: string;
    title: string;
    points: string[];
    visualDirection?: string;
    assetIds: string[];
  }>,
): Promise<void> {
  if (!current) return;
  saveStatus = "saving";
  try {
    const data = await sendCommand("artwork.updateOutline", { dir: current.dir, outline });
    applyProjectPayload(data);
    saveStatus = "saved";
  } catch (error) {
    pendingOutline ??= outline;
    saveStatus = "error";
    reportError(error, "Could not save the outline");
  }
}

export async function reorderPage(pageId: string, toIndex: number): Promise<void> {
  if (!current) return;
  try {
    const data = await sendCommand("artwork.reorder", {
      dir: current.dir,
      pageId,
      toIndex,
    });
    current = parseProjectSnapshot(data);
  } catch (error) {
    reportError(error, "Could not reorder the slides");
  }
}

export async function duplicatePage(pageId: string): Promise<void> {
  if (!current) return;
  try {
    const data = await sendCommand("artwork.duplicate", { dir: current.dir, pageId });
    current = parseProjectSnapshot(data);
  } catch (error) {
    reportError(error, "Could not duplicate the slide");
  }
}

export async function deletePage(pageId: string): Promise<void> {
  if (!current) return;
  try {
    const data = await sendCommand("artwork.delete", { dir: current.dir, pageId });
    current = parseProjectSnapshot(data);
    if (selectedPageId === pageId) {
      selectedPageId = current.project.pages[0] ?? null;
    }
  } catch (error) {
    reportError(error, "Could not delete the slide");
  }
}

export function selectPage(pageId: string): void {
  selectedPageId = pageId;
}

export function setZoom(value: number | "fit"): void {
  zoom = value;
}

export async function composePage(pageId: string): Promise<string | null> {
  const snapshot = current;
  if (!snapshot) return null;
  const cached = composed[pageId];
  if (cached) return cached.html;
  const pending = composing.get(pageId);
  if (pending) return pending;
  const promise = sendCommand(
    "artwork.compose",
    { dir: snapshot.dir, pageId },
    { timeoutMs: 60_000 },
  )
    .then((data) => {
      const html = (data as { html?: unknown } | null)?.html;
      const missing = (data as { missing?: unknown } | null)?.missing;
      if (typeof html !== "string") throw new Error("The worker returned an invalid page");
      composed = {
        ...composed,
        [pageId]: { html, missing: Array.isArray(missing) ? (missing as string[]) : [] },
      };
      return html;
    })
    .catch((error: unknown) => {
      reportError(error, "Could not render the page");
      return null;
    })
    .finally(() => {
      composing.delete(pageId);
    });
  composing.set(pageId, promise);
  return promise;
}

export async function validateArtwork(): Promise<void> {
  if (!current || validating) return;
  validating = true;
  try {
    const data = await sendCommand("rendering.validate", { dir: current.dir }, { timeoutMs: 0 });
    const report = parseValidationReport(data);
    if (report) validation = report;
  } catch (error) {
    reportError(error, "Validation failed");
  } finally {
    validating = false;
  }
}

export async function importContext(paths: string[], role: ContextRole): Promise<number> {
  if (!current || paths.length === 0) return 0;
  let imported = 0;
  saveStatus = "saving";
  for (const path of paths) {
    try {
      const data = await sendCommand(
        "context.import",
        { dir: current.dir, path, role },
        { timeoutMs: 0 },
      );
      current = parseProjectSnapshot(data);
      imported += 1;
    } catch (error) {
      reportError(error, `Could not import "${path}"`);
    }
  }
  saveStatus = imported > 0 ? "saved" : "error";
  return imported;
}

export async function importNote(text: string, role: ContextRole, name?: string): Promise<void> {
  if (!current) return;
  saveStatus = "saving";
  try {
    const data = await sendCommand(
      "context.importNote",
      { dir: current.dir, text, role, ...(name ? { name } : {}) },
      { timeoutMs: 0 },
    );
    current = parseProjectSnapshot(data);
    saveStatus = "saved";
  } catch (error) {
    saveStatus = "error";
    reportError(error, "Could not add the note");
  }
}

export async function contextText(id: string): Promise<StoredExtraction | null> {
  if (!current) return null;
  try {
    const data = await sendCommand("context.getText", { dir: current.dir, id });
    return parseStoredExtraction(data);
  } catch (error) {
    reportError(error, "Could not load the extracted text");
    return null;
  }
}

export async function updateContext(
  id: string,
  patch: { name?: string; role?: ContextRole },
): Promise<void> {
  if (!current) return;
  saveStatus = "saving";
  try {
    const data = await sendCommand("context.update", { dir: current.dir, id, ...patch });
    current = parseProjectSnapshot(data);
    saveStatus = "saved";
  } catch (error) {
    saveStatus = "error";
    reportError(error, "Could not update the context item");
  }
}

export async function removeContext(id: string): Promise<void> {
  if (!current) return;
  saveStatus = "saving";
  try {
    const data = await sendCommand("context.remove", { dir: current.dir, id });
    current = parseProjectSnapshot(data);
    saveStatus = "saved";
  } catch (error) {
    saveStatus = "error";
    reportError(error, "Could not remove the context item");
  }
}

export async function refreshSearchCredentials(): Promise<void> {
  try {
    const parsed = parseSearchCredentials(await sendCommand("settings.getSearch"));
    if (parsed) searchCredentials = parsed;
  } catch {
    // keep the previous status
  }
}

export async function setSearchKey(provider: SearchProviderId, key: string): Promise<void> {
  const parsed = parseSearchCredentials(
    await sendCommand("settings.setSearchKey", { provider, key }),
  );
  if (parsed) searchCredentials = parsed;
}

export async function clearSearchKey(provider: SearchProviderId): Promise<void> {
  const parsed = parseSearchCredentials(
    await sendCommand("settings.clearSearchKey", { provider }),
  );
  if (parsed) searchCredentials = parsed;
}

export async function renameProject(dir: string, name: string): Promise<void> {
  const data = await sendCommand("project.rename", { dir, name });
  const snapshot = parseProjectSnapshot(data);
  if (current?.dir === dir) current = snapshot;
  await loadProjects();
}

export async function duplicateProject(dir: string): Promise<void> {
  await sendCommand("project.duplicate", { dir });
  await loadProjects();
}

export async function deleteProject(dir: string): Promise<void> {
  if (current?.dir === dir) current = null;
  if (boundDir === dir && libraryHome) {
    await openProjectDir(libraryHome);
    await waitForReady(60_000);
    boundDir = "";
  }
  await sendCommand("project.delete", { dir });
  await loadProjects();
}

export async function closeProject(): Promise<void> {
  await stopActiveGeneration();
  try { await flushProjectChanges(); } catch { return; }
  current = null;
  selectedPageId = null;
  run = null;
  validation = null;
  composed = {};
  saveStatus = "saved";
  lastError = null;
}

export async function stopGeneration(): Promise<void> {
  const sessionId = sessionStore.activeSessionId;
  if (!sessionId) return;
  try {
    await sendCommand("abort", { sessionId }, { timeoutMs: 5_000 });
  } catch (error) {
    reportError(error, "Could not stop the run");
  }
}

function patchPageFromEvent(event: FormaDomainEvent): void {
  if (!current) return;
  const pageId = event.data.pageId;
  const index = event.data.index;
  const title = event.data.title;
  const assets = event.data.assets;
  if (typeof pageId !== "string" || typeof index !== "number") return;
  const pages = [...current.project.pages];
  const existing = pages.indexOf(pageId);
  if (existing === -1) {
    pages.splice(Math.max(0, index - 1), 0, pageId);
  } else if (existing !== index - 1) {
    pages.splice(existing, 1);
    pages.splice(Math.max(0, index - 1), 0, pageId);
  }
  const previous = current.project.pageMeta[pageId];
  current = {
    ...current,
    project: {
      ...current.project,
      pages,
      pageMeta: {
        ...current.project.pageMeta,
        [pageId]: {
          title: typeof title === "string" && title ? title : (previous?.title ?? ""),
          assets: Array.isArray(assets)
            ? (assets as string[])
            : (previous?.assets ?? []),
          updatedAt: event.timestamp,
        },
      },
    },
  };
}

function patchContextFromEvent(event: FormaDomainEvent): void {
  if (!current) return;
  const id = event.data.id;
  if (typeof id !== "string") return;
  const status = event.data.status;
  const error = event.data.error;
  const extraction = event.data.extraction;
  current = {
    ...current,
    project: {
      ...current.project,
      context: current.project.context.map((item) =>
        item.id === id
          ? {
              ...item,
              status: status === "error" ? "error" : "ready",
              ...(typeof error === "string" ? { error } : { error: undefined }),
              ...(extraction && typeof extraction === "object"
                ? { extraction: extraction as NonNullable<typeof item.extraction> }
                : {}),
            }
          : item,
      ),
    },
  };
}

function handleFormaEvent(event: FormaDomainEvent): void {
  if (!current || event.projectId !== current.project.id) return;
  switch (event.type) {
    case "forma.run.progress": {
      if (event.data.phase !== "started") return;
      const kind = event.data.kind;
      const total = event.data.total;
      if (kind !== "outline" && kind !== "artwork" && kind !== "refine" && kind !== "design") return;
      run = {
        kind,
        total: typeof total === "number" ? total : 0,
        completed: 0,
        startedAt: event.timestamp,
      };
      break;
    }
    case "forma.page.ready": {
      patchPageFromEvent(event);
      const pageId = event.data.pageId;
      if (typeof pageId === "string") {
        const { [pageId]: _removed, ...rest } = composed;
        composed = rest;
      }
      validation = null;
      if (run) run = { ...run, completed: run.completed + 1 };
      break;
    }
    case "forma.outline.ready": {
      const outline = event.data.outline;
      if (Array.isArray(outline)) {
        current = {
          ...current,
          project: {
            ...current.project,
            outline: outline as ProjectFile["outline"],
          },
        };
      }
      break;
    }
    case "forma.context.ready": {
      patchContextFromEvent(event);
      break;
    }
    case "forma.validation.ready": {
      const issues = event.data.issues;
      const pages = event.data.pages;
      const renderError = event.data.renderError;
      if (Array.isArray(issues)) {
        validation = {
          issues: issues as ValidationReport["issues"],
          pages: typeof pages === "number" ? pages : 0,
          checkedAt: event.timestamp,
          ...(typeof renderError === "string" ? { renderError } : {}),
        };
      }
      break;
    }
    case "forma.run.settled": {
      run = null;
      void refreshProject();
      break;
    }
    default:
      break;
  }
}

getBridge().onReady(() => {
  if (!opening && current) {
    void ensureConversation();
    void refreshProject();
    void refreshSearchCredentials();
  }
});

getBridge().onWorkerExit(() => {
  run = null;
});

getBridge().onEvent((event) => {
  if (isFormaDomainEvent(event)) handleFormaEvent(event);
});

export const projectStore = {
  get current() {
    return current;
  },
  get projects() {
    return library;
  },
  get libraryHome() {
    return libraryHome;
  },
  get saveStatus() {
    return saveStatus;
  },
  get lastError() {
    return lastError;
  },
  get run() {
    return run;
  },
  get validation() {
    return validation;
  },
  get validating() {
    return validating;
  },
  get selectedPageId() {
    return selectedPageId;
  },
  get zoom() {
    return zoom;
  },
  get needsImageModel() {
    return needsImageModel;
  },
  get composed() {
    return composed;
  },
  get searchCredentials() {
    return searchCredentials;
  },
  get needsDesignApply() {
    return needsDesignApply();
  },
  loadProjects,
  createProject,
  openProject,
  renameProject,
  duplicateProject,
  deleteProject,
  updateSettings,
  updateBrief,
  updateOutline,
  stageOutline,
  plan,
  generate,
  applyDesign,
  sendChat,
  sendRefine,
  reorderPage,
  duplicatePage,
  deletePage,
  selectPage,
  setZoom,
  composePage,
  validateArtwork,
  importContext,
  importNote,
  contextText,
  updateContext,
  removeContext,
  refreshSearchCredentials,
  setSearchKey,
  clearSearchKey,
  refreshProject,
  closeProject,
  ensureConversation,
  newChat,
  selectChat,
  stopGeneration,
};
