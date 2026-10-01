import type {
  ExperienceLocalizedText,
  ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";

export function localize(
  value: ExperienceLocalizedText,
  locale: string,
  defaultLocale: string
): string {
  return value[locale] ?? value[defaultLocale] ?? Object.values(value)[0] ?? "";
}

const INVISIBLE_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/g;

/**
 * Optional copy such as a choice prompt: "" when the text is missing or shows
 * nothing (blank, or only zero-width characters), so the host omits the line.
 */
export function localizeVisible(
  value: ExperienceLocalizedText | undefined,
  locale: string,
  defaultLocale: string
): string {
  if (!value) return "";
  const text = localize(value, locale, defaultLocale).trim();
  return text.replace(INVISIBLE_CHARACTERS, "").trim() ? text : "";
}

/**
 * Locale to pick localized *assets* with: the app locale may not be one the
 * manifest was authored in (zh-HK viewer, zh-CN audio), so fall back by language
 * before dropping to the manifest default.
 */
export function resolvePlaybackLocale(
  manifest: ExperienceRuntimeManifest,
  requestedLocale: string
): string {
  if (manifest.localization.locales.includes(requestedLocale)) return requestedLocale;
  const requestedLanguage = requestedLocale.split("-")[0]?.toLowerCase();
  const sameLanguage = manifest.localization.locales.find(
    (candidate) => candidate.split("-")[0]?.toLowerCase() === requestedLanguage
  );
  return sameLanguage ?? manifest.localization.defaultLocale;
}
