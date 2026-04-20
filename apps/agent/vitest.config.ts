import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share a single Redis instance and flush it per-test,
    // so parallel test files would race. One worker at a time keeps the test
    // suite deterministic. Within a file tests still run in order by default.
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
  },
});
