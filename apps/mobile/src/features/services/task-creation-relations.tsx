import { useState, type Dispatch, type SetStateAction } from "react";
import { Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { TaskPicker } from "./task-picker";
import type { TaskOption } from "./task-options";

export function TaskCreationRelations({
  crewId,
  generation,
  parent,
  blockers,
  locked,
  onParentChange,
  onBlockersChange,
}: {
  crewId: string;
  generation: number;
  parent: TaskOption | null;
  blockers: TaskOption[];
  locked: boolean;
  onParentChange: (task: TaskOption | null) => void;
  onBlockersChange: Dispatch<SetStateAction<TaskOption[]>>;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [picker, setPicker] = useState<"parent" | "blocker">();
  const current = () => !locked && generation === getAuthGeneration();
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{t("taskRelations.parentTask")}</ThemedText>
      {parent && (
        <ThemedText>
          TASK-{parent.number} · {parent.title}
        </ThemedText>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={locked}
        onPress={() => {
          if (current()) setPicker("parent");
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("taskRelationships.chooseParent")}</ThemedText>
      </Pressable>
      {parent && (
        <Pressable
          accessibilityRole="button"
          disabled={locked}
          onPress={() => {
            if (current()) onParentChange(null);
          }}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("taskRelationships.removeParent")}</ThemedText>
        </Pressable>
      )}
      <ThemedText>
        {t("taskRelations.blockedBy")} · {blockers.length}/50
      </ThemedText>
      {blockers.map((task) => (
        <Pressable
          key={task.id}
          accessibilityRole="button"
          disabled={locked}
          accessibilityLabel={`${t("taskRelationships.removeBlocker")} TASK-${task.number} ${task.title}`}
          style={{ padding: 12 }}
          onPress={() => {
            if (current()) onBlockersChange((items) => items.filter((item) => item.id !== task.id));
          }}
        >
          <ThemedText>
            TASK-{task.number} · {task.title} ×
          </ThemedText>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={locked || blockers.length >= 50}
        onPress={() => {
          if (current()) setPicker("blocker");
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("taskRelationships.addBlocker")}</ThemedText>
      </Pressable>
      <Modal
        visible={!!picker && !locked}
        animationType="slide"
        onRequestClose={() => setPicker(undefined)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          {picker && (
            <TaskPicker
              crewId={crewId}
              generation={generation}
              title={t(
                picker === "parent"
                  ? "taskRelationships.chooseParent"
                  : "taskRelationships.addBlocker"
              )}
              closeLabel={t("common.cancel")}
              excludedIds={picker === "blocker" ? blockers.map((task) => task.id) : []}
              onClose={() => setPicker(undefined)}
              onSelect={(task) => {
                if (!current()) return;
                if (picker === "parent") onParentChange(task);
                else
                  onBlockersChange((items) =>
                    items.length >= 50 || items.some((item) => item.id === task.id)
                      ? items
                      : [...items, task]
                  );
                setPicker(undefined);
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
