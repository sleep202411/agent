import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl (no URL routing) — resolves locale per request from the
// NEXT_LOCALE cookie / Accept-Language. See i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Backend URLs are baked into the rewrite table at BUILD time (routes-manifest),
// and NEXT_PUBLIC_SITE_REGION is inlined into the client bundle. A missing value
// used to silently fall back to the .com host / `global` region — which sent
// non-.com cells' auth (/user), studio APIs (/api), and marketing links to the
// WRONG (intl) backend without any error. These are per-cell critical config:
// fail LOUD when unset (matches apps/web) so a mis-provisioned build never ships.
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required studio build env: ${name}. It is baked into the bundle ` +
        `at build time and must be passed per cell (see apps/studio/Dockerfile ` +
        `+ deploy/cn-remote-build.sh / deploy/deploy-com.sh). No silent .com fallback.`
    );
  }
  return value;
}

// Where to proxy `/aurora/*` (the NestJS backend). In-cluster this is
// http://fizzdragon-server:3001 with AURORA_STRIP_PREFIX=1 (Nest serves at root);
// on the public host the sibling -aurora-ingress handles /aurora before the pod.
const AURORA_TARGET = requiredEnv("AURORA_PROXY_TARGET");
const STRIP_PREFIX = process.env.AURORA_STRIP_PREFIX === "1";

// Java content backend — owns auth (/user/new/getCode, /user/new/login,
// /user/logout, and the authed onboarding calls the sign-in dialog makes).
// Same prefix contract as apps/web.
const JAVA_CONTENT = requiredEnv("JAVA_CONTENT_URL");

// Java studio backend — owns the art-studio world/project APIs
// (/api/user/world/*, /api/user/project/*). Same prefix contract as apps/web's
// JAVA_STUDIO_URL. The `/api/img` Next route is a filesystem route, so the
// array-form (afterFiles) rewrite below never shadows it.
const JAVA_STUDIO = requiredEnv("JAVA_STUDIO_URL");

// Inlined into the client bundle (web-base.ts region → register / legal links).
requiredEnv("NEXT_PUBLIC_SITE_REGION");

const nextConfig: NextConfig = {
  // Allow an isolated local instance without sharing the normal dev lock/cache.
  distDir: process.env.STUDIO_DEV_DIST_DIR || ".next",
  // Self-contained server bundle for the Docker runner stage.
  output: "standalone",
  // Project Skill preview URLs are materialized by the Nest control plane from
  // the deployment cell's trusted media origin. Keep the optimizer allowlist
  // path-scoped so arbitrary remote URLs cannot be proxied through Studio.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "r2.fizzdragon.com",
        port: "",
        pathname: "/product-skills/previews/**",
        search: "",
      },
      {
        protocol: "https",
        hostname: "media.fizzspace.cn",
        port: "",
        pathname: "/product-skills/previews/**",
        search: "",
      },
    ],
    maximumRedirects: 0,
  },
  // Let Azure Front Door compress at the edge, not the Next server. App-level
  // gzip + AFD over HTTP/2 double-compresses → net::ERR_HTTP2_PROTOCOL_ERROR
  // (CSS/JS chunks stall, blank page). Required before putting studio behind FD.
  compress: false,
  // Next.js `next dev` rewrite proxyTimeout defaults to 30s. AI content
  // review submit/query calls stay short; keep a wide proxy window for Excel
  // export on `/api/user/video/moderation/ai/exportExcel`.
  experimental: {
    proxyTimeout: 31 * 60 * 1000,
  },
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
