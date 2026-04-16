import { config as dotenvConfig } from "dotenv";
import { defineConfig } from "vite";

// Load .env.local into process.env (Vite only auto-loads VITE_ prefixed vars)
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

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
    tanstackStart(),
    viteReact(),
    nitro({
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
    }),
  ],
  server: {
    port: 3000,
  },
});
