import { useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import type { ExperienceRuntimeController } from "@repo/experience-engine";
import { ThemedText } from "@/components/themed-text";

export function ExperienceReportStatus({
  controller,
  retryLabel,
}: {
  controller: ExperienceRuntimeController;
  retryLabel: string;
}) {
  const error = useSyncExternalStore(
    controller.subscribePlaySessionReport,
    controller.getPlaySessionReportError,
    controller.getPlaySessionReportError
  );
  if (!error) return null;
  return (
    <View style={{ gap: 8, padding: 16 }}>
      <ThemedText accessibilityRole="alert" type="small" style={{ color: "#FFFFFF" }}>
        {error}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        onPress={controller.retryPlaySessionReport}
        style={{ paddingVertical: 12 }}
      >
        <ThemedText type="smallBold" style={{ color: "#FFFFFF" }}>
          {retryLabel}
        </ThemedText>
      </Pressable>
    </View>
  );
}
