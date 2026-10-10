import os from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 60_000,
    fileParallelism: true,
    pool: "forks",
    maxWorkers: os.availableParallelism(),
    isolate: false,
    server: {
      deps: {
        inline: [/@earendil-works\/.*/],
      },
    },
  },
});
