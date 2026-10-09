type RuntimeModule = typeof import("@wailsio/runtime");

let runtimePromise: Promise<RuntimeModule | null> | undefined;

function loadRuntime(): Promise<RuntimeModule | null> {
  if (!runtimePromise) {
    runtimePromise = import("@wailsio/runtime")
      .then((m) => m)
      .catch(() => null);
  }
  return runtimePromise;
}

function detectWailsWindow(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    chrome?: { webview?: { postMessage?: unknown } };
    webkit?: { messageHandlers?: { external?: { postMessage?: unknown } } };
    wails?: { invoke?: unknown; invokeAsync?: unknown };
    _wails?: { environment?: { OS?: unknown } };
  };
  return (
    typeof w.chrome?.webview?.postMessage === "function" ||
    typeof w.webkit?.messageHandlers?.external?.postMessage === "function" ||
    typeof w.wails?.invoke === "function" ||
    typeof w.wails?.invokeAsync === "function" ||
    typeof w._wails?.environment?.OS === "string"
  );
}

export async function isNative(): Promise<boolean> {
  try {
    const mod = await loadRuntime();
    if (!mod) return false;
    if (mod.getTransport() !== null) return true;
  } catch {
    return false;
  }
  return detectWailsWindow();
}

export async function callNative<T = unknown>(
  methodName: string,
  args: unknown[] = [],
): Promise<T> {
  const mod = await loadRuntime();
  if (!mod) {
    console.info(`[rig] native runtime unavailable: ${methodName}`);
    throw new Error("native runtime unavailable");
  }
  return (await mod.Call.Call({ methodName, args })) as T;
}

const WORKSPACE_OPEN_PATH = "rigdesktop/services.WorkspaceService.OpenPath";
const WORKSPACE_REVEAL_IN_FOLDER = "rigdesktop/services.WorkspaceService.RevealInFolder";


export async function nativeOpenPath(path: string): Promise<void> {
  await callNative(WORKSPACE_OPEN_PATH, [path]);
}


export async function nativeRevealInFolder(path: string): Promise<void> {
  await callNative(WORKSPACE_REVEAL_IN_FOLDER, [path]);
}


export async function openUrl(url: string): Promise<void> {
  try {
    await nativeOpenPath(url);
    return;
  } catch {

  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
