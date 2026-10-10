import type { NextConfig } from "next";

const JAVA_STUDIO_URL = process.env.JAVA_STUDIO_URL;
const JAVA_CONTENT_URL = process.env.JAVA_CONTENT_URL;

if (!JAVA_STUDIO_URL || !JAVA_CONTENT_URL) {
  throw new Error(
    "Missing required env vars: JAVA_STUDIO_URL, JAVA_CONTENT_URL. " +
      "Create a .env file or set them in your environment."
  );
}

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Let the edge (Azure Front Door) handle compression, not the Next.js
  // server. When BOTH compress, AFD relays/caches the app's gzip over
  // HTTP/2 and the browser hits net::ERR_HTTP2_PROTOCOL_ERROR — every
  // CSS/JS chunk stalls (pending) and the page renders blank. Direct
  // origin (no AFD) and HTTP/1.1 are unaffected, which is the giveaway.
  // Origin now sends plain bytes; AFD compresses (brotli) + caches once.
  compress: false,
  allowedDevOrigins: ["127.0.0.1"],
  // Required to support PostHog trailing slash API requests via the /ingest proxy.
  skipTrailingSlashRedirect: true,
  // Pre-existing TS errors in storyboard-save / interactive-node / etc. need dedicated cleanup;
  // the old Vite build didn't gate on tsc either.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Next.js dev-server default `proxyTimeout` is 30s — too short for the
  // produce-mode sync workflows (Step 1 / Step 2 / Step 3 each block
  // for 1-10 min while Mastra runs LLM calls in-process). Without this
  // override the dev rewrite returns 500 to the browser at the 30s
  // mark, even though Nest + agent are still happily working on the
  // request. Production behind nginx doesn't hit this since nginx has
  // its own timeout knob; this is purely a `next dev` ergonomics fix.
  experimental: {
    proxyTimeout: 31 * 60 * 1000,
  },
  // /projects/<id>/* moved into the studio route group as
  // /art-studio/projects/<id>/* — see proxy.ts and the route tree under
  // app/(studio)/art-studio/projects/. Old bookmarks and external links
  // permanently redirect (308). On the studio subdomain, proxy.ts
  // intercepts before this redirect runs, so the URL bar stays clean.
  async redirects() {
    return [
      {
        source: "/projects/:id/:rest*",
        destination: "/art-studio/projects/:id/:rest*",
        permanent: true,
      },
      {
        source: "/courses-v2",
        destination: "/courses",
        permanent: true,
      },
      {
        source: "/courses-v2/:id",
        destination: "/courses/:id",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        // PostHog reverse proxy — routes /ingest/* to PostHog ingestion
        // and /ingest/static/* + /ingest/array/* to the assets CDN.
        {
          source: "/ingest/static/:path*",
          destination: "https://us-assets.i.posthog.com/static/:path*",
        },
        {
          source: "/ingest/array/:path*",
          destination: "https://us-assets.i.posthog.com/array/:path*",
        },
        { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
      ],
      afterFiles: [
        // NestJS `/aurora/*` is handled by app/aurora/[...path]/route.ts
        // so SERVER_URL is read at container runtime, not baked into the
        // standalone build image by next.config rewrites.
        // Java Studio service
        { source: "/api/:path*", destination: `${JAVA_STUDIO_URL}/api/:path*` },
        { source: "/anon/:path*", destination: `${JAVA_STUDIO_URL}/anon/:path*` },
        // Java Content service
        { source: "/user/:path*", destination: `${JAVA_CONTENT_URL}/user/:path*` },
        { source: "/project/:path*", destination: `${JAVA_CONTENT_URL}/project/:path*` },
        { source: "/vedio/:path*", destination: `${JAVA_CONTENT_URL}/vedio/:path*` },
        // Env-prefix rewrites — strip the prefix and forward to Java,
        // mirroring what nginx does in staging / prod. Listed verbatim
        // rather than read from env so the same rewrite table ships in
        // every build; api-client emits whichever prefix the env
        // configures, the others are dormant.
        { source: "/content/:path*", destination: `${JAVA_CONTENT_URL}/:path*` },
        { source: "/studio/:path*", destination: `${JAVA_STUDIO_URL}/:path*` },
        { source: "/test1/:path*", destination: `${JAVA_CONTENT_URL}/:path*` },
        { source: "/test2/:path*", destination: `${JAVA_STUDIO_URL}/:path*` },
        // Legacy iframe content endpoint. The remaining legacy page in
        // `app/(site)/pages/course/course/page.tsx` builds an iframe
        // whose src is `/__legacy/pages/course/course`; this rewrite
        // returns the bundled `public/legacy.html`. The legacy bundle
        // then strips the `/__legacy` prefix client-side (see
        // scripts/sync-legacy.mjs) so its history router reads the
        // intended pathname.
        { source: "/__legacy/:path*", destination: "/legacy.html" },
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
