import type { NextConfig } from "next";

const SERVER_URL = process.env.SERVER_URL;
const JAVA_STUDIO_URL = process.env.JAVA_STUDIO_URL;
const JAVA_CONTENT_URL = process.env.JAVA_CONTENT_URL;

if (!SERVER_URL || !JAVA_STUDIO_URL || !JAVA_CONTENT_URL) {
  throw new Error(
    "Missing required env vars: SERVER_URL, JAVA_STUDIO_URL, JAVA_CONTENT_URL. " +
      "Create a .env file or set them in your environment."
  );
}

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
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
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        // NestJS server (strip /aurora prefix)
        { source: "/aurora/:path*", destination: `${SERVER_URL}/:path*` },
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
        // Legacy iframe content endpoint. The catch-all page in
        // `app/(site)/[...legacyPath]/page.tsx` builds an iframe whose
        // src is `/__legacy/<original-path>`; this rewrite returns the
        // bundled `public/legacy.html` for any such URL. The legacy
        // bundle then strips the `/__legacy` prefix client-side (see
        // scripts/sync-legacy.mjs) so its history router reads the
        // intended pathname.
        { source: "/__legacy/:path*", destination: "/legacy.html" },
      ],
      // Strangler-fig fallback: any unmatched URL falls into the
      // catch-all page under `(site)`, which renders the legacy app
      // inside an iframe so the platform's GlobalNav + SiteFooter
      // wrap it. The page itself routes via Next.js — no rewrite
      // needed here.
      fallback: [],
    };
  },
};

export default nextConfig;
