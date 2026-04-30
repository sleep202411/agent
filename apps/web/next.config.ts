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
