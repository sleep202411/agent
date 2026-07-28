import { fileURLToPath, URL } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Unit tests for app-level logic that is worth pinning down without a
 * browser: the sign-in dialog's wiring, message-file coverage, and
 * feature-colocated logic under `app/`.
 *
 * `app/play/_lib/*.test.ts` are node:test suites with their own runner
 * (`npm run test:experience-player`, which needs
 * `--conditions=react-server`); vitest cannot execute them, so they are
 * excluded by name — everything else colocated under `app/` runs here.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: [
      "app/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
      "src/**/*.test.{ts,tsx}",
      // Root-level app infra (the Next.js locale/studio-routing proxy).
      "proxy.test.ts",
    ],
    exclude: [...configDefaults.exclude, "app/play/_lib/**"],
    environment: "jsdom",
  },
});
