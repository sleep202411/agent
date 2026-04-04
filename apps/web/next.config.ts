import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  skipTrailingSlashRedirect: true,
  async rewrites() {
    const contentUrl = process.env.JAVA_CONTENT_URL;
    const studioUrl = process.env.JAVA_STUDIO_URL;
    const serverUrl = process.env.SERVER_URL;

    const rules: Array<{ source: string; destination: string; locale: false }> = [];

    // ─── NestJS Server: /api/agent/*, /api/assistant/*
    if (serverUrl) {
      rules.push({
        source: "/api/agent/:path*",
        destination: `${serverUrl}/agent/:path*`,
        locale: false,
      });
      rules.push({
        source: "/api/assistant/:path*",
        destination: `${serverUrl}/assistant/:path*`,
        locale: false,
      });
    }

    // ─── Java Studio Service (8090): /api/*, /anon/*, /studio/*
    if (studioUrl) {
      // Trailing slash required by backend for these endpoints
      rules.push({
        source: "/api/user/world/static/list/proudct/type",
        destination: `${studioUrl}/api/user/world/static/list/proudct/type/`,
        locale: false,
      });
      rules.push({
        source: "/api/user/world/static/list/painting/style",
        destination: `${studioUrl}/api/user/world/static/list/painting/style/`,
        locale: false,
      });
      rules.push({ source: "/api/:path*", destination: `${studioUrl}/api/:path*`, locale: false });
      rules.push({
        source: "/anon/:path*",
        destination: `${studioUrl}/anon/:path*`,
        locale: false,
      });
      rules.push({
        source: "/studio/:path*",
        destination: `${studioUrl}/studio/:path*`,
        locale: false,
      });
    }

    // ─── Java Content Service (8091): /user/*, /project/*, /vedio/*, /content/*
    if (contentUrl) {
      rules.push({
        source: "/user/:path*",
        destination: `${contentUrl}/user/:path*`,
        locale: false,
      });
      rules.push({
        source: "/project/:path*",
        destination: `${contentUrl}/project/:path*`,
        locale: false,
      });
      rules.push({
        source: "/vedio/:path*",
        destination: `${contentUrl}/vedio/:path*`,
        locale: false,
      });
      rules.push({
        source: "/content/:path*",
        destination: `${contentUrl}/content/:path*`,
        locale: false,
      });
    }

    return rules;
  },
};

export default withNextIntl(nextConfig);
