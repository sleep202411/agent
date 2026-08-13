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
