export const locales = ["en-US", "zh-CN", "zh-HK"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "zh-CN";

export function isValidLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/** Detect preferred locale from browser settings. */
export function detectBrowserLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale;
  const stored = localStorage.getItem("language");
  if (stored && isValidLocale(stored)) return stored;
  const lang = navigator.language;
  if (lang.startsWith("zh-HK") || lang.startsWith("zh-TW")) return "zh-HK";
  if (lang.startsWith("zh")) return "zh-CN";
  return "en-US";
}
