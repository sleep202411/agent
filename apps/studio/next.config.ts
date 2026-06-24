import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl (no URL routing) — resolves locale per request from the
// NEXT_LOCALE cookie / Accept-Language. See i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Where to proxy `/aurora/*` (the NestJS backend).
//  - Prod (default): studio.fizzdragon.com, which keeps the `/aurora` prefix
//    (the ingress strips it before the server).
//  - Local dev: point AURORA_PROXY_TARGET at the local server (http://localhost:4399)
//    and set AURORA_STRIP_PREFIX=1 — the local server serves routes at root,
//    with no `/aurora` prefix.
const AURORA_TARGET = process.env.AURORA_PROXY_TARGET ?? "https://studio.fizzdragon.com";
const STRIP_PREFIX = process.env.AURORA_STRIP_PREFIX === "1";

// Java content backend — owns auth (/user/email/login, /user/login,
// /user/query/user/info, /user/logout). Same prefix contract as apps/web.
const JAVA_CONTENT = process.env.JAVA_CONTENT_URL ?? "https://java.fizzdragon.com/content";

// Java studio backend — owns the art-studio world/project APIs
// (/api/user/world/*, /api/user/project/*). Same prefix contract as apps/web's
// JAVA_STUDIO_URL. The `/api/img` Next route is a filesystem route, so the
// array-form (afterFiles) rewrite below never shadows it.
const JAVA_STUDIO = process.env.JAVA_STUDIO_URL ?? "https://java.fizzdragon.com/studio";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker runner stage.
  output: "standalone",
  // Let Azure Front Door compress at the edge, not the Next server. App-level
  // gzip + AFD over HTTP/2 double-compresses → net::ERR_HTTP2_PROTOCOL_ERROR
  // (CSS/JS chunks stall, blank page). Required before putting studio behind FD.
  compress: false,
  async rewrites() {
    return [
      {
        source: "/aurora/:path*",
        destination: STRIP_PREFIX ? `${AURORA_TARGET}/:path*` : `${AURORA_TARGET}/aurora/:path*`,
      },
      {
        source: "/user/:path*",
        destination: `${JAVA_CONTENT}/user/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${JAVA_STUDIO}/api/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
