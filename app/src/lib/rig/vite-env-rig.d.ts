// Types for the `virtual:rig-env` module provided by app/vite.config.ts.
// The plugin bakes RIG_PROJECT_DIR (and RIG_DATA_DIR when set) into the bundle
// at build/dev-server time, so the app never reads process.env at runtime:
//   - `wails3 dev` / `npm run dev`: values come from the environment of the
//     Vite process (scripts/dev.ps1 sets RIG_PROJECT_DIR).
//   - packaged app (app/dist embedded in the Go binary): set RIG_PROJECT_DIR
//     when running `npm run build` to bake the data folder in; otherwise the
//     Go FileService still resolves RIG_PROJECT_DIR at runtime.
declare module "virtual:rig-env" {
  export const projectDir: string;
  export const dataDir: string;
  const rigEnv: { projectDir: string; dataDir: string };
  export default rigEnv;
}
