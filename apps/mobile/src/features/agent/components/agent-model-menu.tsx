import IconChevronDown from "@tabler/icons-react-native/icons/IconChevronDown";
import IconSparkles from "@tabler/icons-react-native/icons/IconSparkles";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";

const TRIGGER_MUTED = "rgba(255,255,255,0.82)";

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
        <View style={styles.triggerInner}>
          <IconSparkles size={14} color={TRIGGER_MUTED} strokeWidth={1.75} />
          <ThemedText type="code" numberOfLines={1} style={styles.triggerLabel}>
            {label}
          </ThemedText>
          <IconChevronDown size={14} color={TRIGGER_MUTED} strokeWidth={2} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 1,
    maxWidth: 220,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  triggerInner: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  triggerDisabled: {
    opacity: 0.45,
  },
  triggerLabel: {
    color: TRIGGER_MUTED,
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.8,
  },
});
