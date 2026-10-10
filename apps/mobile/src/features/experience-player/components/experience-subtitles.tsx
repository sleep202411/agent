import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ExperienceCoreVideoRendererConfigSchema,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import type { RuntimeSubtitleTrack, StorySubtitleLanguage } from "@repo/shared/story-subtitles";
import { useTranslations } from "@/i18n";

const SubtitleContext = createContext<{
  languages: StorySubtitleLanguage[];
  language: StorySubtitleLanguage | "";
  select: (value: StorySubtitleLanguage | "") => void;
}>({ languages: [], language: "", select: () => undefined });

export function ExperienceSubtitleProvider({
  manifest,
  locale,
  children,
}: {
  manifest: ExperienceRuntimeManifest;
  locale: string;
  children: ReactNode;
}) {
  const [selection, select] = useState<StorySubtitleLanguage | "" | null>(null);
  const languages = useMemo(
    () =>
      Array.from(
        new Set(
          manifest.graph.nodes.flatMap((node) =>
            node.kind === "scene"
              ? node.renderers.flatMap((renderer) =>
                  renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID
                    ? ExperienceCoreVideoRendererConfigSchema.parse(
                        renderer.config
                      ).sequence.flatMap(
                        (clip) => clip.subtitles?.map((track) => track.language) ?? []
                      )
                    : []
                )
              : []
          )
        )
      ).sort(),
    [manifest]
  );
  const automatic =
    languages.find((tag) => tag === locale) ??
    languages.find((tag) => tag.split("-")[0] === locale.split("-")[0]) ??
    "";
  return (
    <SubtitleContext.Provider value={{ languages, language: selection ?? automatic, select }}>
      {children}
    </SubtitleContext.Provider>
  );
}

export function ExperienceSubtitleControl() {
  const { languages, language, select } = useContext(SubtitleContext);
  const [open, setOpen] = useState(false);
  const t = useTranslations();
  if (!languages.length) return null;
  return (
    <View style={styles.control} onTouchEnd={(event) => event.stopPropagation()}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobileSubtitles.label")}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.option}
      >
        <Text style={styles.label}>
          {t(language ? `mobileSubtitles.${language}` : "mobileSubtitles.off")}
        </Text>
      </Pressable>
      {open &&
        (["", ...languages] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === language }}
            style={styles.option}
            onPress={() => {
              select(value);
              setOpen(false);
            }}
          >
            <Text style={styles.label}>
              {t(value ? `mobileSubtitles.${value}` : "mobileSubtitles.off")}
            </Text>
          </Pressable>
        ))}
    </View>
  );
}

export function ExperienceSubtitleLayer({
  tracks,
  positionMs,
  visible,
}: {
  tracks: readonly RuntimeSubtitleTrack[];
  positionMs: number;
  visible: boolean;
}) {
  const { language } = useContext(SubtitleContext);
  const cues = visible
    ? (tracks
        .find((track) => track.language === language)
        ?.cues.filter((cue) => cue.startMs <= positionMs && positionMs < cue.endMs) ?? [])
    : [];
  return (
    <View style={styles.captions} pointerEvents="none">
      {cues.map((cue, index) => (
        <Text key={index} style={styles.caption}>
          {cue.text}
        </Text>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  control: {
    position: "absolute",
    left: 12,
    top: 12,
    zIndex: 3000,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.8)",
  },
  option: { padding: 12, minHeight: 44, justifyContent: "center" },
  label: { color: "white", fontSize: 14 },
  captions: { position: "absolute", left: 16, right: 16, bottom: 80, alignItems: "center", gap: 4 },
  caption: {
    color: "white",
    backgroundColor: "rgba(0,0,0,0.75)",
    textAlign: "center",
    fontSize: 18,
    lineHeight: 25,
    maxWidth: "85%",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
});
