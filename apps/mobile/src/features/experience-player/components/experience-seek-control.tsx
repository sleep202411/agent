import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";

export interface ExperienceSeekCopy {
  back: string;
  forward: string;
  progress: string;
  watchedOnly: string;
}
export function ExperienceSeekControl({
  positionMs,
  durationMs,
  limitMs,
  blocked,
  copy,
  onSeek,
}: {
  positionMs: number;
  durationMs: number;
  limitMs: number;
  blocked: boolean;
  copy: ExperienceSeekCopy;
  onSeek: (positionMs: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const duration = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  const position = Math.min(duration, Math.max(0, positionMs));
  const limit = Math.min(duration, Math.max(0, limitMs));
  const disabled = blocked || !duration || !limit;
  const seek = (target: number) => {
    if (!disabled && Number.isFinite(target))
      onSeek(Math.round(Math.max(0, Math.min(limit, target))));
  };
  const seekAt = (x: number) => {
    if (width > 0) seek((duration * x) / width);
  };
  const time = (ms: number) =>
    `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.back}
          disabled={disabled || position <= 0}
          onPress={(event) => {
            event.stopPropagation();
            seek(position - 10000);
          }}
          style={[styles.button, (disabled || position <= 0) && styles.disabled]}
        >
          <ThemedText type="small" style={styles.text}>
            −10s
          </ThemedText>
        </Pressable>
        <View
          style={styles.trackTouch}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          accessibilityRole="adjustable"
          accessibilityLabel={copy.progress}
          accessibilityHint={copy.watchedOnly}
          accessibilityState={{ disabled }}
          accessibilityValue={{
            min: 0,
            max: duration,
            now: position,
            text: `${time(position)} / ${time(duration)}`,
          }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "increment") seek(position + 10000);
            else if (event.nativeEvent.actionName === "decrement") seek(position - 10000);
          }}
          onStartShouldSetResponder={() => !disabled}
          onResponderGrant={(event) => seekAt(event.nativeEvent.locationX)}
          onResponderMove={(event) => seekAt(event.nativeEvent.locationX)}
        >
          <View pointerEvents="none" style={styles.track}>
            <View
              style={[styles.watched, { width: `${duration ? (limit / duration) * 100 : 0}%` }]}
            />
            <View
              style={[styles.position, { width: `${duration ? (position / duration) * 100 : 0}%` }]}
            />
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.forward}
          disabled={disabled || position >= limit}
          onPress={(event) => {
            event.stopPropagation();
            seek(position + 10000);
          }}
          style={[styles.button, (disabled || position >= limit) && styles.disabled]}
        >
          <ThemedText type="small" style={styles.text}>
            +10s
          </ThemedText>
        </Pressable>
      </View>
      <ThemedText type="small" style={styles.text}>
        {time(position)} / {time(duration)}
      </ThemedText>
      {limit < duration ? (
        <ThemedText type="small" style={styles.hint}>
          {copy.watchedOnly}
        </ThemedText>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingBottom: 4,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.8)",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  button: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  trackTouch: { flex: 1, height: 44, justifyContent: "center" },
  track: { height: 4, backgroundColor: "#404040", overflow: "hidden", borderRadius: 2 },
  watched: { position: "absolute", height: 4, backgroundColor: "#737373" },
  position: { position: "absolute", height: 4, backgroundColor: "#ffffff" },
  text: { color: "#ffffff", fontSize: 12 },
  hint: { color: "#a3a3a3", fontSize: 12 },
  disabled: { opacity: 0.4 },
});
