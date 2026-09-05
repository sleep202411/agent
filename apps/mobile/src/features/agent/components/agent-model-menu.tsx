import IconSparkles from "@tabler/icons-react-native/icons/IconSparkles";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";

const TRIGGER_MUTED = "rgba(255,255,255,0.72)";

type AgentModelMenuProps = {
  label: string;
  disabled?: boolean;
  onPress: () => void;
};

/** Composer chip that opens project model settings. */
export function AgentModelMenu({ label, disabled = false, onPress }: AgentModelMenuProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [pressed && !disabled && styles.pressed]}
    >
      <View style={[styles.trigger, disabled && styles.triggerDisabled]}>
        <IconSparkles size={14} color={TRIGGER_MUTED} strokeWidth={1.75} />
        <ThemedText type="code" numberOfLines={1} style={styles.triggerLabel}>
          {label}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    maxWidth: 196,
    minHeight: 28,
    minWidth: 0,
    paddingHorizontal: 4,
  },
  triggerDisabled: {
    opacity: 0.45,
  },
  triggerLabel: {
    color: TRIGGER_MUTED,
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 16,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.8,
  },
});
