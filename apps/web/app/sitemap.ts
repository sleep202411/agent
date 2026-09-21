import type { MetadataRoute } from "next";

import { isProtectedPath } from "@/src/lib/auth/protected-paths";
import { CANONICAL_HOST } from "@/src/lib/seo";

/**
 * Static sitemap — covers every route that doesn't depend on
 * runtime data. Dynamic listings (IPs, articles, courses, crews)
 * should each ship their own `sitemap.ts` under `app/(site)/<route>/`
 * so Next.js renders them as separate sitemap files referenced
 * from this index.
 *
 * One entry per locale per route. Google treats different-locale
 * URLs as different documents and expects each one in the sitemap
 * — without per-locale entries the zh-CN / zh-HK pages stay
 * effectively invisible.
 *
 * `lastModified` is "now" because static routes redeploy with
 * every release. Dynamic sitemaps should pull `updateTime` from
 * the underlying entity.
 */
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

export default function sitemap(): MetadataRoute.Sitemap {
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
