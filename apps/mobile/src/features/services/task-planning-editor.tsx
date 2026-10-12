import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  fetchTaskPlanning,
  planningChanges,
  planningDraft,
  updateTaskPlanning,
  type PlanningSnapshot,
} from "./task-planning-edit-api";
import { useTheme } from "@/hooks/use-theme";
import { parsePlanningNumber } from "./task-planning-number";
import { TaskKindField } from "./task-kind-field";
import type { TaskKind } from "./task-kind-api";
import { TaskPlanningFields } from "./task-planning-fields";
import type { TaskDetail } from "./task-detail-api";
type Props = { task: TaskDetail; userId: string; generation: number; onRefresh: () => void };
export function TaskPlanningEditor(props: Props) {
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
          <ThemedText>{t("taskPlanning.edit")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

function LoadEditor(props: Omit<Props, "userId"> & { onCancel: () => void }) {
  const t = useTranslations();
  const [snapshot, setSnapshot] = useState<PlanningSnapshot>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskPlanning(props.task, controller.signal).then(
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
  snapshot: PlanningSnapshot;
  generation: number;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(snapshot.id, true);
  const [estimate, setEstimate] = useState(
    snapshot.estimatePoints == null ? "" : String(snapshot.estimatePoints)
  );
  const [revisionLimit, setRevisionLimit] = useState(
    snapshot.revisionLimit == null ? "" : String(snapshot.revisionLimit)
  );
  const [taskKind, setTaskKind] = useState<TaskKind | null>(snapshot.taskKind);
  const [draft, setDraft] = useState(() => planningDraft(snapshot));
  const [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const attemptedRef = useRef(false),
    locked = attempted || op.busy;
  const parsed = (() => {
    try {
      return planningChanges(snapshot, draft, taskKind, {
        estimatePoints: parsePlanningNumber(estimate, 1_000_000),
        revisionLimit: parsePlanningNumber(revisionLimit, 100),
      });
    } catch {
      return undefined;
    }
  })();
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("taskPlanning.edit")}</ThemedText>
      <ThemedText>{t("taskPlanning.estimate")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskPlanning.estimate")}
        value={estimate}
        onChangeText={setEstimate}
        editable={!locked}
        keyboardType="number-pad"
        maxLength={16}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskPlanning.revisionLimit")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskPlanning.revisionLimit")}
        value={revisionLimit}
        onChangeText={setRevisionLimit}
        editable={!locked}
        keyboardType="number-pad"
        maxLength={16}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>
        {t("taskPlanning.revisionsUsed")}: {snapshot.revisionRoundsUsed}
      </ThemedText>
      <ThemedText>{t("taskPlanning.numberHelp")}</ThemedText>
      <TaskKindField
        crewId={snapshot.crewId}
        generation={generation}
        selected={taskKind}
        locked={locked}
        loadTemplates={false}
        onSelect={setTaskKind}
      />
      <TaskPlanningFields
        crewId={snapshot.crewId}
        generation={generation}
        value={draft}
        onChange={setDraft}
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
        disabled={!parsed?.success || locked}
        style={{ padding: 12 }}
        onPress={() => {
          if (
            !parsed?.success ||
            locked ||
            attemptedRef.current ||
            generation !== getAuthGeneration()
          )
            return;
          void op.run(
            () => {
              attemptedRef.current = true;
              setAttempted(true);
              return updateTaskPlanning(snapshot, parsed.data);
            },
            onRefresh,
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
      >
        <ThemedText>{t("taskPlanning.save")}</ThemedText>
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
