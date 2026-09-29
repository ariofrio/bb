import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    hookTimeout: 60_000,
    env: {
      BB_DATA_DIR: "/tmp/bb-integration-test",
      BB_SERVER_PORT: "49161",
      BB_SERVER_URL: "http://127.0.0.1:49161",
      BB_HOST_DAEMON_PORT: "49162",
      SCRIPTED_ECHO_OPTIONS: JSON.stringify({ uniqueProviderThreadIds: true }),
    },
    silent: "passed-only",
    testTimeout: 60_000,
    projects: [
      {
        extends: true,
        test: {
          name: "@bb/integration-tests",
          fileParallelism: true,
          isolate: false,
          globalSetup: ["./global-setup.ts"],
          include: ["fake/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "@bb/integration-tests:native-roots-golden",
          include: ["native-roots-golden/**/*.test.ts"],
        },
      },
    ],
  },
});
