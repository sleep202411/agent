import type { SiteRegion } from "@/app/_components/region-provider";

/** Canonical FizzStudio hosts per deployment cell. */
export const STUDIO_ORIGINS: Record<SiteRegion, string> = {
  global: "https://studio.fizzdragon.com",
  cn: "https://studio.fizzspace.cn",
};

export const SITE_REGION_OPTIONS: SiteRegion[] = ["global", "cn"];

/** Absolute URL into another FizzStudio cell, preserving locale + path/query/hash. */
export function studioSiteRegionHref(
  region: SiteRegion,
  locale: string,
  pathWithSearchHash: string
): string {
  const raw = pathWithSearchHash.startsWith("/") ? pathWithSearchHash : `/${pathWithSearchHash}`;
  const match = raw.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  const pathname = match?.[1] || "/";
  const search = match?.[2] || "";
  const hash = match?.[3] || "";
  const suffix = pathname === "/" ? "" : pathname;
  return `${STUDIO_ORIGINS[region]}/${locale}${suffix}${search}${hash}`;
}
