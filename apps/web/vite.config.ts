import { config as dotenvConfig } from "dotenv";
import { defineConfig } from "vite";

// Load .env.local into process.env (Vite only auto-loads VITE_ prefixed vars)
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

const SERVER_URL = process.env.SERVER_URL;
const JAVA_STUDIO_URL = process.env.JAVA_STUDIO_URL;
const JAVA_CONTENT_URL = process.env.JAVA_CONTENT_URL;

if (!SERVER_URL || !JAVA_STUDIO_URL || !JAVA_CONTENT_URL) {
  throw new Error(
    "Missing required env vars: SERVER_URL, JAVA_STUDIO_URL, JAVA_CONTENT_URL. " +
      "Create a .env file or set them in your environment."
  );
}

export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      server: {
        routeRules: {
          // NestJS server (strip /aurora prefix)
          "/aurora/**": { proxy: `${SERVER_URL}/**` },
          // Java Studio service
          "/api/**": { proxy: `${JAVA_STUDIO_URL}/api/**` },
          "/anon/**": { proxy: `${JAVA_STUDIO_URL}/anon/**` },
          "/studio/**": { proxy: `${JAVA_STUDIO_URL}/studio/**` },
          // Java Content service
          "/user/**": { proxy: `${JAVA_CONTENT_URL}/user/**` },
          "/project/**": { proxy: `${JAVA_CONTENT_URL}/project/**` },
          "/vedio/**": { proxy: `${JAVA_CONTENT_URL}/vedio/**` },
          // News API — proxy to production
          "/newsapi/**": { proxy: "https://fizzdragon.com/content/**" },
        },
      },
    }),
    viteReact(),
  ],
  server: {
    port: 3000,
    proxy: {
      "/aurora": {
        target: SERVER_URL,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/aurora/, ""),
      },
      "/api": { target: JAVA_STUDIO_URL, changeOrigin: true },
      "/anon": { target: JAVA_STUDIO_URL, changeOrigin: true },
      "/studio": { target: JAVA_STUDIO_URL, changeOrigin: true },
      "/user": { target: JAVA_CONTENT_URL, changeOrigin: true },
      "/project": { target: JAVA_CONTENT_URL, changeOrigin: true },
      "/vedio": { target: JAVA_CONTENT_URL, changeOrigin: true },
    },
  },
});
