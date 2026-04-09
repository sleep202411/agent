import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3001";
const JAVA_STUDIO_URL = process.env.JAVA_STUDIO_URL || "http://120.26.152.164:8090";
const JAVA_CONTENT_URL = process.env.JAVA_CONTENT_URL || "http://120.26.152.164:8091";

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
        "/content/**": { proxy: `${JAVA_CONTENT_URL}/content/**` },
      },
    }),
  ],
  server: {
    port: 3000,
  },
});
