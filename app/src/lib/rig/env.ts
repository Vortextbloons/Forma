import { dataDir as virtualDataDir, projectDir as virtualProjectDir } from "virtual:rig-env";

export interface RigEnv {

  projectDir: string;

  dataDir: string;
}

export const rigEnv: RigEnv = {
  projectDir: virtualProjectDir,
  dataDir: virtualDataDir,
};

export const projectDir = virtualProjectDir;

export const dataDir = virtualDataDir;

export function describeRigEnv(): string {
  return `project: ${projectDir || "(unset)"}, data: ${dataDir || "(unset)"}`;
}
