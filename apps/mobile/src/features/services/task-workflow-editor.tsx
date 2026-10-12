import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  fetchTaskWorkflow,
  moveTaskWorkflow,
  type WorkflowSnapshot,
} from "./task-workflow-edit-api";
import { TaskWorkflowField } from "./task-workflow-field";
import type { TaskWorkflow } from "./task-workflow-api";
import type { TaskDetail } from "./task-detail-api";
type Props = { task: TaskDetail; userId: string; generation: number; onRefresh: () => void };
export function TaskWorkflowEditor(props: Props) {
  if (["submitted", "approved", "cancelled"].includes(props.task.status)) return null;
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
      <LoadEditor
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
          <ThemedText>{t("taskWorkflow.edit")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

function LoadEditor(props: Omit<Props, "userId"> & { onCancel: () => void }) {
  const t = useTranslations();
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskWorkflow(props.task, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot(value);
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [props.task, props.generation]);
  if (snapshot) return <Editor {...props} snapshot={snapshot} />;
  return (
    <View style={{ gap: 8 }}>
      {!error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable accessibilityRole="button" onPress={error ? props.onRefresh : props.onCancel}>
        <ThemedText>{t(error ? "thread.refresh" : "myServices.cancel")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Editor({
  snapshot,
  generation,
  onRefresh,
  onCancel,
}: {
  snapshot: WorkflowSnapshot;
  generation: number;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations(),
    op = useAuthFormOperation(snapshot.id, true);
  const [draft, setDraft] = useState<TaskWorkflow | null>(snapshot.workflowState);
  const [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const attemptedRef = useRef(false),
    locked = attempted || op.busy;
  const changed = draft !== null && draft.id !== snapshot.workflowStateId;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("taskWorkflow.edit")}</ThemedText>
      <TaskWorkflowField
        crewId={snapshot.crewId}
        generation={generation}
        selected={draft}
        onSelect={setDraft}
        allowDefault={false}
        locked={locked}
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
        disabled={!changed || locked}
        style={{ padding: 12 }}
        onPress={() => {
          if (!changed || locked || attemptedRef.current || generation !== getAuthGeneration())
            return;
          void op.run(
            () => {
              attemptedRef.current = true;
              setAttempted(true);
              return moveTaskWorkflow(snapshot, draft!);
            },
            onRefresh,
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
      >
        <ThemedText>{t("taskWorkflow.save")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        style={{ padding: 12 }}
        onPress={attempted ? onRefresh : onCancel}
      >
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      {op.busy && <ActivityIndicator />}
    </View>
  );
}
