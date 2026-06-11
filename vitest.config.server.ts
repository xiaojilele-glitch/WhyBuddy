import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  define: {
    // Vite injects these globals at build time. When running server-side tests
    // through vitest, files that transitively pull in the client store (via
    // `./api-client` -> `./store` -> `./deploy-target`) would otherwise crash
    // at module load with "__GITHUB_PAGES__ is not defined".
    __GITHUB_PAGES__: "false",
    __GITHUB_REPOSITORY__: JSON.stringify(""),
    __GITHUB_REPOSITORY_URL__: JSON.stringify(""),
  },
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "server/tests/**/*.test.ts",
      "server/__tests__/**/*.test.ts",
      "server/permission/**/*.test.ts",
      "server/routes/blueprint/**/*.test.ts",
      "server/routes/__tests__/**/*.test.ts",
      "server/whybuddy/__tests__/**/*.test.ts",
      "shared/**/*.test.ts",
      "client/src/lib/replay/__tests__/**/*.test.ts",
      "client/src/lib/blueprint-api/**/*.test.ts",
      "client/src/lib/autopilot/**/*.test.ts",
      "client/src/lib/blueprint/**/*.test.ts",
      "client/src/runtime/demo-data/__tests__/**/*.test.ts",
      "client/src/components/__tests__/**/*.test.ts",
      "services/lobster-executor/src/__tests__/**/*.test.ts",
      "client/src/pages/autopilot/**/streaming-doc/__tests__/*.test.ts",
      "client/src/pages/autopilot/**/spec-docs-progress/__tests__/*.property.test.ts",
    ],
  },
});
