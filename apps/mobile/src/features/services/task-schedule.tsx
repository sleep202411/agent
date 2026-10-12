import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTaskScheduleSession, type TaskScheduleSession } from "./use-task-schedule-session";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { scheduleDateText, parseScheduleDate, taskScheduleInput } from "./task-schedule-api";
import type { TaskDetail } from "./task-detail-api";
type Props = {
  task: TaskDetail;
  userId: string;
  generation: number;
  onRefresh: () => void;
  session?: TaskScheduleSession;
};
export function TaskSchedule(props: Props) {
  if (props.session) return <ScheduleAccess {...props} session={props.session} />;
  return <LocalSchedule key={`${props.task.id}:${props.generation}`} {...props} />;
}
function LocalSchedule(props: Props) {
  const session = useTaskScheduleSession(props.task.id, props.generation, props.onRefresh);
  return <ScheduleAccess {...props} session={session} />;
}
function ScheduleAccess(props: Props & { session: TaskScheduleSession }) {
  if (["approved", "cancelled"].includes(props.task.status)) return null;
  return <Access key={`${props.task.id}:${props.task.version}:${props.generation}`} {...props} />;
}

function Access({
  task,
  userId,
  generation,
  onRefresh,
  session,
}: Props & { session: TaskScheduleSession }) {
  const t = useTranslations();
  const [allowed, setAllowed] = useState<boolean>(),
    [error, setError] = useState<string>();
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
  }, [task.crewId, userId, generation]);
  if (allowed === false) return null;
  if (session.draft && allowed)
    return <Editor task={task} generation={generation} onRefresh={onRefresh} session={session} />;
  return (
    <View style={{ gap: 8 }}>
      {allowed === undefined && !error && <ActivityIndicator />}
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable onPress={onRefresh}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
        </>
      )}
      {allowed && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (generation === getAuthGeneration()) session.open(task);
          }}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("taskSchedule.edit")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
function Editor({
  task,
  onRefresh,
  session,
}: Omit<Props, "userId"> & { session: TaskScheduleSession }) {
  const t = useTranslations(),
    theme = useTheme();
  const draft = session.draft!;
  const { snapshot, priority, startAt, dueAt, error } = draft;
  const locked = session.busy || !!draft.attemptedAt;
  const stale = task.version !== snapshot.version;
  const canReview = !session.busy && (stale || (!!draft.attemptedAt && task !== draft.attemptedAt));
  let data:
    | {
        expectedVersion: number;
        priority: TaskDetail["priority"];
        startAt: string | null;
        dueAt: string | null;
      }
    | undefined;
  try {
    data = taskScheduleInput.parse({
      expectedVersion: snapshot.version,
      priority,
      startAt: parseScheduleDate(startAt, snapshot.startAt),
      dueAt: parseScheduleDate(dueAt, snapshot.dueAt),
    });
  } catch {
    /* Invalid dates stay editable and are explained below. */
  }
  const changed =
    !!data &&
    (data.priority !== snapshot.priority ||
      data.startAt !== snapshot.startAt ||
      data.dueAt !== snapshot.dueAt);
  const canSave = !!data && changed && !locked && !stale;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("taskSchedule.edit")}</ThemedText>
      <ThemedText>{t("taskSchedule.priority")}</ThemedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(["low", "normal", "high", "urgent"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === priority }}
            disabled={locked}
            onPress={() => session.change("priority", value)}
            style={{
              padding: 12,
              backgroundColor:
                value === priority ? theme.backgroundSelected : theme.backgroundElement,
            }}
          >
            <ThemedText>{t(`taskSchedule.${value}`)}</ThemedText>
          </Pressable>
        ))}
      </View>
      <ThemedText>
        {t("taskSchedule.localTime")} · {Intl.DateTimeFormat().resolvedOptions().timeZone}
      </ThemedText>
      <ThemedText>{t("thread.taskStart")}</ThemedText>
      <TextInput
        accessibilityLabel={t("thread.taskStart")}
        value={startAt}
        onChangeText={(value) => session.change("startAt", value)}
        editable={!locked}
        placeholder="YYYY-MM-DD HH:mm"
        placeholderTextColor={theme.textSecondary}
        maxLength={16}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("thread.taskDue")}</ThemedText>
      <TextInput
        accessibilityLabel={t("thread.taskDue")}
        value={dueAt}
        onChangeText={(value) => session.change("dueAt", value)}
        editable={!locked}
        placeholder="YYYY-MM-DD HH:mm"
        placeholderTextColor={theme.textSecondary}
        maxLength={16}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskSchedule.clearHelp")}</ThemedText>
      {!data && <ThemedText accessibilityRole="alert">{t("taskSchedule.invalid")}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {(error || stale) && (
        <Pressable
          accessibilityRole="button"
          disabled={session.busy}
          onPress={onRefresh}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("thread.refresh")}</ThemedText>
        </Pressable>
      )}
      {canReview && (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("taskSchedule.latest")}</ThemedText>
          <ThemedText>
            {t("taskSchedule.priority")}: {t(`taskSchedule.${task.priority}`)}
          </ThemedText>
          <ThemedText>
            {t("thread.taskStart")}: {scheduleDateText(task.startAt) || t("thread.taskUnset")}
          </ThemedText>
          <ThemedText>
            {t("thread.taskDue")}: {scheduleDateText(task.dueAt) || t("thread.taskUnset")}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => session.review(task)}
            style={{ padding: 12 }}
          >
            <ThemedText>{t("taskBrief.reviewLatest")}</ThemedText>
          </Pressable>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={!canSave}
        style={{ padding: 12, opacity: canSave ? 1 : 0.45 }}
        onPress={() => {
          if (canSave) session.save(task);
        }}
      >
        <ThemedText>{t("taskSchedule.save")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={session.busy}
        onPress={session.cancel}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      {session.busy && <ActivityIndicator />}
    </View>
  );
}
