import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWriteFile } from "../projects/atomic.ts";
import { resolveDataDir } from "../projects/home.ts";
import { searchDefaultsSchema, type SearchDefaults } from "./search.ts";
import { protectSecret, unprotectSecret } from "./dpapi.ts";

export const SEARCH_PROVIDERS = ["exa", "pexels"] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDERS)[number];

interface StoredSecret {
  protected: string;
  updatedAt: string;
}

type StoredFile = Partial<Record<SearchProviderId, StoredSecret>> & { defaults?: SearchDefaults };

export interface SearchCredentialStatus {
  configured: boolean;
  masked?: string;
}

let cache: Partial<Record<SearchProviderId, string>> | undefined;

export function credentialsFile(): string {
  return join(resolveDataDir(), "settings", "credentials.json");
}

async function loadStored(): Promise<StoredFile | undefined> {
  let raw: string;
  try {
    raw = await readFile(credentialsFile(), "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(raw) as StoredFile;
  } catch {
    return {};
  }
}

async function loadSecrets(): Promise<Partial<Record<SearchProviderId, string>>> {
  if (cache) return cache;
  const stored = (await loadStored()) ?? {};
  const secrets: Partial<Record<SearchProviderId, string>> = {};
  for (const provider of SEARCH_PROVIDERS) {
    const entry = stored[provider];
    if (!entry?.protected) continue;
    try {
      secrets[provider] = await unprotectSecret(entry.protected);
    } catch {
      continue;
    }
  }
  cache = secrets;
  return secrets;
}

async function writeStored(stored: StoredFile): Promise<void> {
  await mkdir(dirname(credentialsFile()), { recursive: true });
  await atomicWriteFile(credentialsFile(), `${JSON.stringify(stored, null, 2)}\n`);
  cache = undefined;
}

export async function getSearchKey(provider: SearchProviderId): Promise<string | undefined> {
  return (await loadSecrets())[provider];
}

export async function setSearchKey(provider: SearchProviderId, key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("The API key cannot be empty");
  const stored = (await loadStored()) ?? {};
  stored[provider] = { protected: await protectSecret(trimmed), updatedAt: new Date().toISOString() };
  await writeStored(stored);
}

export async function clearSearchKey(provider: SearchProviderId): Promise<void> {
  const stored = (await loadStored()) ?? {};
  delete stored[provider];
  await writeStored(stored);
}

export async function getSearchDefaults(): Promise<SearchDefaults> {
  const stored = await loadStored();
  if (!stored) {
    const defaults = searchDefaultsSchema.parse({ research: true, imageSearch: true });
    await writeStored({ defaults });
    return defaults;
  }
  const raw = stored.defaults;
  const secrets = await loadSecrets();
  const defaults = searchDefaultsSchema.parse({
    research: raw?.research,
    imageSearch: raw?.imageSearch,
    researchProvider: raw?.researchProvider ?? (secrets.exa ? "exa" : "ddgs"),
    imageProvider: raw?.imageProvider ?? (secrets.pexels ? "pexels" : "ddgs"),
  });
  if (raw?.researchProvider === undefined || raw?.imageProvider === undefined) {
    await writeStored({ ...stored, defaults });
  }
  return defaults;
}

export async function setSearchDefaults(defaults: SearchDefaults): Promise<void> {
  const stored = (await loadStored()) ?? {};
  stored.defaults = defaults;
  await writeStored(stored);
}

export async function searchCredentialStatus(): Promise<
  Record<SearchProviderId, SearchCredentialStatus>
> {
  const secrets = await loadSecrets();
  const status = {} as Record<SearchProviderId, SearchCredentialStatus>;
  for (const provider of SEARCH_PROVIDERS) {
    const key = secrets[provider];
    status[provider] = key
      ? { configured: true, masked: `${key.slice(0, 4)}…${key.slice(-4)}` }
      : { configured: false };
  }
  return status;
}
