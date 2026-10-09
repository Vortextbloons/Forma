import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";



function rigEnv(): Plugin {
  const projectDir = process.env.RIG_PROJECT_DIR ?? "";
  const dataDir = process.env.RIG_DATA_DIR ?? projectDir;
  const code = [
    `export const projectDir = ${JSON.stringify(projectDir)};`,
    `export const dataDir = ${JSON.stringify(dataDir)};`,
    `export default { projectDir, dataDir };`,
    "",
  ].join("\n");
  return {
    name: "rig-env",
    resolveId(id) {
      if (id === "virtual:rig-env") return "\0virtual:rig-env";
      return null;
    },
    load(id) {
      if (id === "\0virtual:rig-env") return code;
      return null;
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [svelte(), rigEnv()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {


    host: "127.0.0.1",
    port: 5173,
  },
});
