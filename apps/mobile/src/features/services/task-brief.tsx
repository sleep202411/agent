import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { taskBriefInput, updateTaskBrief } from "./task-brief-api";
import type { TaskDetail } from "./task-detail-api";
type Props = { task: TaskDetail; userId: string; generation: number; onRefresh: () => void };
export function TaskBrief(props: Props) {
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
          <ThemedText>{t("taskBrief.edit")}</ThemedText>
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
  const [title, setTitle] = useState(task.title),
    [description, setDescription] = useState(task.description);
  const [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false);
  const attemptedRef = useRef(false);
  const locked = op.busy || attempted;
  const parsed = taskBriefInput.safeParse({
    expectedVersion: snapshot.version,
    title,
    description,
  });
  const changed = title.trim() !== snapshot.title || description.trim() !== snapshot.description;
  const canSave = parsed.success && changed && !locked;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("taskBrief.edit")}</ThemedText>
      <ThemedText>{t("taskBrief.title")} *</ThemedText>
      <TextInput
        accessibilityLabel={t("taskBrief.title")}
        value={title}
        onChangeText={setTitle}
        editable={!locked}
        maxLength={180}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskBrief.description")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskBrief.description")}
        value={description}
        onChangeText={setDescription}
        editable={!locked}
        maxLength={10000}
        multiline
        style={{ color: theme.text, padding: 12, minHeight: 100 }}
      />
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
          if (
            !parsed.success ||
            !canSave ||
            attemptedRef.current ||
            generation !== getAuthGeneration()
          )
            return;
          void op.run(
            () => {
              attemptedRef.current = true;
              setAttempted(true);
              return updateTaskBrief(snapshot, parsed.data);
            },
            onRefresh,
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
      >
        <ThemedText>{t("taskBrief.save")}</ThemedText>
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
