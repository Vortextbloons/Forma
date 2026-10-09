





import { sendCommand } from "../bridge";
import type { ProviderInfo, RigEvent } from "../types";
import { modelStore } from "./modelStore.svelte";
import { notificationStore } from "./notificationStore.svelte";

let providers = $state<ProviderInfo[]>([]);
let busyIds = $state<string[]>([]);

function setBusy(id: string, value: boolean): void {
  const i = busyIds.indexOf(id);
  if (value && i === -1) busyIds.push(id);
  if (!value && i !== -1) busyIds.splice(i, 1);
}

export function isBusy(id: string): boolean {
  return busyIds.includes(id);
}

function parseList(data: unknown): ProviderInfo[] {
  const list = (data as { providers?: unknown } | null)?.providers;
  if (!Array.isArray(list)) return [];
  const out: ProviderInfo[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id === "string") {
      out.push({
        id: r.id,
        name: typeof r.name === "string" ? r.name : undefined,
        configured: r.configured === true,
        authStatus: typeof r.authStatus === "string" ? r.authStatus : "unknown",
      });
    }
  }
  return out;
}

function upsert(provider: ProviderInfo): void {
  const i = providers.findIndex((p) => p.id === provider.id);
  if (i === -1) providers.push(provider);
  else providers[i] = { ...providers[i]!, ...provider };
}

export async function refresh(): Promise<void> {
  try {
    const data = await sendCommand("listProviders");
    providers.length = 0;
    providers.push(...parseList(data));
  } catch {

  }
}

export async function status(id: string): Promise<void> {
  try {
    const data = await sendCommand("providerStatus", { providerId: id });
    const raw = (data as { provider?: unknown } | null)?.provider;
    if (typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>).id === "string") {
      upsert(parseList({ providers: [raw] })[0]!);
    }
  } catch {

  }
}

export async function login(id: string): Promise<void> {
  setBusy(id, true);
  try {
    await sendCommand("providerLogin", { providerId: id });
    await refresh();
    await modelStore.refresh();
  } catch (error) {
    notificationStore.push({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    setBusy(id, false);
    void status(id);
  }
}

export async function logout(id: string): Promise<void> {
  setBusy(id, true);
  try {
    await sendCommand("providerLogout", { providerId: id });
    await refresh();
    await modelStore.refresh();
  } catch (error) {
    notificationStore.push({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    setBusy(id, false);
    void status(id);
  }
}

export function handleEvent(_event: RigEvent): void {

}

export const providerStore = {
  get providers() {
    return providers;
  },
  isBusy,
  refresh,
  status,
  login,
  logout,
  handleEvent,
};
