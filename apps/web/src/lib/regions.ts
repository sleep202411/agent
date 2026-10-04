/**
 * IP region / country facet — web-side surface over the canonical curated
 * table in `@repo/shared` (packages/shared/src/regions.ts). The table lives
 * there so the server's `regionLabel` payload field and this UI can never
 * drift on sensitive region naming. Edit labels THERE, not here.
 *
 * This file keeps only the web-chrome strings for the facet UI.
 */
export { REGIONS, regionLabel, type RegionOption } from "@repo/shared";

type RegionLocale = "zh-CN" | "en-US" | "zh-HK";
type LocaleMap = Record<RegionLocale, string>;

function pick(map: LocaleMap, locale: string): string {
  return map[locale as RegionLocale] ?? map["en-US"];
}

// Chrome strings for the facet UI (filter "all", field label, placeholder).
const REGION_UI: Record<"all" | "field" | "placeholder", LocaleMap> = {
  all: { "zh-CN": "全部地区", "en-US": "All regions", "zh-HK": "全部地區" },
  field: { "zh-CN": "地区", "en-US": "Region", "zh-HK": "地區" },
  placeholder: {
    "zh-CN": "选择地区",
    "en-US": "Select region",
    "zh-HK": "選擇地區",
  },
};

export function regionUi(key: keyof typeof REGION_UI, locale: string): string {
  return pick(REGION_UI[key], locale);
}
