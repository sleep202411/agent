import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations, useLocale } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { useUserDisplays } from "./user-displays";
import type { TaskDetail } from "./task-detail-api";
import {
  fetchTaskCommitments,
  setTaskCommitment,
  closeTaskHandover,
  type TaskCommitment,
  type CommitmentAction,
} from "./task-commitment-api";
/** Mounted inside the account/focus-scoped task detail; parent refresh remounts this view. */
export function TaskCommitments({
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
    locale = useLocale(),
    theme = useTheme();
  const [result, setResult] = useState<{ records: TaskCommitment[]; canManage: boolean }>(),
    [error, setError] = useState<string>(),
    [reason, setReason] = useState(""),
    [attempted, setAttempted] = useState(false);
  const op = useAuthFormOperation(task.id, true);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetchTaskCommitments(task.id, controller.signal),
      fetchTaskCommentAccess(task.crewId, userId, controller.signal),
    ]).then(
      ([records, access]) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setResult({ records, canManage: access.canManage });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [task.id, task.crewId, userId, generation]);
  const records = result?.records ?? [];
  const displays = useUserDisplays(String(generation), [
    ...task.assignees.map((a) => a.userId),
    ...records.map((r) => r.userId),
  ]);
  const name = (id: string) => displays?.get(id)?.nickname || id;
  const own = records.find((r) => r.userId === userId && r.currentAssignment);
  const assigned = task.assignees.some((a) => a.userId === userId),
    active = !["submitted", "approved", "cancelled"].includes(task.status);
  const locked = op.busy || attempted;
  const submit = (action: CommitmentAction["action"]) => {
    void op.run(
      () => {
        setAttempted(true);
        return setTaskCommitment(task.id, userId, {
          expectedVersion: task.version,
          action,
          reason: action === "accept" ? "" : reason.trim(),
        });
      },
      onRefresh,
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  return (
    <View style={{ gap: 10 }}>
      <ThemedText type="smallBold">{t("taskCommitment.commitments")}</ThemedText>
      <ThemedText>{t("taskCommitment.commitmentHelp")}</ThemedText>
      {!result && !error && <ActivityIndicator />}
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onRefresh}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
        </>
      )}
      {result && (
        <>
          {task.assignees
            .filter((a) => !records.some((r) => r.assignmentId === a.id))
            .map((a) => (
              <ThemedText key={a.id}>
                {name(a.userId)} · {t("taskCommitment.pending")}
              </ThemedText>
            ))}
          {!task.assignees.length && !records.length && (
            <ThemedText>{t("taskCommitment.noAssignments")}</ThemedText>
          )}
          {records.map((record) => (
            <View key={record.id} style={{ gap: 6 }}>
              <ThemedText>
                {name(record.userId)} ·{" "}
                {t(
                  record.releasedAt
                    ? "taskCommitment.handedOver"
                    : record.status === "withdrawn" && !record.acceptedAt
                      ? "taskCommitment.declined"
                      : record.status === "accepted"
                        ? "taskCommitment.accepted"
                        : record.status === "at_risk"
                          ? "taskCommitment.at_risk"
                          : "taskCommitment.withdrawn"
                )}
              </ThemedText>
              {!record.currentAssignment && !record.releasedAt && (
                <ThemedText>{t("taskCommitment.handoverPending")}</ThemedText>
              )}
              {record.promisedDueAt && (
                <ThemedText>
                  {t("taskCommitment.promisedDeadline")}:{" "}
                  {new Date(record.promisedDueAt).toLocaleString(locale)}
                </ThemedText>
              )}
              {record.deadlineChanged && (
                <ThemedText>{t("taskCommitment.deadlineChanged")}</ThemedText>
              )}
              {record.overdue && record.currentAssignment && (
                <ThemedText>{t("taskCommitment.overdue")}</ThemedText>
              )}
              {!!record.reason && <ThemedText>{record.reason}</ThemedText>}
              {!!record.handoverNote && (
                <ThemedText>
                  {t("taskCommitment.handover")}: {record.handoverNote}
                </ThemedText>
              )}
              {!error &&
                result.canManage &&
                (!record.currentAssignment || task.status === "cancelled") &&
                !record.releasedAt && (
                  <Handover taskId={task.id} recordId={record.id} onRefresh={onRefresh} />
                )}
            </View>
          ))}
          {!error && assigned && active && own?.status !== "withdrawn" && !own?.releasedAt && (
            <>
              {!own?.acceptedAt && (
                <>
                  <Pressable
                    accessibilityRole="button"
                    disabled={locked || !task.dueAt || new Date(task.dueAt).getTime() <= now}
                    onPress={() => submit("accept")}
                    style={{ padding: 12 }}
                  >
                    <ThemedText>{t("taskCommitment.accept")}</ThemedText>
                  </Pressable>
                  {(!task.dueAt || new Date(task.dueAt).getTime() <= now) && (
                    <ThemedText>{t("taskCommitment.futureDeadline")}</ThemedText>
                  )}
                </>
              )}
              <TextInput
                accessibilityLabel={t("taskCommitment.reason")}
                placeholder={t("taskCommitment.reasonHelp")}
                placeholderTextColor={theme.textSecondary}
                value={reason}
                onChangeText={setReason}
                multiline
                maxLength={2000}
                editable={!locked}
                style={{ color: theme.text, minHeight: 60, padding: 12 }}
              />
              {!!own?.acceptedAt && (
                <Pressable
                  accessibilityRole="button"
                  disabled={locked || reason.trim().length < 3}
                  onPress={() => submit("at_risk")}
                  style={{ padding: 12 }}
                >
                  <ThemedText>{t("taskCommitment.reportRisk")}</ThemedText>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={locked || reason.trim().length < 3}
                onPress={() => submit("withdraw")}
                style={{ padding: 12 }}
              >
                <ThemedText>
                  {t(
                    own?.acceptedAt ? "taskCommitment.withdrawTask" : "taskCommitment.declineTask"
                  )}
                </ThemedText>
              </Pressable>
            </>
          )}
        </>
      )}
    </View>
  );
}
function Handover({
  taskId,
  recordId,
  onRefresh,
}: {
  taskId: string;
  recordId: string;
  onRefresh: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(recordId, true);
  const [note, setNote] = useState(""),
    [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{t("taskCommitment.handoverHelp")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskCommitment.handover")}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={2000}
        editable={!op.busy && !attempted}
        style={{ color: theme.text, padding: 12 }}
      />
      <Pressable
        accessibilityRole="button"
        disabled={op.busy || attempted || note.trim().length < 3}
        style={{ padding: 12 }}
        onPress={() => {
          void op.run(
            () => {
              setAttempted(true);
              return closeTaskHandover(taskId, recordId, note);
            },
            onRefresh,
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
      >
        <ThemedText>{t("taskCommitment.closeHandover")}</ThemedText>
      </Pressable>
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onRefresh}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
        </>
      )}
    </View>
  );
}
