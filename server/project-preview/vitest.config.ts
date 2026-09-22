import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/project-preview/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
