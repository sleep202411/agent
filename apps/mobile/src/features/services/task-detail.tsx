import { TaskDeliveryManagement } from "./task-delivery-management";
import { TaskCompensationSummary } from "./task-compensation-summary";
import { TaskDelete } from "./task-delete";
import { TaskClosure } from "./task-closure";
import { TaskDeadline } from "./task-deadline";
import { TaskCustomFields } from "./task-custom-fields";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { ThemedText } from "@/components/themed-text";
import { useTranslations, useLocale } from "@/i18n";
import { fetchTaskDetail, type TaskDetail as Detail } from "./task-detail-api";
import { TaskChildButton, TaskChildCreate } from "./task-child-create";
import { TaskAssignments } from "./task-assignments";
import { TaskSchedule } from "./task-schedule";
import { TaskWorkflowEditor } from "./task-workflow-editor";
import { TaskPlanningEditor } from "./task-planning-editor";
import { useTaskBriefSession } from "./use-task-brief-session";
import { TaskBrief } from "./task-brief";
import { TaskRelationshipEditor } from "./task-relationship-editor";
import { TaskRelations } from "./task-relations";
import { TaskSubmit } from "./task-submit";
import { TaskCaseCreate } from "./task-case-create";
import { TaskFeedbackCreate } from "./task-feedback-create";
import { TaskReview } from "./task-review";
import { TaskDelivery } from "./task-delivery";
import { TaskCommitments } from "./task-commitments";
import { TaskTimeline } from "./task-timeline";
import { useUserDisplays } from "./user-displays";
type Props = {
  crewId: string;
  taskId: string;
  generation: number;
  userId: string;
  onClose: () => void;
  closeLabel?: string;
  onOpenWeb: (taskId: string) => void;
};
export function TaskDetail(props: Props) {
  const active = useScreenActive();
  return active && props.generation === getAuthGeneration() ? (
    <TaskNavigator key={`${props.crewId}:${props.taskId}:${props.generation}`} {...props} />
  ) : null;
}
function TaskNavigator(props: Props) {
  const [history, setHistory] = useState([props.taskId]);
  const taskId = history[history.length - 1]!;
  return (
    <TaskContent
      {...props}
      key={taskId}
      taskId={taskId}
      backToTask={history.length > 1}
      onOpenTask={(id) =>
        setHistory((current) => {
          const index = current.indexOf(id);
          return index >= 0 ? current.slice(0, index + 1) : [...current, id];
        })
      }
      onClose={() =>
        history.length > 1
          ? setHistory((current) => (current.length > 1 ? current.slice(0, -1) : current))
          : props.onClose()
      }
    />
  );
}
function TaskContent({
  crewId,
  taskId,
  generation,
  userId,
  onClose,
  onOpenWeb,
  onOpenTask,
  backToTask,
  closeLabel,
}: Props & {
  onOpenTask: (id: string) => void;
  backToTask: boolean;
}) {
  const t = useTranslations(),
    locale = useLocale();
  const [creatingChild, setCreatingChild] = useState(false);
  const [revision, setRevision] = useState(0);
  const briefSession = useTaskBriefSession(taskId, generation, () => setRevision((v) => v + 1));
  const [result, setResult] = useState<{ revision: number; data?: Detail; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskDetail(crewId, taskId, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setResult({ revision, data });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setResult({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [crewId, taskId, generation, revision]);
  const current = result?.revision === revision ? result : undefined;
  const data = current?.data;
  const displays = useUserDisplays(String(generation), data?.assignees.map((a) => a.userId) ?? []);
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale) : t("thread.taskUnset");
  if (creatingChild && data)
    return (
      <TaskChildCreate
        task={data}
        userId={userId}
        generation={generation}
        onCreated={(id) => {
          if (generation === getAuthGeneration()) {
            setCreatingChild(false);
            onOpenTask(id);
          }
        }}
        onClose={() => {
          setCreatingChild(false);
          setRevision((value) => value + 1);
        }}
      />
    );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <Pressable accessibilityRole="button" onPress={onClose} style={{ padding: 12 }}>
        <ThemedText>
          {backToTask ? t("taskRelations.backToTask") : (closeLabel ?? t("thread.backToChat"))}
        </ThemedText>
      </Pressable>
      {!current && <ActivityIndicator accessibilityLabel={t("courses.loading")} />}
      {current?.error && <ThemedText accessibilityRole="alert">{current.error}</ThemedText>}
      {data && (
        <>
          <ThemedText type="smallBold">
            TASK-{data.number} · {data.title}
          </ThemedText>
          <ThemedText>
            {t("thread.taskState")}: {data.workflowState.name}
          </ThemedText>
          <ThemedText>{data.description || t("thread.taskNoDescription")}</ThemedText>
          <ThemedText>
            {t("thread.taskStart")}: {date(data.startAt)}
          </ThemedText>
          <ThemedText>
            {t("thread.taskDue")}: {date(data.dueAt)}
            <TaskDeadline dueAt={data.dueAt} status={data.status} />
          </ThemedText>
          <ThemedText>{t("thread.taskAssignees")}</ThemedText>
          {data.assignees.length === 0 && <ThemedText>{t("thread.taskUnset")}</ThemedText>}
          {data.assignees.map((a) => (
            <ThemedText key={a.userId}>{displays?.get(a.userId)?.nickname || a.userId}</ThemedText>
          ))}
          <View>
            {data.labels.map((label) => (
              <ThemedText key={label.id}>{label.name}</ThemedText>
            ))}
          </View>
          <ThemedText>
            {t("taskSchedule.priority")}: {t(`taskSchedule.${data.priority}`)}
          </ThemedText>
          {data.taskKind !== undefined && (
            <ThemedText>
              {t("taskKind.label")}:{" "}
              {t(data.taskKind ? `taskKind.${data.taskKind}` : "taskKind.unset")}
            </ThemedText>
          )}
          <TaskCompensationSummary {...data} />
          {data.estimatePoints !== undefined && (
            <ThemedText>
              {t("taskPlanning.estimate")}: {data.estimatePoints ?? t("taskPlanning.unset")}
            </ThemedText>
          )}
          <ThemedText>
            {t("taskPlanning.revisionsUsed")}: {data.revisionRoundsUsed} /{" "}
            {data.revisionLimit ?? t("taskPlanning.unlimited")}
          </ThemedText>
          <TaskSchedule
            key={`schedule:${revision}`}
            task={data}
            userId={userId}
            generation={generation}
            onRefresh={() => setRevision((v) => v + 1)}
          />
          <TaskAssignments
            key={`assignments:${revision}`}
            task={data}
            userId={userId}
            generation={generation}
            onRefresh={() => setRevision((value) => value + 1)}
          />
          <TaskWorkflowEditor
            key={`workflow:${revision}`}
            task={data}
            userId={userId}
            generation={generation}
            onRefresh={() => setRevision((n) => n + 1)}
          />
          <TaskPlanningEditor
            key={`planning:${revision}`}
            task={data}
            userId={userId}
            generation={generation}
            onRefresh={() => setRevision((n) => n + 1)}
          />
          <TaskDelete
            key={`delete:${revision}`}
            task={data}
            userId={userId}
            generation={generation}
            onDeleted={onClose}
            onRefresh={() => setRevision((v) => v + 1)}
          />
          <TaskClosure
            key={`closure:${revision}`}
            task={data}
            userId={userId}
            generation={generation}
            onRefresh={() => setRevision((v) => v + 1)}
          />
          <TaskBrief
            session={briefSession}
            key={`brief:${revision}`}
            task={data}
            userId={userId}
            generation={generation}
            onRefresh={() => setRevision((v) => v + 1)}
          />
          <TaskRelationshipEditor
            key={`relationships:${revision}`}
            task={data}
            userId={userId}
            generation={generation}
            onRefresh={() => setRevision((v) => v + 1)}
          />
          <TaskChildButton
            key={`child:${revision}`}
            task={data}
            userId={userId}
            generation={generation}
            onOpen={() => setCreatingChild(true)}
          />
          <TaskCustomFields
            key={`fields:${revision}`}
            task={data}
            generation={generation}
            userId={userId}
            onRefresh={() => setRevision((v) => v + 1)}
          />
          <TaskRelations task={data} onOpenTask={onOpenTask} />
          <TaskDeliveryManagement
            task={data}
            generation={generation}
            userId={userId}
            onRefresh={() => setRevision((v) => v + 1)}
          />
          <TaskDelivery
            key={`delivery:${revision}`}
            taskId={taskId}
            generation={generation}
            submissions={data.submissions}
          />
          <TaskSubmit
            key={`submit:${revision}`}
            task={data}
            userId={userId}
            generation={generation}
            onRefresh={() => setRevision((v) => v + 1)}
          />
          <TaskReview
            key={`review:${revision}`}
            task={data}
            userId={userId}
            generation={generation}
            onRefresh={() => setRevision((v) => v + 1)}
          />
          <TaskCaseCreate crewId={crewId} taskId={taskId} userId={userId} generation={generation} />
          <TaskFeedbackCreate task={data} userId={userId} generation={generation} />
          <TaskCommitments
            key={revision}
            task={data}
            userId={userId}
            generation={generation}
            onRefresh={() => setRevision((v) => v + 1)}
          />
          <TaskTimeline crewId={crewId} taskId={taskId} userId={userId} generation={generation} />
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpenWeb(taskId)}
            style={{ padding: 12 }}
          >
            <ThemedText>{t("thread.taskOpenWorkspace")}</ThemedText>
          </Pressable>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={!current}
        onPress={() => setRevision((v) => v + 1)}
        style={{ padding: 12 }}
      >
        <ThemedText>{t(current?.error ? "inbox.retry" : "thread.refresh")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
