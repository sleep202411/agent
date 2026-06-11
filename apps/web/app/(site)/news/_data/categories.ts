/**
 * News category registry — a local, static taxonomy over the hardcoded
 * articles (manifest `category` field). Adding a country/topic = one entry
 * here + tagging articles in the manifest. Live external news items are
 * uncategorized and only appear on the main /news feed.
 */
export type NewsLocale = "en-US" | "zh-CN" | "zh-HK";

export interface NewsCategory {
  slug: string;
  label: Record<NewsLocale, string>;
}

export const NEWS_CATEGORIES: NewsCategory[] = [
  {
    slug: "italy",
    label: { "en-US": "Italy", "zh-CN": "\u610f\u5927\u5229", "zh-HK": "\u610f\u5927\u5229" },
  },
];

function normLocale(rawLang: string): NewsLocale {
  return rawLang === "zh-CN" || rawLang === "zh-HK" || rawLang === "en-US" ? rawLang : "en-US";
}

export function getNewsCategory(slug: string): NewsCategory | undefined {
  return NEWS_CATEGORIES.find((c) => c.slug === slug);
}

export function categoryLabel(category: NewsCategory, rawLang: string): string {
  return category.label[normLocale(rawLang)];
}

/** Localized [{slug,label}] list for the pill bar. */
export function localizedCategories(rawLang: string): { slug: string; label: string }[] {
  return NEWS_CATEGORIES.map((c) => ({ slug: c.slug, label: categoryLabel(c, rawLang) }));
}
