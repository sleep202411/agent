import IconCheck from "@tabler/icons-react-native/icons/IconCheck";
import IconChevronDown from "@tabler/icons-react-native/icons/IconChevronDown";
import IconSparkles from "@tabler/icons-react-native/icons/IconSparkles";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";

import type { AgentOsModelProfile } from "../api/agent-os-api";

const theme = Colors.dark;
const TRIGGER_MUTED = "rgba(255,255,255,0.82)";

type AgentModelMenuProps = {
  value: string;
  options: readonly AgentOsModelProfile[];
  label: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
};

/** Model profile picker — matches PC FizzAgentModelMenu (sparkle + label + chevron). */
export function AgentModelMenu({
  value,
  options,
  label,
  onValueChange,
  disabled = false,
}: AgentModelMenuProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const selected =
    options.find((option) => option.id === value || option.id === value.trim()) ?? options[0];
  const selectedId = selected?.id ?? "";

  if (!options.length) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.trigger,
          disabled && styles.triggerDisabled,
          pressed && !disabled && styles.pressed,
        ]}
      >
        <View style={styles.triggerInner}>
          <IconSparkles size={14} color={TRIGGER_MUTED} strokeWidth={1.75} />
          <ThemedText type="code" numberOfLines={1} style={styles.triggerLabel}>
            {selected?.label ?? label}
          </ThemedText>
          <IconChevronDown size={14} color={TRIGGER_MUTED} strokeWidth={2} />
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View
            style={[
              styles.sheet,
              {
                paddingBottom: Math.max(insets.bottom, Spacing.four),
                paddingLeft: Math.max(insets.left, Spacing.four),
                paddingRight: Math.max(insets.right, Spacing.four),
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              style={styles.list}
            >
              {options.map((option) => {
                const active = option.id === selectedId;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      onValueChange(option.id);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.optionHit,
                      active && styles.optionActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.optionRow}>
                      <View style={styles.optionCopy}>
                        <ThemedText type="smallBold">{option.label}</ThemedText>
                        {option.hint ? (
                          <ThemedText type="code" themeColor="textSecondary">
                            {option.hint}
                          </ThemedText>
                        ) : null}
                      </View>
                      <View style={styles.optionCheck}>
                        {active ? (
                          <IconCheck size={18} color={theme.brand} strokeWidth={2.5} />
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
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
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.55)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    alignSelf: "stretch",
    backgroundColor: theme.backgroundElement,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: Spacing.two,
    maxHeight: "70%",
    paddingTop: Spacing.three,
    width: "100%",
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: Spacing.one,
    paddingBottom: Spacing.two,
    width: "100%",
  },
  optionHit: {
    borderRadius: 12,
    width: "100%",
  },
  optionRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 52,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    width: "100%",
  },
  optionActive: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  optionCopy: {
    flex: 1,
    flexShrink: 1,
    gap: 4,
    minWidth: 0,
    paddingRight: Spacing.three,
  },
  optionCheck: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
    width: 28,
  },
  pressed: {
    opacity: 0.8,
  },
});
