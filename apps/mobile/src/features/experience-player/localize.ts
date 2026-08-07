import type { ExperienceLocalizedText } from "@repo/shared/experience-runtime";

export function localize(
  value: ExperienceLocalizedText,
  locale: string,
  defaultLocale: string
): string {
  return value[locale] ?? value[defaultLocale] ?? Object.values(value)[0] ?? "";
}
