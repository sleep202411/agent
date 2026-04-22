/**
 * Supported locales, paired with their **native** display label (never
 * translated — each locale always shows in its own script). Single
 * source of truth: the language switcher UI reads from here, and the
 * `locales` / `Locale` derivations stay consistent.
 */
export const LOCALE_OPTIONS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-HK", label: "繁體中文" },
  { value: "en-US", label: "English" },
] as const;

export const locales = LOCALE_OPTIONS.map((o) => o.value) as ReadonlyArray<
  (typeof LOCALE_OPTIONS)[number]["value"]
>;
export type Locale = (typeof LOCALE_OPTIONS)[number]["value"];
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
