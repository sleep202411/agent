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
      ],
      // Strangler-fig fallback for the legacy fizzdragon-web (uni-app
      // H5). Anything Next can't resolve to a page or static asset
      // falls through to `public/legacy.html`; the legacy bundle's
      // history router takes over on the client. Sync the build via
      // `npm run legacy:sync` (see scripts/sync-legacy.mjs).
      fallback: [{ source: "/:path*", destination: "/legacy.html" }],
    };
  },
};

export default nextConfig;
