import { useState } from "react";
import { Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { AuthedWebView } from "@/components/authed-web-view";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { TaskCreate } from "./task-create";
import { TaskDetail } from "./task-detail";
import { TaskPicker } from "./task-picker";

export function CrewTaskBrowser({
  crewId,
  userId,
  generation,
  onClose,
}: {
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [creating, setCreating] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const [webTask, setWebTask] = useState<string>();
  if (generation !== getAuthGeneration()) return null;
  if (creating)
    return (
      <TaskCreate
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          setTaskId(id);
        }}
      />
    );
  if (webTask)
    return (
      <View style={{ flex: 1 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setWebTask(undefined)}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("taskRelations.backToTask")}</ThemedText>
        </Pressable>
        <AuthedWebView
          path={`/crews/${encodeURIComponent(crewId)}/workspace?tab=tasks&task=${encodeURIComponent(webTask)}`}
          title={t("crewTasks.title")}
        />
      </View>
    );
  if (taskId)
    return (
      <TaskDetail
        crewId={crewId}
        taskId={taskId}
        userId={userId}
        generation={generation}
        closeLabel={t("crewTasks.back")}
        onClose={() => setTaskId(undefined)}
        onOpenWeb={(id) => {
          if (generation === getAuthGeneration()) {
            setTaskId(id);
            setWebTask(id);
          }
        }}
      />
    );
  return (
    <View style={{ flex: 1 }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (generation === getAuthGeneration()) setCreating(true);
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("taskCreate.title")}</ThemedText>
      </Pressable>
      <TaskPicker
        crewId={crewId}
        generation={generation}
        title={t("crewTasks.title")}
        closeLabel={t("report.close")}
        onClose={onClose}
        onSelect={(task) => {
          if (generation === getAuthGeneration()) setTaskId(task.id);
        }}
      />
    </View>
  );
}
