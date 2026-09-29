import { Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import type { TaskDetail } from "./task-detail-api";
export function TaskRelations({
  task,
  onOpenTask,
}: {
  task: TaskDetail;
  onOpenTask: (id: string) => void;
}) {
  const t = useTranslations();
  const groups = [
    { label: t("taskRelations.parentTask"), items: task.parent ? [task.parent] : [] },
    { label: t("taskRelations.subtasks"), items: task.children },
    { label: t("taskRelations.blockedBy"), items: task.blockedBy },
    { label: t("taskRelations.blocking"), items: task.blocking },
  ];
  return (
    <View style={{ gap: 8 }}>
      {groups
        .filter((group) => group.items.length)
        .map((group) => (
          <View key={group.label} style={{ gap: 8 }}>
            <ThemedText type="smallBold">
              {group.label} · {group.items.length}
            </ThemedText>
            {group.items.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => onOpenTask(item.id)}
                style={{ padding: 12 }}
              >
                <ThemedText>
                  TASK-{item.number} · {item.title}
                </ThemedText>
                <ThemedText type="small">
                  {item.workflowState.name}
                  {"resolved" in item
                    ? ` · ${t(item.resolved ? "taskRelations.resolved" : "taskRelations.unresolved")}`
                    : ""}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        ))}
    </View>
  );
}
