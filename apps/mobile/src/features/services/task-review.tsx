import { useEffect, useLayoutEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTaskReviewSession, type TaskReviewSession } from "./use-task-review-session";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import type { TaskDetail } from "./task-detail-api";
import {
  fetchTaskReviewPermission,
  revisionDeadline,
  type TaskReviewInput,
} from "./task-review-api";
type Props = {
  task: TaskDetail;
  userId: string;
  generation: number;
  onRefresh: () => void;
  session?: TaskReviewSession;
};
export function TaskReview(props: Props) {
  if (props.session) return <Review {...props} session={props.session} />;
  return <LocalReview key={`${props.task.id}:${props.userId}:${props.generation}`} {...props} />;
}
function LocalReview(props: Props) {
  const session = useTaskReviewSession(props.task.id, props.generation, props.onRefresh);
  return <Review {...props} session={session} />;
}
function Review({
  task,
  userId,
  generation,
  onRefresh,
  session,
}: Props & { session: TaskReviewSession }) {
  const t = useTranslations(),
    theme = useTheme();
  const [allowed, setAllowed] = useState<boolean>();
  const [localError, setError] = useState<string>();
  const { note, deadline, selected } = session.values(task);
  const error = localError ?? session.error;
  const observe = session.observe;
  useLayoutEffect(() => observe(task), [observe, task]);
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskReviewPermission(task.crewId, userId, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted && generation === getAuthGeneration()) setAllowed(value);
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [task.crewId, userId, generation]);
  const submission = task.submissions[0];
  if (task.status !== "submitted" || !submission || allowed === false) return null;
  const locked = session.locked(task);
  const limit = task.revisionLimit !== null && task.revisionRoundsUsed >= task.revisionLimit;
  const videos = submission.assets.filter((a) => a.contentType?.startsWith("video/"));
  const decide = (decision: TaskReviewInput["decision"]) => {
    let revisionDueAt: string | undefined;
    try {
      if (decision === "request_revision")
        revisionDueAt = revisionDeadline(deadline, task.dueAt, Date.now());
    } catch {
      setError(t("taskReview.revisionDeadlineInvalid"));
      return;
    }
    setError(undefined);
    session.save(task, {
      expectedSubmissionId: submission.id,
      decision,
      note,
      ...(revisionDueAt ? { revisionDueAt } : {}),
      ...(decision === "approve" && task.storyboardClipId && selected
        ? { bindAssetNodeId: selected }
        : {}),
    });
  };
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("taskReview.reviewSubmission")}</ThemedText>
      {allowed === undefined && !error && <ActivityIndicator />}
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onRefresh}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
        </>
      )}
      {allowed && (
        <>
          <TextInput
            accessibilityLabel={t("taskReview.reviewNotePlaceholder")}
            placeholder={t("taskReview.reviewNotePlaceholder")}
            placeholderTextColor={theme.textSecondary}
            value={note}
            onChangeText={(value) => session.change(task, "note", value)}
            editable={!locked}
            multiline
            maxLength={5000}
            style={{ color: theme.text, padding: 12, minHeight: 60 }}
          />
          <ThemedText>
            {t(
              limit ? "taskReview.revisionLimitReached" : "taskReview.revisionInstructionsRequired"
            )}
          </ThemedText>
          <ThemedText>
            {t("taskReview.deadlineLabel")} · {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </ThemedText>
          <TextInput
            accessibilityLabel={t("taskReview.deadlineLabel")}
            placeholder="YYYY-MM-DD HH:mm"
            placeholderTextColor={theme.textSecondary}
            value={deadline}
            onChangeText={(value) => session.change(task, "deadline", value)}
            editable={!locked}
            maxLength={16}
            style={{ color: theme.text, padding: 12 }}
          />
          <ThemedText>{t("taskReview.revisionDeadlineHelp")}</ThemedText>
          {task.storyboardClipId && videos.length > 0 && (
            <>
              <ThemedText>{t("taskReview.clipPrimaryAsset")}</ThemedText>
              {videos.map((asset) => (
                <Pressable
                  key={asset.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selected === asset.id }}
                  disabled={locked}
                  onPress={() => session.change(task, "selected", asset.id)}
                  style={{ padding: 12 }}
                >
                  <ThemedText>
                    {selected === asset.id ? "● " : "○ "}
                    {asset.name}
                  </ThemedText>
                </Pressable>
              ))}
              <ThemedText>{t("taskReview.clipPrimaryAssetHint")}</ThemedText>
            </>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={locked || limit || !note.trim()}
            onPress={() => decide("request_revision")}
            style={{ padding: 12 }}
          >
            <ThemedText>{t("taskReview.requestRevision")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            onPress={() => decide("approve")}
            style={{ padding: 12 }}
          >
            <ThemedText>{t("taskReview.approve")}</ThemedText>
          </Pressable>
        </>
      )}
    </View>
  );
}
