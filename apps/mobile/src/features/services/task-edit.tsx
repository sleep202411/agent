import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { TaskCreate } from "./task-create";
import { fetchTaskEdit, taskEditDraft, saveTaskEdit, type TaskEditSnapshot } from "./task-edit-api";
export function TaskEdit(props: {
  crewId: string;
  taskId: string;
  userId: string;
  generation: number;
  onClose(): void;
  onSaved(): void;
}) {
  const t = useTranslations();
  const [snapshot, setSnapshot] = useState<{
    task: TaskEditSnapshot;
    draft: ReturnType<typeof taskEditDraft>;
  }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskEdit(props.crewId, props.taskId, controller.signal)
      .then((task) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ task, draft: taskEditDraft(task) });
      })
      .catch((cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(String(cause));
      });
    return () => controller.abort();
  }, [props.crewId, props.taskId, props.generation]);
  if (props.generation !== getAuthGeneration()) return null;
  if (snapshot)
    return (
      <TaskCreate
        {...props}
        initialDraft={snapshot.draft}
        onSave={(input) => saveTaskEdit(snapshot.task, input)}
        onCreated={props.onSaved}
      />
    );
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : <ActivityIndicator />}
      <Pressable accessibilityRole="button" onPress={props.onClose}>
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
    </View>
  );
}
