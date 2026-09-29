import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { fetchTaskChildContext } from "./task-child-context";
import { TaskCreate } from "./task-create";
import type { TaskDetail } from "./task-detail-api";
type Props = { task: TaskDetail; userId: string; generation: number };
export function TaskChildButton({
  task,
  userId,
  generation,
  onOpen,
}: Props & { onOpen: () => void }) {
  const t = useTranslations();
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskCommentAccess(task.crewId, userId, controller.signal).then(
      (access) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setAllowed(access.canManage);
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [task.crewId, userId, generation, attempt]);
  if (["approved", "cancelled"].includes(task.status)) return null;
  if (error)
    return (
      <View>
        <ThemedText accessibilityRole="alert">{error}</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setError(undefined);
            setAttempt((n) => n + 1);
          }}
        >
          <ThemedText>{t("inbox.retry")}</ThemedText>
        </Pressable>
      </View>
    );
  if (!allowed) return null;
  return (
    <Pressable
      accessibilityRole="button"
      style={{ padding: 12 }}
      onPress={() => {
        if (generation === getAuthGeneration()) onOpen();
      }}
    >
      <ThemedText>{t("taskCreate.addSubtask")}</ThemedText>
    </Pressable>
  );
}
export function TaskChildCreate({
  task,
  userId,
  generation,
  onCreated,
  onClose,
}: Props & { onCreated: (id: string) => void; onClose: () => void }) {
  const t = useTranslations();
  const [context, setContext] = useState<Awaited<ReturnType<typeof fetchTaskChildContext>>>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskChildContext(task, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted && generation === getAuthGeneration()) setContext(value);
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [task, generation]);
  if (context)
    return (
      <TaskCreate
        crewId={task.crewId}
        userId={userId}
        generation={generation}
        initialParent={context.parent}
        initialWorkflow={context.workflow}
        closeLabel={t("taskRelations.backToTask")}
        onCreated={onCreated}
        onClose={onClose}
      />
    );
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {!error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable accessibilityRole="button" onPress={onClose}>
        <ThemedText>{t("taskRelations.backToTask")}</ThemedText>
      </Pressable>
    </View>
  );
}
