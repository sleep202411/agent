import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { ThemedText } from "@/components/themed-text";
import { useTranslations, useLocale } from "@/i18n";
import { fetchTaskDetail, type TaskDetail as Detail } from "./task-detail-api";
import { TaskCommitments } from "./task-commitments";
import { TaskTimeline } from "./task-timeline";
import { useUserDisplays } from "./user-displays";
type Props = {
  crewId: string;
  taskId: string;
  generation: number;
  userId: string;
  onClose: () => void;
  onOpenWeb: () => void;
};
export function TaskDetail(props: Props) {
  const active = useScreenActive();
  return active && props.generation === getAuthGeneration() ? (
    <TaskContent key={`${props.crewId}:${props.taskId}:${props.generation}`} {...props} />
  ) : null;
}
function TaskContent({ crewId, taskId, generation, userId, onClose, onOpenWeb }: Props) {
  const t = useTranslations(),
    locale = useLocale();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ revision: number; data?: Detail; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskDetail(crewId, taskId, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setResult({ revision, data });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setResult({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [crewId, taskId, generation, revision]);
  const current = result?.revision === revision ? result : undefined;
  const data = current?.data;
  const displays = useUserDisplays(String(generation), data?.assignees.map((a) => a.userId) ?? []);
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale) : t("thread.taskUnset");
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Pressable accessibilityRole="button" onPress={onClose} style={{ padding: 12 }}>
        <ThemedText>{t("thread.backToChat")}</ThemedText>
      </Pressable>
      {!current && <ActivityIndicator accessibilityLabel={t("courses.loading")} />}
      {current?.error && <ThemedText accessibilityRole="alert">{current.error}</ThemedText>}
      {data && (
        <>
          <ThemedText type="smallBold">
            TASK-{data.number} · {data.title}
          </ThemedText>
          <ThemedText>
            {t("thread.taskState")}: {data.workflowState.name}
          </ThemedText>
          <ThemedText>{data.description || t("thread.taskNoDescription")}</ThemedText>
          <ThemedText>
            {t("thread.taskStart")}: {date(data.startAt)}
          </ThemedText>
          <ThemedText>
            {t("thread.taskDue")}: {date(data.dueAt)}
          </ThemedText>
          <ThemedText>{t("thread.taskAssignees")}</ThemedText>
          {data.assignees.length === 0 && <ThemedText>{t("thread.taskUnset")}</ThemedText>}
          {data.assignees.map((a) => (
            <ThemedText key={a.userId}>{displays?.get(a.userId)?.nickname || a.userId}</ThemedText>
          ))}
          <View>
            {data.labels.map((label) => (
              <ThemedText key={label.id}>{label.name}</ThemedText>
            ))}
          </View>
          <TaskCommitments
            key={revision}
            task={data}
            userId={userId}
            generation={generation}
            onRefresh={() => setRevision((v) => v + 1)}
          />
          <TaskTimeline crewId={crewId} taskId={taskId} userId={userId} generation={generation} />
          <Pressable accessibilityRole="button" onPress={onOpenWeb} style={{ padding: 12 }}>
            <ThemedText>{t("thread.taskOpenWorkspace")}</ThemedText>
          </Pressable>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={!current}
        onPress={() => setRevision((v) => v + 1)}
        style={{ padding: 12 }}
      >
        <ThemedText>{t(current?.error ? "inbox.retry" : "thread.refresh")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
