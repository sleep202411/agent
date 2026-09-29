import { EpisodeCreate } from "./episode-create";
import { EpisodeTaskTemplate } from "./episode-task-template";
import { AssetTaskProgress } from "./asset-task-progress";
import { TaskFieldManagement } from "./task-field-management";
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
  const [creatingEpisode, setCreatingEpisode] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [managingFields, setManagingFields] = useState(false);
  const [creating, setCreating] = useState(false);
  const [taskId, setTaskId] = useState<string>();
  const [webTask, setWebTask] = useState<string>();
  if (generation !== getAuthGeneration()) return null;
  if (creatingEpisode)
    return (
      <EpisodeCreate
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setCreatingEpisode(false)}
      />
    );
  if (showTemplate)
    return (
      <EpisodeTaskTemplate
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setShowTemplate(false)}
      />
    );
  if (showProgress)
    return (
      <AssetTaskProgress
        crewId={crewId}
        generation={generation}
        onClose={() => setShowProgress(false)}
      />
    );
  if (managingFields)
    return (
      <TaskFieldManagement
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setManagingFields(false)}
      />
    );
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
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (generation === getAuthGeneration()) setManagingFields(true);
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("taskFields.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setShowProgress(true);
        }}
      >
        <ThemedText>{t("assetTaskProgress.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setShowTemplate(true);
        }}
      >
        <ThemedText>{t("episodeTaskTemplate.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setCreatingEpisode(true);
        }}
      >
        <ThemedText>{t("episodeCreate.title")}</ThemedText>
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
