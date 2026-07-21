import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for app-level logic that is worth pinning down without a
 * browser: the sign-in dialog's wiring, message-file coverage.
 *
 * `include` is an allow-list on purpose. `app/play/_lib/*.test.ts` are
 * node:test suites with their own runner (`npm run test:experience-player`,
 * which needs `--conditions=react-server`); vitest cannot execute them, so
 * it must not try.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["components/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
  },
});
