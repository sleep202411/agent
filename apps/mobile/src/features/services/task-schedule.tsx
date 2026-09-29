import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  scheduleDateText,
  parseScheduleDate,
  taskScheduleInput,
  updateTaskSchedule,
} from "./task-schedule-api";
import type { TaskDetail } from "./task-detail-api";
type Props = { task: TaskDetail; userId: string; generation: number; onRefresh: () => void };
export function TaskSchedule(props: Props) {
  if (["approved", "cancelled"].includes(props.task.status)) return null;
  return <Access key={`${props.task.id}:${props.task.version}:${props.generation}`} {...props} />;
}
function Access({ task, userId, generation, onRefresh }: Props) {
  const t = useTranslations();
  const [allowed, setAllowed] = useState<boolean>(),
    [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
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
  if (editing && allowed)
    return (
      <Editor
        task={task}
        generation={generation}
        onRefresh={onRefresh}
        onCancel={() => setEditing(false)}
      />
    );
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
            if (generation === getAuthGeneration()) setEditing(true);
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
  generation,
  onRefresh,
  onCancel,
}: Omit<Props, "userId"> & { onCancel: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(task.id, true);
  // Captured at editor opening; never rebase a draft onto a refreshed server version.
  const [snapshot] = useState(task);
  const [priority, setPriority] = useState(task.priority);
  const [startAt, setStartAt] = useState(() => scheduleDateText(task.startAt));
  const [dueAt, setDueAt] = useState(() => scheduleDateText(task.dueAt));
  const [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false);
  const attemptedRef = useRef(false);
  const locked = op.busy || attempted;
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
  const canSave = !!data && changed && !locked;
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
            onPress={() => setPriority(value)}
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
        onChangeText={setStartAt}
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
        onChangeText={setDueAt}
        editable={!locked}
        placeholder="YYYY-MM-DD HH:mm"
        placeholderTextColor={theme.textSecondary}
        maxLength={16}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskSchedule.clearHelp")}</ThemedText>
      {!data && <ThemedText accessibilityRole="alert">{t("taskSchedule.invalid")}</ThemedText>}
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onRefresh}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={!canSave}
        style={{ padding: 12 }}
        onPress={() => {
          if (!data || !canSave || attemptedRef.current || generation !== getAuthGeneration())
            return;
          void op.run(
            () => {
              attemptedRef.current = true;
              setAttempted(true);
              return updateTaskSchedule(snapshot, data);
            },
            onRefresh,
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
      >
        <ThemedText>{t("taskSchedule.save")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        onPress={attempted ? onRefresh : onCancel}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      {op.busy && <ActivityIndicator />}
    </View>
  );
}
