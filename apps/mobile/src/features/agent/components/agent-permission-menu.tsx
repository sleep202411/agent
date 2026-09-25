import IconHandStop from "@tabler/icons-react-native/IconHandStop";
import IconShieldCheck from "@tabler/icons-react-native/IconShieldCheck";
import IconShieldExclamation from "@tabler/icons-react-native/IconShieldExclamation";
import { useState, type ComponentType } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Spacing } from "@/constants/theme";
import { useTranslations, type MessageKey } from "@/i18n";

import type { AgentOsPermissionMode } from "../api/agent-os-api";
import { AgentComposerMenuSheet } from "./agent-composer-menu-sheet";

const MUTED = "rgba(255,255,255,0.72)";
const FULL = "rgba(254,202,202,0.88)";

const MODES: {
  id: AgentOsPermissionMode;
  labelKey: MessageKey;
  hintKey: MessageKey;
  Icon: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
}[] = [
  {
    id: "ask",
    labelKey: "agent.composer.permAsk",
    hintKey: "agent.composer.permHintAsk",
    Icon: IconHandStop,
  },
  {
    id: "smart",
    labelKey: "agent.composer.permSmart",
    hintKey: "agent.composer.permHintSmart",
    Icon: IconShieldCheck,
  },
  {
    id: "full",
    labelKey: "agent.composer.permFull",
    hintKey: "agent.composer.permHintFull",
    Icon: IconShieldExclamation,
  },
];

export function AgentPermissionMenu({
  value,
  disabled = false,
  onChange,
}: {
  value: AgentOsPermissionMode;
  disabled?: boolean;
  onChange: (mode: AgentOsPermissionMode) => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const selected = MODES.find((mode) => mode.id === value) ?? MODES[1];
  const SelectedIcon = selected.Icon;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("agent.composer.permissionMode")}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [pressed && !disabled && styles.pressed]}
      >
        <View style={[styles.trigger, disabled && styles.disabled]}>
          <SelectedIcon size={14} color={value === "full" ? FULL : MUTED} strokeWidth={1.8} />
          <Text style={[styles.label, value === "full" && styles.fullLabel]} numberOfLines={1}>
            {t(selected.labelKey)}
          </Text>
        </View>
      </Pressable>
      <AgentComposerMenuSheet
        visible={open}
        title={t("agent.composer.permissionMode")}
        onClose={() => setOpen(false)}
      >
        {MODES.map((mode) => {
          const active = mode.id === value;
          return (
            <Pressable
              key={mode.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                onChange(mode.id);
                setOpen(false);
              }}
            >
              <View style={[styles.row, active && styles.rowActive]}>
                <mode.Icon size={16} color={mode.id === "full" ? FULL : MUTED} strokeWidth={1.8} />
                <View style={styles.rowCopy}>
                  <Text style={[styles.rowTitle, mode.id === "full" && styles.fullLabel]}>
                    {t(mode.labelKey)}
                  </Text>
                  <Text style={styles.rowHint}>{t(mode.hintKey)}</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </AgentComposerMenuSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 4,
    maxWidth: 72,
    minHeight: 28,
    paddingHorizontal: 4,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    color: MUTED,
    flexShrink: 1,
    fontSize: 11,
  },
  fullLabel: {
    color: FULL,
  },
  pressed: {
    opacity: 0.8,
  },
  row: {
    alignItems: "flex-start",
    borderRadius: 12,
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 56,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  rowActive: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "500",
  },
  rowHint: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
});
