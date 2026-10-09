import { mount } from "svelte";
import "./app.css";
import "./forma.css";
import "./lib/rig/stores/layoutStore.svelte";
import App from "./App.svelte";
import { registerDefaultRenderers } from "./app/registerRenderers";
import { getBridge } from "./lib/rig/bridge";
import { workerStore } from "./lib/rig/stores/workerStore.svelte";

registerDefaultRenderers();

const target = document.getElementById("app");
if (!target) {
  throw new Error("Rig app: #app element not found");
}

const bridge = getBridge();

const app = mount(App, { target });

Object.assign(window as unknown as Record<string, unknown>, {
  __rig: {
    bridge,
    stores: {
      worker: workerStore,
    },
  },
});

export default app;
