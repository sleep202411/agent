import { Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import type { ExperiencePlaybackRate } from "../lib/experience-playback-checkpoint";

export interface ExperienceSpeedCopy {
  label: string;
  interactionBlocked: string;
}
const rates: readonly ExperiencePlaybackRate[] = [1, 1.25, 1.5, 2];

/** Kept on the paused picture, clear of live story gestures and choices. */
export function ExperienceSpeedControl({
  rate,
  blocked,
  copy,
  onRate,
}: {
  rate: ExperiencePlaybackRate;
  blocked: boolean;
  copy: ExperienceSpeedCopy;
  onRate: (rate: ExperiencePlaybackRate) => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${copy.label}: ${rate}×`}
        accessibilityHint={blocked ? copy.interactionBlocked : undefined}
        accessibilityState={{ disabled: blocked }}
        disabled={blocked}
        onPress={(event) => {
          event.stopPropagation();
          if (!blocked) onRate(rates[(rates.indexOf(rate) + 1) % rates.length]!);
        }}
        style={[styles.button, blocked && styles.disabled]}
      >
        <ThemedText type="small" style={styles.text}>
          {copy.label} · {rate}×
        </ThemedText>
      </Pressable>
      {blocked ? (
        <ThemedText type="small" style={styles.hint}>
          {copy.interactionBlocked}
        </ThemedText>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  row: { gap: 4, alignItems: "flex-start" },
  button: {
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.8)",
  },
  text: { color: "#ffffff" },
  hint: { color: "#d4d4d4", fontSize: 12 },
  disabled: { opacity: 0.5 },
});
