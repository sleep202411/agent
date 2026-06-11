import type { NextConfig } from "next";

// Where to proxy `/aurora/*` (the NestJS backend).
//  - Prod (default): studio.fizzdragon.com, which keeps the `/aurora` prefix
//    (the ingress strips it before the server).
//  - Local dev: point AURORA_PROXY_TARGET at the local server (http://localhost:4399)
//    and set AURORA_STRIP_PREFIX=1 — the local server serves routes at root,
//    with no `/aurora` prefix.
const AURORA_TARGET = process.env.AURORA_PROXY_TARGET ?? "https://studio.fizzdragon.com";
const STRIP_PREFIX = process.env.AURORA_STRIP_PREFIX === "1";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker runner stage.
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/aurora/:path*",
        destination: STRIP_PREFIX ? `${AURORA_TARGET}/:path*` : `${AURORA_TARGET}/aurora/:path*`,
      },
    ];
  },
};

export default nextConfig;
