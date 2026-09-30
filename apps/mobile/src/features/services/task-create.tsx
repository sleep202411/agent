import { fetchTaskCreationDefaults, type TaskCreationDefaults } from "./task-creation-defaults";
import type { TaskDraftInput, TaskDraftReview } from "./task-draft-session";
import { TaskCustomFieldControl } from "./task-custom-field-control";
import { useTaskCreationCustomFields } from "./task-creation-custom-fields";
import { parsePlanningNumber } from "./task-planning-number";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { appEnv } from "@/config";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { createTask, taskCreateInput } from "./task-create-api";
import { parseScheduleDate } from "./task-schedule-api";
import { TaskMentionPicker } from "./task-mention-picker";
import { TaskPlanningFields, type TaskPlanningDraft } from "./task-planning-fields";
import { TaskKindField } from "./task-kind-field";
import type { TaskKind } from "./task-kind-api";
import { TaskWorkflowField } from "./task-workflow-field";
import type { TaskWorkflow } from "./task-workflow-api";
import { TaskCreationRelations } from "./task-creation-relations";
import type { TaskOption } from "./task-options";
import type { TaskMention } from "./task-mentions";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  viewId?: string;
  initialParent?: TaskOption;
  initialWorkflow?: TaskWorkflow;
  closeLabel?: string;
  onStage?: (input: TaskDraftInput, review: TaskDraftReview) => void;
  onCreated: (id: string) => void;
  onClose: () => void;
};
export function TaskCreate(props: Props) {
  return (
    <Access
      key={`${props.crewId}:${props.userId}:${props.generation}:${props.viewId ?? ""}:${props.initialWorkflow?.id ?? ""}:${props.initialParent?.id ?? ""}`}
      {...props}
    />
  );
}
function Access(props: Props) {
  const t = useTranslations();
  const [defaults, setDefaults] = useState<TaskCreationDefaults>();
  const [allowed, setAllowed] = useState<boolean>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const access = await fetchTaskCommentAccess(props.crewId, props.userId, controller.signal);
      if (controller.signal.aborted || props.generation !== getAuthGeneration()) return;
      if (!access.canManage) {
        setAllowed(false);
        return;
      }
      const context = await fetchTaskCreationDefaults(
        props.crewId,
        props.viewId,
        props.initialWorkflow?.id,
        controller.signal
      );
      if (controller.signal.aborted || props.generation !== getAuthGeneration()) return;
      setDefaults(context);
      setAllowed(true);
    })().then(undefined, (cause) => {
      if (!controller.signal.aborted && props.generation === getAuthGeneration())
        setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [props.crewId, props.userId, props.generation, props.viewId, props.initialWorkflow?.id]);
  if (allowed && defaults) return <Editor {...props} defaults={defaults} />;
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {allowed === undefined && !error && <ActivityIndicator />}
      {(error || allowed === false) && (
        <ThemedText accessibilityRole="alert">{error ?? t("taskCreate.managerOnly")}</ThemedText>
      )}
      <Pressable accessibilityRole="button" onPress={props.onClose}>
        <ThemedText>{props.closeLabel ?? t("crewTasks.back")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Editor({
  crewId,
  userId,
  generation,
  initialParent,
  defaults,
  closeLabel,
  onCreated,
  onStage,
  onClose,
}: Props & { defaults: TaskCreationDefaults }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(crewId, true);
  const custom = useTaskCreationCustomFields(crewId, generation);
  const [taskKind, setTaskKind] = useState<TaskKind | null>(null);
  const [planning, setPlanning] = useState<TaskPlanningDraft>({
    labels: [],
    cycle: defaults.cycle,
    episode: null,
  });
  const [workflow, setWorkflow] = useState<TaskWorkflow | null>(defaults.workflow);
  const [parent, setParent] = useState<TaskOption | null>(initialParent ?? null);
  const [blockers, setBlockers] = useState<TaskOption[]>([]);
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [estimate, setEstimate] = useState("");
  const [revisionLimit, setRevisionLimit] = useState("");
  const [start, setStart] = useState(""),
    [due, setDue] = useState("");
  const [assignees, setAssignees] = useState<TaskMention[]>([]),
    [picker, setPicker] = useState(false);
  const [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false);
  const attemptedRef = useRef(false),
    locked = attempted || op.busy;
  let input: ReturnType<typeof taskCreateInput.parse> | undefined;
  try {
    if (!custom.values) throw new Error("Custom fields are not ready");
    input = taskCreateInput.parse({
      customFieldValues: custom.values,
      title,
      description,
      priority,
      taskKind,
      estimatePoints: parsePlanningNumber(estimate, 1_000_000),
      revisionLimit: parsePlanningNumber(revisionLimit, 100),
      ...(workflow ? { workflowStateId: workflow.id } : {}),
      cycleId: planning.cycle?.id ?? null,
      episodeId: planning.episode?.id ?? null,
      labelIds: planning.labels.map((item) => item.id),
      parentId: parent?.id ?? null,
      blockedByTaskIds: blockers.map((task) => task.id),
      startAt: parseScheduleDate(start, null),
      dueAt: parseScheduleDate(due, null),
      assignees: assignees.map((member) => ({
        userId: member.userId,
        currency: appEnv.siteRegion === "cn" ? "CNY" : "USD",
      })),
    });
  } catch {
    /* Editable validation state. */
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">{t("taskCreate.title")}</ThemedText>
      <ThemedText>{t("taskBrief.title")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskBrief.title")}
        value={title}
        onChangeText={setTitle}
        maxLength={180}
        editable={!locked}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskBrief.description")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskBrief.description")}
        value={description}
        onChangeText={setDescription}
        maxLength={10000}
        multiline
        editable={!locked}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskSchedule.priority")}</ThemedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {(["low", "normal", "high", "urgent"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: priority === value }}
            disabled={locked}
            onPress={() => setPriority(value)}
            style={{
              padding: 12,
              backgroundColor:
                priority === value ? theme.backgroundSelected : theme.backgroundElement,
            }}
          >
            <ThemedText>{t(`taskSchedule.${value}`)}</ThemedText>
          </Pressable>
        ))}
      </View>
      <ThemedText>
        {t("taskSchedule.localTime")} · {Intl.DateTimeFormat().resolvedOptions().timeZone}
      </ThemedText>
      <ThemedText>{t("thread.taskStart")}</ThemedText>
      <TextInput
        accessibilityLabel={t("thread.taskStart")}
        value={start}
        onChangeText={setStart}
        editable={!locked}
        maxLength={16}
        placeholder="YYYY-MM-DD HH:mm"
        placeholderTextColor={theme.textSecondary}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("thread.taskDue")}</ThemedText>
      <TextInput
        accessibilityLabel={t("thread.taskDue")}
        value={due}
        onChangeText={setDue}
        editable={!locked}
        maxLength={16}
        placeholder="YYYY-MM-DD HH:mm"
        placeholderTextColor={theme.textSecondary}
        style={{ color: theme.text, padding: 12 }}
      />
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
      <ThemedText>{t("taskPlanning.numberHelp")}</ThemedText>
      <TaskKindField
        crewId={crewId}
        generation={generation}
        selected={taskKind}
        locked={locked}
        onSelect={(kind, templateTitle) => {
          setTaskKind(kind);
          if (templateTitle) setTitle((current) => (current.trim() ? current : templateTitle));
        }}
      />
      <TaskWorkflowField
        crewId={crewId}
        generation={generation}
        selected={workflow}
        locked={locked}
        onSelect={setWorkflow}
      />
      <TaskPlanningFields
        crewId={crewId}
        generation={generation}
        value={planning}
        onChange={setPlanning}
        locked={locked}
      />
      {!custom.fields && !custom.error && <ActivityIndicator />}
      {custom.error && (
        <>
          <ThemedText accessibilityRole="alert">{custom.error}</ThemedText>
          <Pressable accessibilityRole="button" disabled={locked} onPress={custom.retry}>
            <ThemedText>{t("inbox.retry")}</ThemedText>
          </Pressable>
        </>
      )}
      {custom.fields?.map((field) => (
        <TaskCustomFieldControl
          key={field.id}
          field={field}
          draft={custom.drafts[field.id] ?? null}
          setDraft={(value) => custom.change(field.id, value)}
          locked={locked}
          crewId={crewId}
          userId={userId}
          generation={generation}
        />
      ))}
      <TaskCreationRelations
        crewId={crewId}
        generation={generation}
        parent={parent}
        blockers={blockers}
        locked={locked}
        onParentChange={setParent}
        onBlockersChange={setBlockers}
      />
      <ThemedText>
        {t("taskCreate.assignees")} · {assignees.length}/30
      </ThemedText>
      {assignees.map((member) => (
        <Pressable
          key={member.userId}
          accessibilityRole="button"
          accessibilityLabel={`${t("taskCreate.remove")} ${member.label}`}
          disabled={locked}
          onPress={() =>
            setAssignees((current) => current.filter((a) => a.userId !== member.userId))
          }
          style={{ padding: 12 }}
        >
          <ThemedText>{member.label} ×</ThemedText>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={locked || assignees.length >= 30}
        onPress={() => setPicker(true)}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("taskCreate.add")}</ThemedText>
      </Pressable>
      {!input && title.trim() && (
        <ThemedText accessibilityRole="alert">{t("taskCreate.invalid")}</ThemedText>
      )}
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <ThemedText>{t("taskCreate.uncertain")}</ThemedText>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={!input || locked}
        style={{ padding: 12 }}
        onPress={() => {
          if (!input || attemptedRef.current || generation !== getAuthGeneration()) return;
          const data = input;
          if (onStage) {
            attemptedRef.current = true;
            setAttempted(true);
            onStage(data, {
              context: [
                planning.episode && `${t("taskPlanning.episode")}: ${planning.episode.name}`,
                planning.cycle && `${t("taskPlanning.cycle")}: ${planning.cycle.name}`,
                workflow && `${t("thread.taskState")}: ${workflow.name}`,
                parent && `${t("taskRelations.parentTask")}: ${parent.title}`,
                ...blockers.map((row) => `${t("taskRelations.blockedBy")}: ${row.title}`),
                ...planning.labels.map((row) => `${t("taskPlanning.labels")}: ${row.name}`),
              ].filter((value): value is string => !!value),
              assignees: assignees.map((row) => row.label),
              customFields: (custom.fields ?? []).flatMap((field) => {
                const value = data.customFieldValues?.find(
                  (row) => row.fieldId === field.id
                )?.value;
                return value == null
                  ? []
                  : [`${field.name}: ${Array.isArray(value) ? value.join(", ") : String(value)}`];
              }),
            });
            return;
          }
          void op.run(
            () => {
              attemptedRef.current = true;
              setAttempted(true);
              return createTask(crewId, data);
            },
            (task) => onCreated(task.id),
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
      >
        <ThemedText>{t(onStage ? "taskWorkbench.stage" : "taskCreate.submit")}</ThemedText>
      </Pressable>
      {op.busy && <ActivityIndicator />}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        onPress={onClose}
        style={{ padding: 12 }}
      >
        <ThemedText>{closeLabel ?? t("crewTasks.back")}</ThemedText>
      </Pressable>
      <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          {picker && (
            <TaskMentionPicker
              crewId={crewId}
              userId={userId}
              generation={generation}
              includeSelf
              title={t("taskCreate.assignees")}
              excludedIds={assignees.map((a) => a.userId)}
              onClose={() => setPicker(false)}
              onSelect={(member) => {
                if (generation !== getAuthGeneration() || attemptedRef.current) return;
                setAssignees((current) =>
                  current.length >= 30 || current.some((a) => a.userId === member.userId)
                    ? current
                    : [...current, member]
                );
                setPicker(false);
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
}
