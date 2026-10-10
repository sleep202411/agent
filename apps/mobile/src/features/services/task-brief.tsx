import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTaskBriefSession, type TaskBriefSession } from "./use-task-brief-session";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { taskBriefInput } from "./task-brief-api";
import type { TaskDetail } from "./task-detail-api";
type Props = {
  task: TaskDetail;
  userId: string;
  generation: number;
  onRefresh: () => void;
  session?: TaskBriefSession;
};
export function TaskBrief(props: Props) {
  if (props.session) return <BriefAccess {...props} session={props.session} />;
  return <LocalBrief key={`${props.task.id}:${props.generation}`} {...props} />;
}
function LocalBrief(props: Props) {
  const session = useTaskBriefSession(props.task.id, props.generation, props.onRefresh);
  return <BriefAccess {...props} session={session} />;
}
function BriefAccess(props: Props & { session: TaskBriefSession }) {
  if (["approved", "cancelled"].includes(props.task.status)) return null;
  return <Access key={`${props.task.id}:${props.task.version}:${props.generation}`} {...props} />;
}

function Access({
  task,
  userId,
  generation,
  onRefresh,
  session,
}: Props & { session: TaskBriefSession }) {
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
          <ThemedText>{t("taskBrief.edit")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
function Editor({
  task,
  onRefresh,
  session,
}: Omit<Props, "userId"> & { session: TaskBriefSession }) {
  const t = useTranslations(),
    theme = useTheme();
  const draft = session.draft!;
  const locked = session.busy || !!draft.attemptedAt;
  const stale = task.version !== draft.snapshot.version;
  const parsed = taskBriefInput.safeParse({
    expectedVersion: draft.snapshot.version,
    title: draft.title,
    description: draft.description,
  });
  const changed =
    draft.title.trim() !== draft.snapshot.title ||
    draft.description.trim() !== draft.snapshot.description;
  const canSave = parsed.success && changed && !locked && !stale;
  const canReview = !session.busy && (stale || (!!draft.attemptedAt && task !== draft.attemptedAt));
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("taskBrief.edit")}</ThemedText>
      <ThemedText>{t("taskBrief.title")} *</ThemedText>
      <TextInput
        accessibilityLabel={t("taskBrief.title")}
        value={draft.title}
        onChangeText={(v) => session.change("title", v)}
        editable={!locked}
        maxLength={180}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskBrief.description")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskBrief.description")}
        value={draft.description}
        onChangeText={(v) => session.change("description", v)}
        editable={!locked}
        maxLength={10000}
        multiline
        style={{ color: theme.text, padding: 12, minHeight: 100 }}
      />
      {draft.error && <ThemedText accessibilityRole="alert">{draft.error}</ThemedText>}
      {(draft.error || stale) && (
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
          <ThemedText>{t("taskBrief.latest")}</ThemedText>
          <ThemedText>{task.title}</ThemedText>
          <ThemedText>{task.description}</ThemedText>
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => session.review(task)}
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
        <ThemedText>{t("taskBrief.save")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={session.busy}
        onPress={session.cancel}
        style={{ padding: 12, opacity: session.busy ? 0.45 : 1 }}
      >
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      {session.busy && <ActivityIndicator />}
    </View>
  );
}
