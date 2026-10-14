<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import Logo from "../components/Logo.svelte";
  import ProviderManager from "../models/ProviderManager.svelte";
  import ModelPicker from "../models/ModelPicker.svelte";
  import AssetsPanel from "./AssetsPanel.svelte";
  import DesignPanel from "./DesignPanel.svelte";
  import { workerStore } from "../rig/stores/workerStore.svelte";
  import { sessionStore } from "../rig/stores/sessionStore.svelte";
  import { notificationStore } from "../rig/stores/notificationStore.svelte";
  import { restartWorker, sendCommand } from "../rig/bridge";
  import { callNative, isNative } from "../rig/native";
  import { version } from "../../../../package.json";
  import { projectStore } from "./projectStore.svelte";
  import type { SearchProviderId } from "./types";
  import type { SearchDefaults } from "../../../../src/settings/search.ts";
  import { onMount } from "svelte";

  let {
    initialTab = "providers",
    onclose,
  }: {
    initialTab?: "providers" | "search" | "project" | "design" | "assets";
    onclose: () => void;
  } = $props();

  let tab = $state<"providers" | "search" | "project" | "design" | "assets">("providers");
  let exaKey = $state("");
  let pexelsKey = $state("");
  let saving = $state<SearchProviderId | null>(null);
  let savingDefaults = $state(false);
  let checkingUpdate = $state(false);
  let updating = $state(false);
  let native = $state(false);
  let latestVersion = $state("");
  let updateAvailable = $state(false);
  let updateMessage = $state("");

  const sessionStatus = $derived(sessionStore.statusOf(sessionStore.activeSessionId));
  const updateBlocked = $derived(
    projectStore.run !== null || projectStore.exportRun !== null ||
    sessionStatus === "running" || sessionStatus === "waiting" || sessionStatus === "approval" ||
    projectStore.saveStatus === "error",
  );

  const credentials = $derived(projectStore.searchCredentials);
  const searchOptions: Array<{ key: "research" | "imageSearch"; label: string }> = [
    { key: "research", label: "Web search" },
    { key: "imageSearch", label: "Image finder" },
  ];

  interface WorkerDiagnostics {
    worker: { pid: number; nodeVersion: string; platform: string; rigVersion: string };
    ddgs: { python: string; script: string; pythonFound: boolean; scriptFound: boolean };
  }

  let diagnostics = $state<WorkerDiagnostics | null>(null);
  let diagLoading = $state(false);
  let diagError = $state("");
  let searchTest = $state<"idle" | "running" | "done" | "failed">("idle");
  let searchTestMessage = $state("");
  let logBody = $state<HTMLElement | null>(null);

  const capabilities = $derived(workerStore.readyInfo?.capabilities ?? null);

  $effect(() => {
    const visible = tab === "project" || tab === "search";
    if (visible && workerStore.status === "ready") void loadDiagnostics();
  });

  $effect(() => {
    void workerStore.logs.length;
    logBody?.scrollTo({ top: logBody.scrollHeight });
  });

  async function loadDiagnostics(): Promise<void> {
    diagLoading = true;
    diagError = "";
    try {
      diagnostics = (await sendCommand("diagnostics.get")) as WorkerDiagnostics;
    } catch (error) {
      diagError = error instanceof Error ? error.message : String(error);
    } finally {
      diagLoading = false;
    }
  }

  async function testSearch(): Promise<void> {
    searchTest = "running";
    searchTestMessage = "";
    try {
      const data = await sendCommand("diagnostics.testSearch") as { count: number; first?: string };
      searchTest = "done";
      searchTestMessage = `Returned ${data.count} result${data.count === 1 ? "" : "s"}${data.first ? ` — "${data.first}"` : ""}`;
    } catch (error) {
      searchTest = "failed";
      searchTestMessage = error instanceof Error ? error.message : String(error);
    }
  }

  function logTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false });
  }

  onMount(() => {
    tab = initialTab;
    void projectStore.refreshSearchCredentials();
    void checkUpdate();
  });

  async function checkUpdate(): Promise<void> {
    native = await isNative();
    if (!native) return;
    checkingUpdate = true;
    updateMessage = "";
    try {
      const info = await callNative<{ latestVersion: string; available: boolean }>(
        "rigdesktop/services.UpdateService.Check",
      );
      latestVersion = info.latestVersion;
      updateAvailable = info.available;
      updateMessage = info.available ? `Version ${info.latestVersion} is available.` : "Forma is up to date.";
    } catch (error) {
      updateMessage = error instanceof Error ? error.message : String(error);
    } finally {
      checkingUpdate = false;
    }
  }

  async function installUpdate(): Promise<void> {
    updating = true;
    updateMessage = "Downloading and verifying the update… Forma will reopen automatically.";
    try {
      await projectStore.flushProjectChanges();
      await callNative("rigdesktop/services.UpdateService.Install");
    } catch (error) {
      updateMessage = error instanceof Error ? error.message : String(error);
      updating = false;
    }
  }

  async function saveKey(provider: SearchProviderId): Promise<void> {
    const key = provider === "exa" ? exaKey : pexelsKey;
    if (!key.trim()) return;
    saving = provider;
    try {
      await projectStore.setSearchKey(provider, key.trim());
      if (provider === "exa") exaKey = "";
      else pexelsKey = "";
      notificationStore.push({
        type: "success",
        message: `${provider === "exa" ? "Exa" : "Pexels"} key saved`,
      });
    } catch (error) {
      notificationStore.push({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      saving = null;
    }
  }

  async function clearKey(provider: SearchProviderId): Promise<void> {
    try {
      await projectStore.clearSearchKey(provider);
    } catch (error) {
      notificationStore.push({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function saveDefault(key: "research" | "imageSearch", enabled: boolean): Promise<void> {
    savingDefaults = true;
    try {
      await projectStore.setSearchDefaults({ ...projectStore.searchDefaults, [key]: enabled });
    } catch (error) {
      notificationStore.push({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      savingDefaults = false;
    }
  }

  async function saveProvider(key: "researchProvider" | "imageProvider", value: string): Promise<void> {
    savingDefaults = true;
    try {
      const defaults: SearchDefaults = { ...projectStore.searchDefaults };
      if (key === "researchProvider") defaults.researchProvider = value as SearchDefaults["researchProvider"];
      else defaults.imageProvider = value as SearchDefaults["imageProvider"];
      await projectStore.setSearchDefaults(defaults);
    } catch (error) {
      notificationStore.push({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      savingDefaults = false;
    }
  }

  function setProjectSearch(key: "research" | "imageSearch", value: string): void {
    const project = projectStore.current?.project;
    if (!project) return;
    projectStore.updateSettings({ ...project.settings, [key]: value === "default" ? null : value === "on" });
  }

  function onOverlayKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !updating) onclose();
  }
</script>

<div
  class="modal-overlay"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget && !updating) onclose();
  }}
  onkeydown={onOverlayKeydown}
>
  <div
    class="modal forma-settings"
    role="dialog"
    aria-modal="true"
    aria-busy={updating}
    aria-label="Settings"
    tabindex="-1"
  >
    <div class="modal-head">
      <span class="settings-title"><Logo size={20} /> <span class="modal-title">Settings</span></span>
      <button class="icon-btn" type="button" title="Close" aria-label="Close settings" disabled={updating} onclick={onclose}>
        <Icon name="x" size={16} />
      </button>
    </div>
    <div class="modal-body">
      <nav class="settings-nav" aria-label="Settings sections" inert={updating}>
        {#if projectStore.current}
          <button type="button" class:settings-nav-active={tab === "design"} onclick={() => (tab = "design")}>Design settings</button>
          <button type="button" class:settings-nav-active={tab === "assets"} onclick={() => (tab = "assets")}>Project materials</button>
        {/if}
        <button
          type="button"
          class:settings-nav-active={tab === "providers"}
          onclick={() => (tab = "providers")}
        >Providers & models</button>
        <button
          type="button"
          class:settings-nav-active={tab === "search"}
          onclick={() => (tab = "search")}
        >Web &amp; images</button>
        <button
          type="button"
          class:settings-nav-active={tab === "project"}
          onclick={() => (tab = "project")}
        >App & worker</button>
      </nav>

      <div class="settings-pane">
        {#if tab === "design"}
          <DesignPanel />
        {:else if tab === "assets"}
          <AssetsPanel />
        {:else if tab === "providers"}
          <div class="field">
            <span class="field-label">Providers</span>
            <ProviderManager />
          </div>
          <div class="field">
            <span class="field-label">Model</span>
            <ModelPicker />
          </div>
        {:else if tab === "search"}
          <div class="field">
            <span class="field-label">Global defaults</span>
            <p class="muted small">Used by projects that follow the global default.</p>
            {#each searchOptions as option (option.key)}
              <label class="toggle-row">
                <input
                  type="checkbox"
                  checked={projectStore.searchDefaults[option.key]}
                  disabled={savingDefaults}
                  onchange={(event) => void saveDefault(option.key, event.currentTarget.checked)}
                />
                <span>{option.label}</span>
              </label>
            {/each}
          </div>
          <div class="field">
            <span class="field-label">Providers</span>
            <p class="muted small">Used by every project.</p>
            <label class="field">
              <span class="field-label">Web search</span>
              <select
                class="input"
                value={projectStore.searchDefaults.researchProvider}
                disabled={savingDefaults || projectStore.run !== null}
                onchange={(event) => void saveProvider("researchProvider", event.currentTarget.value)}
              >
                <option value="ddgs">Built-in web search — included</option>
                <option value="exa">Exa — API key</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Image finder</span>
              <select
                class="input"
                value={projectStore.searchDefaults.imageProvider}
                disabled={savingDefaults || projectStore.run !== null}
                onchange={(event) => void saveProvider("imageProvider", event.currentTarget.value)}
              >
                <option value="ddgs">Built-in image search — included</option>
                <option value="pexels">Pexels — API key</option>
              </select>
            </label>
          </div>
          {#if projectStore.current}
            <div class="field">
              <span class="field-label">This project · {projectStore.current.project.name}</span>
              <p class="muted small">Override either default for this project. Changes are saved automatically.</p>
              {#each searchOptions as option (option.key)}
                <label class="field">
                  <span class="field-label">{option.label}</span>
                  <select
                    class="input"
                    value={projectStore.current.project.settings[option.key] === null ? "default" : projectStore.current.project.settings[option.key] ? "on" : "off"}
                    disabled={projectStore.run !== null}
                    onchange={(event) => setProjectSearch(option.key, event.currentTarget.value)}
                  >
                    <option value="default">Use global default ({projectStore.searchDefaults[option.key] ? "on" : "off"})</option>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </label>
              {/each}
            </div>
          {/if}
          {#if projectStore.searchDefaults.researchProvider === "exa"}
            <div class="field">
              <span class="field-label">Exa — web search</span>
              <p class="muted small">
                Add an API key to use web search.
                {#if credentials.exa.configured}
                  <span class="badge">Configured · {credentials.exa.masked}</span>
                {:else}
                  <span class="badge">Not configured</span>
                {/if}
              </p>
              <div class="field-row">
                <input
                  class="input"
                  type="password"
                  placeholder="Exa API key"
                  bind:value={exaKey}
                  aria-label="Exa API key"
                />
                <button
                  class="btn"
                  type="button"
                  disabled={saving !== null || exaKey.trim() === ""}
                  onclick={() => void saveKey("exa")}
                >Save</button>
                {#if credentials.exa.configured}
                  <button class="btn btn-ghost" type="button" onclick={() => void clearKey("exa")}>Remove</button>
                {/if}
              </div>
            </div>
          {:else}
            <div class="field">
              <span class="field-label">Web search</span>
              <p class="muted small"><span class="badge">Included · No API key needed</span></p>
            </div>
          {/if}
          {#if projectStore.searchDefaults.imageProvider === "pexels"}
            <div class="field">
              <span class="field-label">Pexels — image finder</span>
              <p class="muted small">
                Add an API key to find photos.
                {#if credentials.pexels.configured}
                  <span class="badge">Configured · {credentials.pexels.masked}</span>
                {:else}
                  <span class="badge">Not configured</span>
                {/if}
              </p>
              <div class="field-row">
                <input
                  class="input"
                  type="password"
                  placeholder="Pexels API key"
                  bind:value={pexelsKey}
                  aria-label="Pexels API key"
                />
                <button
                  class="btn"
                  type="button"
                  disabled={saving !== null || pexelsKey.trim() === ""}
                  onclick={() => void saveKey("pexels")}
                >Save</button>
                {#if credentials.pexels.configured}
                  <button class="btn btn-ghost" type="button" onclick={() => void clearKey("pexels")}>Remove</button>
                {/if}
              </div>
            </div>
          {:else}
            <div class="field">
              <span class="field-label">Image finder</span>
              <p class="muted small"><span class="badge">Included · No API key needed</span></p>
            </div>
          {/if}
          <div class="field">
            <span class="field-label">Built-in search — how it works</span>
            <p class="muted small">
              The built-in provider runs a bundled Python helper (the ddgs package) that queries DuckDuckGo
              for web pages and photos. No key or account needed. Searches run one at a time and time out
              after 30 seconds.
            </p>
            {#if diagError}
              <p class="error-text small">{diagError}</p>
            {:else if diagnostics}
              <div class="diag-grid">
                <div class="diag-item">
                  <span class="diag-key">Python runtime</span>
                  <span class="diag-value mono" title={diagnostics.ddgs.python}>{diagnostics.ddgs.python}</span>
                  <span class="badge" class:badge-ok={diagnostics.ddgs.pythonFound} class:badge-missing={!diagnostics.ddgs.pythonFound}>
                    {diagnostics.ddgs.pythonFound ? "Found" : "Missing"}
                  </span>
                </div>
                <div class="diag-item">
                  <span class="diag-key">Helper script</span>
                  <span class="diag-value mono" title={diagnostics.ddgs.script}>{diagnostics.ddgs.script}</span>
                  <span class="badge" class:badge-ok={diagnostics.ddgs.scriptFound} class:badge-missing={!diagnostics.ddgs.scriptFound}>
                    {diagnostics.ddgs.scriptFound ? "Found" : "Missing"}
                  </span>
                </div>
              </div>
              <div class="field-row">
                <button class="btn" type="button" disabled={searchTest === "running"} onclick={() => void testSearch()}>
                  {searchTest === "running" ? "Searching…" : "Test search"}
                </button>
                {#if searchTest === "done"}
                  <span class="muted small">{searchTestMessage}</span>
                {:else if searchTest === "failed"}
                  <span class="error-text small">{searchTestMessage}</span>
                {/if}
              </div>
            {:else}
              <p class="muted small">{diagLoading ? "Reading worker diagnostics…" : "Diagnostics unavailable."}</p>
            {/if}
          </div>
          <p class="muted small">
            Keys are stored per user, outside projects, and protected with Windows DPAPI.
          </p>
        {:else}
          <div class="field">
            <span class="field-label">Forma</span>
            <div class="field-row">
              <span class="badge">Version {version}</span>
              {#if native}
                <button class="btn" type="button" disabled={checkingUpdate || updating || updateBlocked} onclick={() => void (updateAvailable ? installUpdate() : checkUpdate())}>
                  {updating ? "Updating…" : checkingUpdate ? "Checking…" : updateAvailable ? `Update to ${latestVersion}` : "Check for updates"}
                </button>
              {/if}
            </div>
            <p class="muted small" role="status">{native ? updateMessage : "Updates are available in the desktop app."}</p>
            {#if updateAvailable && updateBlocked}<p class="muted small">Finish the current task and save your changes before updating.</p>{/if}
          </div>
          <div class="field">
            <span class="field-label">Worker</span>
            <div class="field-row">
              <span class="badge badge-{workerStore.status}"><span class="dot"></span>{workerStore.status}</span>
              <button class="btn" type="button" disabled={updating} onclick={() => void restartWorker()}>Restart worker</button>
            </div>
            {#if diagError}
              <p class="error-text small">Could not read worker diagnostics: {diagError}</p>
            {/if}
            <div class="diag-grid">
              <div class="diag-item">
                <span class="diag-key">Agent</span>
                <span class="diag-value">{workerStore.readyInfo?.agentName ?? "—"}</span>
              </div>
              <div class="diag-item">
                <span class="diag-key">Project directory</span>
                <span class="diag-value mono" title={workerStore.readyInfo?.projectDir}>{workerStore.readyInfo?.projectDir ?? "—"}</span>
              </div>
              {#if diagnostics}
                <div class="diag-item">
                  <span class="diag-key">Process</span>
                  <span class="diag-value mono">PID {diagnostics.worker.pid} · Node {diagnostics.worker.nodeVersion} · Rig {diagnostics.worker.rigVersion}</span>
                </div>
                <div class="diag-item">
                  <span class="diag-key">Platform</span>
                  <span class="diag-value mono">{diagnostics.worker.platform}</span>
                </div>
              {:else if diagLoading}
                <div class="diag-item">
                  <span class="diag-key">Process</span>
                  <span class="diag-value muted">Reading…</span>
                </div>
              {/if}
              <div class="diag-item">
                <span class="diag-key">Restarts</span>
                <span class="diag-value mono">{workerStore.restarts}</span>
              </div>
            </div>
            {#if capabilities}
              <div class="diag-chips">
                <span class="badge">{capabilities.models} models</span>
                {#each capabilities.providers as provider (provider)}
                  <span class="badge">{provider}</span>
                {/each}
                {#if capabilities.git}<span class="badge">git</span>{/if}
                {#if capabilities.worktrees}<span class="badge">worktrees</span>{/if}
                {#if capabilities.web}<span class="badge">web</span>{/if}
                {#if capabilities.desktop}<span class="badge">desktop</span>{/if}
                {#each capabilities.mcp as server (server)}
                  <span class="badge">mcp · {server}</span>
                {/each}
                {#each capabilities.subagents as subagent (subagent)}
                  <span class="badge">subagent · {subagent}</span>
                {/each}
              </div>
            {/if}
            {#if workerStore.lastError}
              <p class="error-text small">Last error: {workerStore.lastError.message}</p>
            {/if}
          </div>
          <div class="field">
            <span class="field-label">Worker activity</span>
            <div class="worker-log" bind:this={logBody} role="log" aria-label="Worker activity">
              {#each workerStore.logs.slice(-150) as entry (entry.id)}
                <div class="worker-log-line worker-log-{entry.level}">
                  <span class="worker-log-time">{logTime(entry.timestamp)}</span>
                  <span class="worker-log-msg">{entry.message || "—"}</span>
                </div>
              {:else}
                <span class="worker-log-empty">No worker activity yet.</span>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
