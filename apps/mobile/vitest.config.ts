import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "world-player/**/*.test.ts"],
  },
});
