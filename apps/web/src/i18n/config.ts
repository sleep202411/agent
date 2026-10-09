/**
 * Supported locales, paired with their **native** display label (never
 * translated — each locale always shows in its own script). Single
 * source of truth: the language switcher UI reads from here, and the
 * `locales` / `Locale` derivations stay consistent.
 *
 * The CN cell hides English from the product UI and defaults to zh-CN;
 * message catalogs for en-US remain in the bundle for shared tooling.
 */
export const LOCALE_OPTIONS = [
  { value: "en-US", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-HK", label: "繁體中文" },
] as const;

export const locales = LOCALE_OPTIONS.map((o) => o.value) as ReadonlyArray<
  (typeof LOCALE_OPTIONS)[number]["value"]
>;
export type Locale = (typeof LOCALE_OPTIONS)[number]["value"];

/** Build-time cell: CN deployments drop English from the language surface. */
export function isCnSite(): boolean {
  return process.env.NEXT_PUBLIC_SITE_REGION === "cn";
}

export const defaultLocale: Locale = isCnSite() ? "zh-CN" : "en-US";

/** Locales offered in switchers / accepted as a stable site preference. */
export const SITE_LOCALE_OPTIONS = (
  isCnSite() ? LOCALE_OPTIONS.filter((option) => option.value !== "en-US") : LOCALE_OPTIONS
) as ReadonlyArray<(typeof LOCALE_OPTIONS)[number]>;

export const siteLocales = SITE_LOCALE_OPTIONS.map((o) => o.value) as ReadonlyArray<Locale>;

export function isValidLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function isSiteLocale(value: string): value is Locale {
  return (siteLocales as readonly string[]).includes(value);
}

/** Map any locale (including en-US bookmarked on CN) onto a site-allowed one. */
export function normalizeSiteLocale(value: string | null | undefined): Locale {
  if (value && isSiteLocale(value)) return value;
  return defaultLocale;
}

/** Detect preferred locale from browser settings. */
export function detectBrowserLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale;
  const stored = localStorage.getItem("language");
  if (stored && isSiteLocale(stored)) return stored;
  const lang = navigator.language;
  if (lang.startsWith("zh-HK") || lang.startsWith("zh-TW")) return "zh-HK";
  if (lang.startsWith("zh")) return "zh-CN";
  return defaultLocale;
}
