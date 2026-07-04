/**
 * IP region / country facet — the CANONICAL curated table.
 *
 * `Ip.region` stores an ISO-3166 alpha-2 code or the sentinel "GLOBAL".
 * Display names are maintained BY HAND here, deliberately NOT derived from
 * Intl.DisplayNames / CLDR: region naming is politically sensitive and the
 * wording must stay under our editorial control, not an ICU data file's
 * (decision 2026-07-04). A code not in this table renders as the raw code —
 * neutral and visible — until someone adds a curated entry.
 *
 * Consumers: apps/web (plaza filter, create-IP dropdown, card badge — via
 * src/lib/regions.ts re-export) and apps/server ip-commerce (the `regionLabel`
 * field in public IP payloads). Extend REGIONS as new markets appear; labels
 * for all three locales are required.
 */
export type RegionLocale = "zh-CN" | "en-US" | "zh-HK";
type LocaleMap = Record<RegionLocale, string>;

export interface RegionOption {
  code: string;
  labels: LocaleMap;
}

// Ordered: GLOBAL first, then roughly by catalog volume / region.
export const REGIONS: RegionOption[] = [
  { code: "GLOBAL", labels: { "zh-CN": "全球", "en-US": "Global", "zh-HK": "全球" } },
  { code: "CN", labels: { "zh-CN": "中国", "en-US": "China", "zh-HK": "中國" } },
  { code: "TW", labels: { "zh-CN": "中国台湾", "en-US": "Taiwan, China", "zh-HK": "中國台灣" } },
  { code: "HK", labels: { "zh-CN": "中国香港", "en-US": "Hong Kong, China", "zh-HK": "中國香港" } },
  { code: "MO", labels: { "zh-CN": "中国澳门", "en-US": "Macao, China", "zh-HK": "中國澳門" } },
  { code: "SG", labels: { "zh-CN": "新加坡", "en-US": "Singapore", "zh-HK": "新加坡" } },
  { code: "IN", labels: { "zh-CN": "印度", "en-US": "India", "zh-HK": "印度" } },
  { code: "JP", labels: { "zh-CN": "日本", "en-US": "Japan", "zh-HK": "日本" } },
  { code: "KR", labels: { "zh-CN": "韩国", "en-US": "Korea", "zh-HK": "韓國" } },
  { code: "VN", labels: { "zh-CN": "越南", "en-US": "Vietnam", "zh-HK": "越南" } },
  { code: "ID", labels: { "zh-CN": "印度尼西亚", "en-US": "Indonesia", "zh-HK": "印尼" } },
  { code: "TH", labels: { "zh-CN": "泰国", "en-US": "Thailand", "zh-HK": "泰國" } },
  { code: "MY", labels: { "zh-CN": "马来西亚", "en-US": "Malaysia", "zh-HK": "馬來西亞" } },
  { code: "MM", labels: { "zh-CN": "缅甸", "en-US": "Myanmar", "zh-HK": "緬甸" } },
  { code: "PH", labels: { "zh-CN": "菲律宾", "en-US": "Philippines", "zh-HK": "菲律賓" } },
  { code: "KH", labels: { "zh-CN": "柬埔寨", "en-US": "Cambodia", "zh-HK": "柬埔寨" } },
  { code: "BD", labels: { "zh-CN": "孟加拉国", "en-US": "Bangladesh", "zh-HK": "孟加拉" } },
  { code: "MX", labels: { "zh-CN": "墨西哥", "en-US": "Mexico", "zh-HK": "墨西哥" } },
  { code: "KE", labels: { "zh-CN": "肯尼亚", "en-US": "Kenya", "zh-HK": "肯雅" } },
  { code: "NG", labels: { "zh-CN": "尼日利亚", "en-US": "Nigeria", "zh-HK": "尼日利亞" } },
  { code: "CU", labels: { "zh-CN": "古巴", "en-US": "Cuba", "zh-HK": "古巴" } },
  { code: "EG", labels: { "zh-CN": "埃及", "en-US": "Egypt", "zh-HK": "埃及" } },
  { code: "AE", labels: { "zh-CN": "阿联酋", "en-US": "UAE", "zh-HK": "阿聯酋" } },
  { code: "YE", labels: { "zh-CN": "也门", "en-US": "Yemen", "zh-HK": "也門" } },
  { code: "TR", labels: { "zh-CN": "土耳其", "en-US": "Turkey", "zh-HK": "土耳其" } },
  { code: "BJ", labels: { "zh-CN": "贝宁", "en-US": "Benin", "zh-HK": "貝寧" } },
  { code: "RU", labels: { "zh-CN": "俄罗斯", "en-US": "Russia", "zh-HK": "俄羅斯" } },
  { code: "KZ", labels: { "zh-CN": "哈萨克斯坦", "en-US": "Kazakhstan", "zh-HK": "哈薩克" } },
  { code: "IT", labels: { "zh-CN": "意大利", "en-US": "Italy", "zh-HK": "意大利" } },
  { code: "FI", labels: { "zh-CN": "芬兰", "en-US": "Finland", "zh-HK": "芬蘭" } },
  { code: "MN", labels: { "zh-CN": "蒙古", "en-US": "Mongolia", "zh-HK": "蒙古" } },
];

const BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));

function pick(map: LocaleMap, locale: string): string {
  return map[locale as RegionLocale] ?? map["en-US"];
}

/** Localized country/region name for a stored code; falls back to the raw code. */
export function regionLabel(code: string | null | undefined, locale: string): string {
  if (!code) return "";
  const r = BY_CODE.get(code);
  return r ? pick(r.labels, locale) : code;
}
