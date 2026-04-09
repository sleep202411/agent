import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    nitro(),
  ],
  server: {
    port: 3000,
    proxy: {
      // NestJS server (unified /aurora prefix)
      "/aurora/": {
        target: process.env.SERVER_URL || "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/aurora/, ""),
      },
      // Java Studio service
      "/api": {
        target: process.env.JAVA_STUDIO_URL || "http://120.26.152.164:8090",
        changeOrigin: true,
      },
      "/anon": {
        target: process.env.JAVA_STUDIO_URL || "http://120.26.152.164:8090",
        changeOrigin: true,
      },
      "/studio": {
        target: process.env.JAVA_STUDIO_URL || "http://120.26.152.164:8090",
        changeOrigin: true,
      },
      // Java Content service
      // Java Content service — use trailing-slash prefix to avoid
      // catching frontend routes like /projects, /users, etc.
      "/user/": {
        target: process.env.JAVA_CONTENT_URL || "http://120.26.152.164:8091",
        changeOrigin: true,
      },
      "/project/": {
        target: process.env.JAVA_CONTENT_URL || "http://120.26.152.164:8091",
        changeOrigin: true,
      },
      "/vedio/": {
        target: process.env.JAVA_CONTENT_URL || "http://120.26.152.164:8091",
        changeOrigin: true,
      },
      "/content/": {
        target: process.env.JAVA_CONTENT_URL || "http://120.26.152.164:8091",
        changeOrigin: true,
      },
    },
  },
});
