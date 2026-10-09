import type { NextConfig } from "next";

const rawBasePath = process.env.NEXT_PUBLIC_ADMIN_UI_BASE_PATH?.trim() ?? "";
const basePath = rawBasePath === "/" ? "" : rawBasePath.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  ...(basePath ? { basePath } : {}),
  // css-tree loads JSON under data/ at runtime; Next file tracing often omits
  // those assets from standalone and SSR then throws MODULE_NOT_FOUND.
  outputFileTracingIncludes: {
    "/**": ["../../node_modules/css-tree/data/**/*"],
  },
};

export default nextConfig;
