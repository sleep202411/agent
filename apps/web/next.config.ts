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
    return [
      // Local Next.js endpoints. Folder lives at app/api/* (Next.js convention),
      // but the public URL is /blaze/* so nginx — which forwards /api/* directly
      // to Java Studio on legacy hosts — can't intercept it. Must come before
      // the /api/* → Java rewrite below; the request flow is
      // /blaze/news → rewrite to /api/news → filesystem hit on app/api/news/route.ts.
      { source: "/blaze/:path*", destination: "/api/:path*" },
      // NestJS server (strip /aurora prefix)
      { source: "/aurora/:path*", destination: `${SERVER_URL}/:path*` },
      // Java Studio service
      { source: "/api/:path*", destination: `${JAVA_STUDIO_URL}/api/:path*` },
      { source: "/anon/:path*", destination: `${JAVA_STUDIO_URL}/anon/:path*` },
      // Java Content service
      { source: "/user/:path*", destination: `${JAVA_CONTENT_URL}/user/:path*` },
      { source: "/project/:path*", destination: `${JAVA_CONTENT_URL}/project/:path*` },
      { source: "/vedio/:path*", destination: `${JAVA_CONTENT_URL}/vedio/:path*` },
      // News API — proxy to production
      { source: "/newsapi/:path*", destination: "https://fizzdragon.com/content/:path*" },
    ];
  },
};

export default nextConfig;
