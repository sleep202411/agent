import { useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { repairChoiceExit, type RepairContent } from "../lib/story-repair-fields";
import type { RepairDuplicateSource } from "../lib/story-repair-duplicate";
const key = (s: RepairDuplicateSource) => `${s.role}:${s.nodeId}`;
export function StoryRepairDuplicatePicker({
  content,
  initialNodeId,
  canEdit,
  error,
  onApply,
  onClose,
}: {
  content: RepairContent;
  initialNodeId: string;
  canEdit: boolean;
  error?: string;
  onApply: (sources: RepairDuplicateSource[]) => boolean;
  onClose: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<RepairDuplicateSource[]>(
      content.graph.nodes.some((n) => n.nodeId === initialNodeId)
        ? [{ nodeId: initialNodeId, role: "node" }]
        : []
    ),
    [search, setSearch] = useState(""),
    [rejected, setRejected] = useState(false);
  const available = content.graph.nodes.flatMap((node) => {
    const label = typeof node.name === "string" && node.name ? node.name : node.nodeId;
    const result: { source: RepairDuplicateSource; label: string }[] = [
      { source: { nodeId: node.nodeId, role: "node" }, label },
    ];
    if (node.kind === "clip" && repairChoiceExit(content, node.nodeId))
      result.push({
        source: { nodeId: node.nodeId, role: "choice-exit" },
        label: `${label} · ${t("storyDuplicate.attachedChoice")}`,
      });
    return result;
  });
  const filtered = available.filter((v) =>
    `${v.label} ${v.source.nodeId}`.toLowerCase().includes(search.toLowerCase())
  );
  const action = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 12 }}
        >
          <ThemedText type="smallBold">{t("storyDuplicate.title")}</ThemedText>
          {action(t("agent.close"), onClose)}
          <ThemedText type="small">{t("storyDuplicate.help")}</ThemedText>
          <TextInput
            accessibilityLabel={t("storyRepair.searchNodes")}
            placeholder={t("storyRepair.searchNodes")}
            placeholderTextColor={theme.textSecondary}
            value={search}
            onChangeText={setSearch}
            style={{
              minHeight: 44,
              padding: 10,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 8,
              color: theme.text,
            }}
          />
          {rejected ? (
            <ThemedText accessibilityRole="alert">
              {error || t("storyCondition.applyFailed")}
            </ThemedText>
          ) : null}
          {filtered.length > 50 ? (
            <ThemedText type="small">{t("storyRepair.refineSearch")}</ThemedText>
          ) : null}
          {filtered.length === 0 ? (
            <ThemedText type="small">{t("storyRepair.noMatchingNode")}</ThemedText>
          ) : null}
          {filtered.slice(0, 50).map((item) => {
            const checked = selected.some((s) => key(s) === key(item.source));
            return (
              <Pressable
                key={key(item.source)}
                accessibilityRole="checkbox"
                accessibilityLabel={item.label}
                accessibilityState={{ checked, disabled: !canEdit }}
                aria-checked={checked}
                disabled={!canEdit}
                onPress={() => {
                  setSelected(
                    checked
                      ? selected.filter((s) => key(s) !== key(item.source))
                      : [...selected, item.source]
                  );
                  setRejected(false);
                }}
                style={{ minHeight: 44, justifyContent: "center", opacity: canEdit ? 1 : 0.5 }}
              >
                <ThemedText type="small">{`${checked ? "● " : "○ "}${item.label}`}</ThemedText>
              </Pressable>
            );
          })}
          <ThemedText type="small">{`${selected.length} ${t("storyDuplicate.selected")}`}</ThemedText>
          {action(
            t("storyDuplicate.apply"),
            () => {
              if (onApply(selected)) onClose();
              else setRejected(true);
            },
            !canEdit || !selected.length
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
