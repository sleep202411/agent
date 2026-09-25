import IconCheck from "@tabler/icons-react-native/IconCheck";
import IconChevronDown from "@tabler/icons-react-native/IconChevronDown";
import IconPuzzle from "@tabler/icons-react-native/IconPuzzle";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

import type { ProjectSkillComposerEntry } from "../hooks/use-agent-composer-turn";
import { AgentComposerMenuSheet } from "./agent-composer-menu-sheet";

const YELLOW = "#FFD84D";
const MUTED = "rgba(255,255,255,0.72)";

export function AgentSkillsMenu({
  entries,
  loading,
  error,
  disabled = false,
  activeCount,
  isActive,
  onToggle,
  onRetry,
}: {
  entries: ProjectSkillComposerEntry[];
  loading: boolean;
  error: boolean;
  disabled?: boolean;
  activeCount: number;
  isActive: (installationId: string, isDefault: boolean) => boolean;
  onToggle: (installationId: string, isDefault: boolean) => void;
  onRetry: () => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("agent.composer.chooseProjectSkills")}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [pressed && !disabled && styles.pressed]}
      >
        <View style={[styles.trigger, disabled && styles.disabled]}>
          <IconPuzzle size={14} color={YELLOW} strokeWidth={1.8} />
          <Text style={styles.label}>{t("agent.composer.skillsLabel")}</Text>
          {activeCount > 0 ? <Text style={styles.count}>· {activeCount}</Text> : null}
          <IconChevronDown size={12} color="rgba(255,255,255,0.55)" strokeWidth={1.8} />
        </View>
      </Pressable>
      <AgentComposerMenuSheet
        visible={open}
        title={t("agent.composer.projectSkillsLabel")}
        onClose={() => setOpen(false)}
      >
        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator color={YELLOW} />
            <Text style={styles.stateText}>{t("agent.composer.skillsLoading")}</Text>
          </View>
        ) : error ? (
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <View style={styles.state}>
              <Text style={styles.stateText}>{t("agent.composer.skillCatalogFailed")}</Text>
              <Text style={styles.retry}>{t("agent.composer.skillsRetry")}</Text>
            </View>
          </Pressable>
        ) : entries.length === 0 ? (
          <Text style={styles.stateText}>{t("agent.composer.skillsEmpty")}</Text>
        ) : (
          entries.map(({ installation, name, isDefault }) => {
            const active = isActive(installation.id, isDefault);
            return (
              <Pressable
                key={installation.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active, disabled }}
                disabled={disabled}
                onPress={() => onToggle(installation.id, isDefault)}
              >
                <View style={styles.row}>
                  <IconPuzzle
                    size={14}
                    color={active ? YELLOW : "rgba(255,255,255,0.28)"}
                    strokeWidth={1.8}
                  />
                  <Text style={styles.rowName} numberOfLines={1}>
                    {name}
                  </Text>
                  {isDefault ? (
                    <Text style={styles.badge}>{t("agent.composer.skillDefaultBadge")}</Text>
                  ) : null}
                  {active ? <IconCheck size={14} color={YELLOW} strokeWidth={2} /> : null}
                </View>
              </Pressable>
            );
          })
        )}
      </AgentComposerMenuSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: "rgba(255,216,77,0.28)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 28,
    paddingHorizontal: 10,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 11,
    fontWeight: "500",
  },
  count: {
    color: "rgba(255,216,77,0.75)",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  pressed: {
    opacity: 0.8,
  },
  state: {
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  stateText: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
  },
  retry: {
    color: YELLOW,
    fontSize: 12,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 44,
    paddingVertical: Spacing.one,
  },
  rowName: {
    color: "rgba(255,255,255,0.9)",
    flex: 1,
    fontSize: 13,
    minWidth: 0,
  },
  badge: {
    color: "rgba(255,216,77,0.55)",
    fontSize: 10,
  },
});
