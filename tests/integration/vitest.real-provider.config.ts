import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    fileParallelism: true,
    globalSetup: ["./global-setup.ts"],
    hookTimeout: 120_000,
    include: ["real/**/*.test.ts"],
    maxConcurrency: 20,
    name: "@bb/integration-tests:real",
    silent: "passed-only",
    testTimeout: 120_000,
  },
});
