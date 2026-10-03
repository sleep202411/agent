import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTaskWorkflowSession, type TaskWorkflowSession } from "./use-task-workflow-session";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { fetchTaskWorkflow, type WorkflowSnapshot } from "./task-workflow-edit-api";
import { TaskWorkflowField } from "./task-workflow-field";
import type { TaskDetail } from "./task-detail-api";
type Props = {
  task: TaskDetail;
  userId: string;
  generation: number;
  onRefresh: () => void;
  session?: TaskWorkflowSession;
};
export function TaskWorkflowEditor(props: Props) {
  if (props.session) return <WorkflowAccess {...props} session={props.session} />;
  return <LocalWorkflow key={`${props.task.id}:${props.generation}`} {...props} />;
}
function LocalWorkflow(props: Props) {
  const session = useTaskWorkflowSession(props.task.id, props.generation, props.onRefresh);
  return <WorkflowAccess {...props} session={session} />;
}
function WorkflowAccess(props: Props & { session: TaskWorkflowSession }) {
  if (["submitted", "approved", "cancelled"].includes(props.task.status)) return null;
  return <Access key={`${props.task.id}:${props.task.version}:${props.generation}`} {...props} />;
}
function Access({
  task,
  userId,
  generation,
  onRefresh,
  session,
}: Props & { session: TaskWorkflowSession }) {
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
  if (session.editing && allowed)
    return (
      <LoadEditor task={task} generation={generation} onRefresh={onRefresh} session={session} />
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
            if (generation === getAuthGeneration()) session.open();
          }}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("taskWorkflow.edit")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

function LoadEditor(props: Omit<Props, "userId"> & { session: TaskWorkflowSession }) {
  const t = useTranslations();
  const initialize = props.session.initialize;
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskWorkflow(props.task, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration()) {
          initialize(value);
          setSnapshot(value);
        }
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [props.task, props.generation, initialize]);
  if (snapshot && props.session.draft) return <Editor {...props} snapshot={snapshot} />;
  return (
    <View style={{ gap: 8 }}>
      {!error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        onPress={error ? props.onRefresh : props.session.cancel}
      >
        <ThemedText>{t(error ? "thread.refresh" : "myServices.cancel")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Editor({
  snapshot,
  generation,
  onRefresh,
  session,
}: {
  snapshot: WorkflowSnapshot;
  generation: number;
  onRefresh: () => void;
  session: TaskWorkflowSession;
}) {
  const t = useTranslations();
  const draft = session.draft!;
  const locked = session.busy || !!draft.attemptedAt;
  const stale = snapshot.version !== draft.snapshot.version;
  const changed = !!draft.target && draft.target.id !== draft.snapshot.workflowStateId;
  const canSave = changed && !locked && !stale;
  const canReview =
    !session.busy && (stale || (!!draft.attemptedAt && snapshot !== draft.attemptedAt));
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("taskWorkflow.edit")}</ThemedText>
      <TaskWorkflowField
        crewId={snapshot.crewId}
        generation={generation}
        selected={draft.target}
        onSelect={session.change}
        allowDefault={false}
        locked={locked}
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
          <ThemedText>{t("taskWorkflow.latest")}</ThemedText>
          <ThemedText>{snapshot.workflowState.name}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => session.review(snapshot)}
            style={{ padding: 12 }}
          >
            <ThemedText>{t("taskBrief.reviewLatest")}</ThemedText>
          </Pressable>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={!canSave}
        onPress={() => {
          if (canSave) session.save(snapshot);
        }}
        style={{ padding: 12, opacity: canSave ? 1 : 0.45 }}
      >
        <ThemedText>{t("taskWorkflow.save")}</ThemedText>
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
