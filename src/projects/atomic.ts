import { open, rename, rm } from "node:fs/promises";

export async function atomicWriteFile(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  const handle = await open(tmp, "w");
  try {
    if (typeof data === "string") {
      await handle.writeFile(data, "utf8");
    } else {
      await handle.writeFile(data);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}
