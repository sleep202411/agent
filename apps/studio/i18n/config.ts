/**
 * i18n locale set — single source of truth (shared with the routing config in
 * ./routing.ts and the language switcher UI). English is the source language;
 * every string is authored in en-US first. Locales mirror apps/web.
 */

/**
 * Supported locales, each paired with its **native** display label (never
 * translated — a language always lists itself in its own script).
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

export const defaultLocale: Locale = "en-US";

export function isValidLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}
