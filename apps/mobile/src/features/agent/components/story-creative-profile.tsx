import { View } from "react-native";
import { STORY_VISUAL_STYLE_SKILL_SLUGS } from "@repo/shared";
import { ThemedText } from "@/components/themed-text";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";
export type StoryCreativeProfile = {
  frameProfile?: string | null;
  durationPreset?: string | null;
  visualStyle?: string | null;
  defaultLocale: string;
};
export function StoryCreativeProfileSummary({ profile }: { profile: StoryCreativeProfile }) {
  const t = useTranslations(),
    locale = useLocale();
  const label = (group: string, value: string | null | undefined, known: readonly string[]) =>
    value
      ? known.includes(value)
        ? t(`storyProfile.${group}.${value}` as MessageKey)
        : value
      : t("storyProfile.notSet");
  let language = profile.defaultLocale;
  try {
    const display = new Intl.DisplayNames([locale], { type: "language" }).of(profile.defaultLocale);
    if (display && display !== profile.defaultLocale)
      language = `${display} · ${profile.defaultLocale}`;
  } catch {
    /* Retain the authoritative tag when Intl support or the tag is unavailable. */
  }
  const rows = [
    [
      "aspectRatio",
      label("frameProfiles", profile.frameProfile, ["landscape_16_9", "portrait_9_16"]),
    ],
    [
      "targetRuntime",
      label("durationPresets", profile.durationPreset, [
        "short_5_15",
        "medium_15_30",
        "long_30_60",
      ]),
    ],
    ["visualStyle", label("visualStyles", profile.visualStyle, STORY_VISUAL_STYLE_SKILL_SLUGS)],
    ["language", language],
  ];
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("storyProfile.title")}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t("storyProfile.description")}
      </ThemedText>
      {rows.map(([key, value]) => (
        <View key={key} style={{ gap: 2 }}>
          <ThemedText type="small" themeColor="textSecondary">
            {t(`storyProfile.${key}` as MessageKey)}
          </ThemedText>
          <ThemedText type="small">{value}</ThemedText>
        </View>
      ))}
    </View>
  );
}
