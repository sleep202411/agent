import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    sequence: { concurrent: false },
  },
});
