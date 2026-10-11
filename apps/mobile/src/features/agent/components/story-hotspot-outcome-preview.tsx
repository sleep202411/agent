import { useState } from "react";
import { Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations, useLocale } from "@/i18n";
import { compileRepairInteractions } from "../lib/story-repair-interactions";
import { repairTargets, sameRepairTarget, type RepairContent } from "../lib/story-repair-fields";

/** Like Web's authoring preview, describes the success action without executing it. */
export function StoryHotspotOutcomePreview({
  value,
  content,
  time,
  active,
}: {
  value: unknown;
  content: RepairContent;
  time: number;
  active: boolean;
}) {
  const t = useTranslations(),
    locale = useLocale();
  const [pressed, setPressed] = useState(false);
  let interaction;
  try {
    interaction = compileRepairInteractions([value])[0];
  } catch {
    /* Incomplete numeric edits remain drafts. */
  }
  if (!interaction)
    return <ThemedText accessibilityRole="alert">{t("storyHotspot.previewInvalid")}</ThemedText>;
  const visible = active && time >= interaction.startMs && time <= interaction.endMs;
  const action = interaction.outcomes.success;
  let message = t(
    `storyHotspot.preview${action.kind === "continue" ? "Continue" : action.kind === "pause" ? "Pause" : action.kind === "seek" ? "Seek" : "Goto"}`
  );
  if (action.kind === "seek") message += ` ${action.timeMs} ms`;
  if (action.kind === "goto") {
    const destination = repairTargets(content, locale).find((v) =>
      sameRepairTarget(v.value, action.target)
    );
    message = destination
      ? `${message} ${destination.label}`
      : t("storyHotspot.previewMissingTarget");
  }
  const rect = interaction.rect;
  return (
    <View style={{ position: "absolute", inset: 0 }} pointerEvents="box-none">
      {visible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={interaction.label[locale] || t("storyHotspot.previewOutcome")}
          onPress={() => setPressed(true)}
          style={{
            position: "absolute",
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
            borderWidth: 2,
            borderColor: "#4D8DFF",
            backgroundColor: "rgba(77,141,255,0.12)",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ThemedText type="small">
            {interaction.label[locale] || t("storyHotspot.previewOutcome")}
          </ThemedText>
        </Pressable>
      ) : null}
      {pressed && visible ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: "#090909",
            padding: 8,
          }}
        >
          <ThemedText accessibilityRole="alert" type="small">
            {message}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}
