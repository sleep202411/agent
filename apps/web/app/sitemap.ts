import type { MetadataRoute } from "next";

import { discoverPublicContent } from "@/src/lib/seo/public-content";
import { isProtectedPath } from "@/src/lib/auth/protected-paths";
import { CANONICAL_HOST } from "@/src/lib/seo";

/** Static routes plus anonymous, published content from this deployment's services. */
const LOCALES = ["en-US", "zh-CN", "zh-HK"] as const;

const STATIC_PATHS = [
  { path: "/", priority: 1.0, changeFreq: "daily" as const },
  { path: "/ips", priority: 0.9, changeFreq: "daily" as const },
  { path: "/crews", priority: 0.9, changeFreq: "daily" as const },
  { path: "/creators", priority: 0.8, changeFreq: "daily" as const },
  { path: "/courses", priority: 0.7, changeFreq: "weekly" as const },
  { path: "/certificates/verify", priority: 0.6, changeFreq: "monthly" as const },
  { path: "/news", priority: 0.7, changeFreq: "daily" as const },
  // FAQ is high-priority for GEO: dense Q&A content is the format
  // LLM answer engines preferentially cite.
  { path: "/faq", priority: 0.8, changeFreq: "monthly" as const },
  { path: "/about", priority: 0.5, changeFreq: "monthly" as const },
  { path: "/privacy-policy", priority: 0.3, changeFreq: "yearly" as const },
  { path: "/terms-of-service", priority: 0.3, changeFreq: "yearly" as const },
  { path: "/refund-policy", priority: 0.3, changeFreq: "yearly" as const },
];

export function staticSitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const { path, priority, changeFreq } of STATIC_PATHS) {
    // Keep discovery aligned with the app's access policy; do not advertise login gates.
    if (isProtectedPath(path)) continue;
    for (const locale of LOCALES) {
      const normalised = path === "/" ? "" : path;
      entries.push({
        url: `${CANONICAL_HOST}/${locale}${normalised}`,
        lastModified: now,
        changeFrequency: changeFreq,
        priority,
        alternates: {
          languages: Object.fromEntries(
            LOCALES.map((l) => [l, `${CANONICAL_HOST}/${l}${normalised}`])
          ),
        },
      });
    }
  }

  return entries;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries = staticSitemap();
  await Promise.all(
    LOCALES.flatMap((locale) =>
      (["ips", "news", "courses"] as const).map(async (kind) => {
        try {
          const content = await discoverPublicContent(kind, locale);
          entries.push(
            ...content.map((item) => ({
              url: `${CANONICAL_HOST}/${locale}${item.path}`,
              ...(item.updated ? { lastModified: item.updated } : {}),
            }))
          );
        } catch (error) {
          // Failed sources contribute no potentially stale/private entries. Other
          // sections and the static sitemap remain available to crawlers.
          console.warn(
            `Sitemap ${kind}/${locale} unavailable:`,
            error instanceof Error ? error.message : "Invalid response"
          );
        }
      })
    )
  );
  return entries.sort((a, b) => a.url.localeCompare(b.url));
}
