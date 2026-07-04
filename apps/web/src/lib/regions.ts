/**
 * IP region / country facet. `Ip.region` stores an ISO-3166 alpha-2 code or the
 * sentinel "GLOBAL". This is the canonical list of markets the catalog uses today
 * (shared by the plaza region filter, the create-IP dropdown, and the card badge).
 *
 * Labels are a small per-locale map here rather than i18next keys: the country
 * names already need a code→name table, so colocating the few chrome strings keeps
 * the whole facet in one file. Extend REGIONS as new markets appear.
 */
type RegionLocale = "zh-CN" | "en-US" | "zh-HK";
type LocaleMap = Record<RegionLocale, string>;

export interface RegionOption {
  code: string;
  labels: LocaleMap;
}

// Ordered: GLOBAL first, then roughly by catalog volume / region.
export const REGIONS: RegionOption[] = [
  { code: "GLOBAL", labels: { "zh-CN": "全球", "en-US": "Global", "zh-HK": "全球" } },
  { code: "CN", labels: { "zh-CN": "中国", "en-US": "China", "zh-HK": "中國" } },
  { code: "HK", labels: { "zh-CN": "中国香港", "en-US": "Hong Kong, China", "zh-HK": "中國香港" } },
  { code: "TW", labels: { "zh-CN": "中国台湾", "en-US": "Taiwan, China", "zh-HK": "中國台灣" } },
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

// Chrome strings for the facet UI (filter "all", field label, placeholder).
const REGION_UI: Record<"all" | "field" | "placeholder", LocaleMap> = {
  all: { "zh-CN": "全部地区", "en-US": "All regions", "zh-HK": "全部地區" },
  field: { "zh-CN": "地区", "en-US": "Region", "zh-HK": "地區" },
  placeholder: {
    "zh-CN": "选择地区（可选）",
    "en-US": "Select region (optional)",
    "zh-HK": "選擇地區（可選）",
  },
};

export function regionUi(key: keyof typeof REGION_UI, locale: string): string {
  return pick(REGION_UI[key], locale);
}
