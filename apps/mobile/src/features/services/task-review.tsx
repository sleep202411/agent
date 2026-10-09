import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import type { TaskDetail } from "./task-detail-api";
import {
  fetchTaskReviewPermission,
  primaryVideo,
  revisionDeadline,
  reviewTask,
  type TaskReviewInput,
} from "./task-review-api";
export function TaskReview({
  task,
  userId,
  generation,
  onRefresh,
}: {
  task: TaskDetail;
  userId: string;
  generation: number;
  onRefresh: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(task.id, true);
  const [allowed, setAllowed] = useState<boolean>(),
    [error, setError] = useState<string>(),
    [note, setNote] = useState(""),
    [deadline, setDeadline] = useState(""),
    [attempted, setAttempted] = useState(false),
    [selected, setSelected] = useState(() => primaryVideo(task));
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
  const locked = op.busy || attempted;
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
    void op.run(
      () => {
        setAttempted(true);
        return reviewTask(task.id, task.crewId, {
          expectedSubmissionId: submission.id,
          decision,
          note,
          ...(revisionDueAt ? { revisionDueAt } : {}),
          ...(decision === "approve" && task.storyboardClipId && selected
            ? { bindAssetNodeId: selected }
            : {}),
        });
      },
      onRefresh,
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("taskReview.reviewSubmission")}</ThemedText>
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
        <>
          <TextInput
            accessibilityLabel={t("taskReview.reviewNotePlaceholder")}
            placeholder={t("taskReview.reviewNotePlaceholder")}
            placeholderTextColor={theme.textSecondary}
            value={note}
            onChangeText={setNote}
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
            onChangeText={setDeadline}
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
                  onPress={() => setSelected(asset.id)}
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
