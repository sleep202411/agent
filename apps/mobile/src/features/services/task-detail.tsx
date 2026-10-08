import { TaskEdit } from "./task-edit";
import { TaskManagementMenu } from "./task-management-menu";
import { PositionCreate } from "./position-create";
import { TaskInviteLinks } from "./task-invite-links";
import { TaskContractFiles } from "./task-contract-files";
import { useTaskSubmitSession } from "./use-task-submit-session";
import { useTaskReviewSession } from "./use-task-review-session";
import { taskWorkflowLabel } from "./task-workflow-label";
import { useTaskDeliverySession } from "./use-task-delivery-session";
import { TaskDeliveryManagement } from "./task-delivery-management";
import { TaskCompensationSummary } from "./task-compensation-summary";
import { TaskDelete } from "./task-delete";
import { TaskClosure } from "./task-closure";
import { TaskDeadline } from "./task-deadline";
import { useTaskCustomFieldSession } from "./use-task-custom-field-session";
import { TaskCustomFields } from "./task-custom-fields";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useIsFocused } from "expo-router";
import { useScreenActive } from "@/hooks/use-app-active";
import { ThemedText } from "@/components/themed-text";
import { useTranslations, useLocale } from "@/i18n";
import { fetchTaskDetail, type TaskDetail as Detail } from "./task-detail-api";
import { TaskChildButton, TaskChildCreate } from "./task-child-create";
import { useTaskAssignmentSession } from "./use-task-assignment-session";
import { TaskAssignments } from "./task-assignments";
import { useTaskScheduleSession } from "./use-task-schedule-session";
import { TaskSchedule } from "./task-schedule";
import { useTaskWorkflowSession } from "./use-task-workflow-session";
import { TaskWorkflowEditor } from "./task-workflow-editor";
import { useTaskPlanningSession } from "./use-task-planning-session";
import { TaskPlanningEditor } from "./task-planning-editor";
import { useTaskBriefSession } from "./use-task-brief-session";
import { TaskBrief } from "./task-brief";
import { useTaskRelationshipSession } from "./use-task-relationship-session";
import { TaskRelationshipEditor } from "./task-relationship-editor";
import { TaskRelations } from "./task-relations";
import { TaskSubmit, TaskSubmissionUpload } from "./task-submit";
import { TaskCaseCreate } from "./task-case-create";
import { TaskFeedbackCreate } from "./task-feedback-create";
import { TaskReview } from "./task-review";
import { TaskDelivery } from "./task-delivery";
import { TaskCommitments } from "./task-commitments";
import { TaskTimeline } from "./task-timeline";
import { useUserDisplays } from "./user-displays";
type Props = {
  initialAction?: "edit" | "invite" | "recruit";
  crewId: string;
  taskId: string;
  generation: number;
  userId: string;
  onClose: () => void;
  closeLabel?: string;
  onOpenWeb: (taskId: string) => void;
};
export function TaskDetail(props: Props) {
  const focused = useIsFocused();
  return focused && props.generation === getAuthGeneration() ? (
    <TaskNavigator key={`${props.crewId}:${props.taskId}:${props.generation}`} {...props} />
  ) : null;
}
function TaskNavigator(props: Props) {
  const active = useScreenActive();
  const [activity, setActivity] = useState({ active, revision: 0 });
  // Every host uses the same foreground read boundary, while the task sessions
  // (including native uploads) remain mounted through app interruptions.
  if (activity.active !== active) {
    setActivity({ active, revision: activity.revision + (active ? 1 : 0) });
  }
  const [history, setHistory] = useState([props.taskId]);
  const taskId = history[history.length - 1]!;
  return (
    <View style={{ flex: 1, display: active ? "flex" : "none" }}>
      <TaskContent
        {...props}
        key={taskId}
        refreshKey={activity.revision}
        taskId={taskId}
        initialAction={history.length === 1 ? props.initialAction : undefined}
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
    </View>
  );
}
function TaskContent({
  initialAction,
  crewId,
  taskId,
  generation,
  userId,
  onClose,
  onOpenWeb,
  onOpenTask,
  backToTask,
  closeLabel,
  refreshKey = 0,
}: Props & {
  onOpenTask: (id: string) => void;
  backToTask: boolean;
  refreshKey: number;
}) {
  const t = useTranslations(),
    locale = useLocale();
  const [editing, setEditing] = useState(initialAction === "edit");
  const [managing, setManaging] = useState(initialAction === "edit");
  const [inviting, setInviting] = useState(initialAction === "invite");
  const [recruiting, setRecruiting] = useState(initialAction === "recruit");
  const [creatingChild, setCreatingChild] = useState<Detail>();
  const [revision, setRevision] = useState(0);
  const scheduleSession = useTaskScheduleSession(taskId, generation, () =>
    setRevision((v) => v + 1)
  );
  const planningSession = useTaskPlanningSession(taskId, generation, () =>
    setRevision((v) => v + 1)
  );
  const workflowSession = useTaskWorkflowSession(taskId, generation, () =>
    setRevision((v) => v + 1)
  );
  const assignmentSession = useTaskAssignmentSession(taskId, generation, () =>
    setRevision((v) => v + 1)
  );
  const customFieldSession = useTaskCustomFieldSession(taskId, generation, () =>
    setRevision((v) => v + 1)
  );
  const relationshipSession = useTaskRelationshipSession(taskId, generation, () =>
    setRevision((v) => v + 1)
  );
  const deliverySession = useTaskDeliverySession(taskId, generation, () =>
    setRevision((v) => v + 1)
  );
  const submitSession = useTaskSubmitSession(taskId, generation, () => setRevision((v) => v + 1));
  const reviewSession = useTaskReviewSession(taskId, generation, () => setRevision((v) => v + 1));
  const briefSession = useTaskBriefSession(taskId, generation, () => setRevision((v) => v + 1));
  const [result, setResult] = useState<{
    revision: number;
    refreshKey: number;
    data?: Detail;
    error?: string;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskDetail(crewId, taskId, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setResult({ revision, refreshKey, data });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setResult({
            revision,
            refreshKey,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      }
    );
    return () => controller.abort();
  }, [crewId, taskId, generation, revision, refreshKey]);
  const current =
    result?.revision === revision && result.refreshKey === refreshKey ? result : undefined;
  const data = current?.data;
  const displays = useUserDisplays(String(generation), data?.assignees.map((a) => a.userId) ?? []);
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale) : t("thread.taskUnset");
  if (recruiting && data)
    return (
      <PositionCreate
        crewId={crewId}
        userId={userId}
        generation={generation}
        initialTask={data}
        onClose={() => setRecruiting(false)}
      />
    );
  return (
    <>
      {editing && (
        <TaskEdit
          key={`${taskId}:${generation}`}
          crewId={crewId}
          taskId={taskId}
          userId={userId}
          generation={generation}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setRevision((v) => v + 1);
          }}
        />
      )}
      <TaskSubmissionUpload
        session={submitSession}
        crewId={crewId}
        userId={userId}
        generation={generation}
      />
      {creatingChild && (
        <TaskChildCreate
          task={creatingChild}
          userId={userId}
          generation={generation}
          onCreated={(id) => {
            if (generation === getAuthGeneration()) {
              setCreatingChild(undefined);
              onOpenTask(id);
            }
          }}
          onClose={() => {
            setCreatingChild(undefined);
            setRevision((value) => value + 1);
          }}
        />
      )}
      <ScrollView
        style={creatingChild || editing ? { display: "none" } : undefined}
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
        {data && !creatingChild && (
          <>
            <ThemedText type="smallBold">
              TASK-{data.number} · {data.title}
            </ThemedText>
            <TaskManagementMenu
              task={data}
              userId={userId}
              generation={generation}
              edit={() => {
                setManaging(true);
                setEditing(true);
              }}
              invite={() => setInviting((v) => !v)}
              recruit={() => setRecruiting(true)}
            />
            {inviting && (
              <TaskInviteLinks
                task={data}
                userId={userId}
                generation={generation}
                initiallyOpen
                onClose={() => setInviting(false)}
              />
            )}
            {managing && (
              <Pressable onPress={() => setManaging(false)}>
                <ThemedText>{t("agent.close")}</ThemedText>
              </Pressable>
            )}
            <ThemedText>
              {t("thread.taskState")}: {taskWorkflowLabel(data.workflowState, t)}
            </ThemedText>
            <ThemedText>{data.description || t("thread.taskNoDescription")}</ThemedText>
            {managing && (
              <>
                <TaskContractFiles
                  crewId={crewId}
                  userId={userId}
                  generation={generation}
                  taskId={data.id}
                />
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
                  <ThemedText key={a.userId}>
                    {displays?.get(a.userId)?.nickname || a.userId}
                  </ThemedText>
                ))}
                <View>
                  {data.labels.map((label) => (
                    <ThemedText key={label.id}>{label.name}</ThemedText>
                  ))}
                </View>
                <ThemedText>
                  {t("taskSchedule.priority")}: {t(`taskSchedule.${data.priority}`)}
                </ThemedText>
                {!!data.requiredSkills?.length && (
                  <ThemedText>
                    {t("crewSkills.label")}: {data.requiredSkills.join(", ")}
                  </ThemedText>
                )}
                {!!data.positionRole && (
                  <ThemedText>
                    {t("taskPlanning.positionRole")}: {data.positionRole}
                  </ThemedText>
                )}
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
                  session={scheduleSession}
                  key={`schedule:${revision}`}
                  task={data}
                  userId={userId}
                  generation={generation}
                  onRefresh={() => setRevision((v) => v + 1)}
                />
                <TaskAssignments
                  session={assignmentSession}
                  key={`assignments:${revision}`}
                  task={data}
                  userId={userId}
                  generation={generation}
                  onRefresh={() => setRevision((value) => value + 1)}
                />
                <TaskWorkflowEditor
                  session={workflowSession}
                  key={`workflow:${revision}`}
                  task={data}
                  userId={userId}
                  generation={generation}
                  onRefresh={() => setRevision((n) => n + 1)}
                />
                <TaskPlanningEditor
                  session={planningSession}
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
                  session={relationshipSession}
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
                  onOpen={() => setCreatingChild(data)}
                />
                <TaskCustomFields
                  session={customFieldSession}
                  key={`fields:${revision}`}
                  task={data}
                  generation={generation}
                  userId={userId}
                  onRefresh={() => setRevision((v) => v + 1)}
                />
                <TaskRelations task={data} onOpenTask={onOpenTask} />
                <TaskDeliveryManagement
                  session={deliverySession}
                  task={data}
                  generation={generation}
                  userId={userId}
                  onRefresh={() => setRevision((v) => v + 1)}
                />
              </>
            )}
            <TaskDelivery
              key={`delivery:${revision}`}
              taskId={taskId}
              generation={generation}
              submissions={data.submissions}
            />
            <TaskSubmit
              uploadHosted
              session={submitSession}
              key={`submit:${revision}`}
              task={data}
              userId={userId}
              generation={generation}
              onRefresh={() => setRevision((v) => v + 1)}
            />
            <TaskReview
              session={reviewSession}
              key={`review:${revision}`}
              task={data}
              userId={userId}
              generation={generation}
              onRefresh={() => setRevision((v) => v + 1)}
            />
            <TaskCaseCreate
              crewId={crewId}
              taskId={taskId}
              userId={userId}
              generation={generation}
            />
            <TaskFeedbackCreate task={data} userId={userId} generation={generation} />
            {managing && (
              <TaskCommitments
                key={revision}
                task={data}
                userId={userId}
                generation={generation}
                onRefresh={() => setRevision((v) => v + 1)}
              />
            )}
          </>
        )}
        <TaskTimeline
          suspended={!data || !!creatingChild || !managing || editing}
          crewId={crewId}
          taskId={taskId}
          userId={userId}
          generation={generation}
        />
        {data && !creatingChild && (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpenWeb(taskId)}
            style={{ padding: 12 }}
          >
            <ThemedText>{t("thread.taskOpenWorkspace")}</ThemedText>
          </Pressable>
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
    </>
  );
}
