import { uuid } from "expo-modules-core";
import { isTaskRequestReceipt, type TaskRequestReceipt } from "./task-request-receipt";
import type { TaskPaymentTerms } from "@repo/shared/crew";
import { TaskContractField } from "./task-contract-field";
import { CrewSkillsField } from "./crew-skills-field";
import { TaskCreationRequiredError } from "./task-creation-required";
import { taskWorkflowLabel } from "./task-workflow-label";
import { restoreTaskDraftEditor } from "./task-draft-editor-context";
import { TaskCrewContext } from "./task-crew-context";
import { assertTaskCreationDeadline, TaskCreationDeadlineError } from "./task-creation-deadline";
import { TaskCompensationFields } from "./task-compensation-fields";
import { compensationText, parseCompensation } from "./task-compensation";
import { fetchTaskCreationDefaults, type TaskCreationDefaults } from "./task-creation-defaults";
import type { TaskDraftInput, TaskDraftReview, TaskDraft } from "./task-draft-session";
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
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { createTask, taskCreateInput } from "./task-create-api";
import { parseScheduleDate, scheduleDateText } from "./task-schedule-api";
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
  initialDraft?: Extract<TaskDraft, { kind: "task" }>;
  initialParent?: TaskOption;
  initialWorkflow?: TaskWorkflow;
  closeLabel?: string;
  suspended?: boolean;
  onSave?: (input: TaskDraftInput) => Promise<{ id: string }>;
  onStage?: (input: TaskDraftInput, review: TaskDraftReview) => void;
  onCreated: (id: string) => void;
  onClose: () => void;
};
export function TaskCreate(props: Props) {
  if (props.generation !== getAuthGeneration()) return null;
  return (
    <Access
      key={`${props.crewId}:${props.userId}:${props.generation}:${props.initialDraft?.id ?? "new"}:${props.viewId ?? ""}:${props.initialWorkflow?.id ?? ""}:${props.initialParent?.id ?? ""}`}
      {...props}
    />
  );
}
function Access(props: Props) {
  const active = useScreenActive();
  const t = useTranslations();
  const [restoredDraft, setRestoredDraft] = useState<Props["initialDraft"]>();
  const [retry, setRetry] = useState(0);
  const [defaults, setDefaults] = useState<TaskCreationDefaults>();
  const [allowed, setAllowed] = useState<boolean>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const access = await fetchTaskCommentAccess(props.crewId, props.userId, controller.signal);
      if (controller.signal.aborted || props.generation !== getAuthGeneration()) return;
      if (!(props.onSave ? access.canManage : access.canSubmit)) {
        setAllowed(false);
        return;
      }
      const context = await fetchTaskCreationDefaults(
        props.crewId,
        props.viewId,
        props.initialDraft?.input.workflowStateId ?? props.initialWorkflow?.id,
        controller.signal
      );
      if (controller.signal.aborted || props.generation !== getAuthGeneration()) return;
      const draft = props.initialDraft;
      const restored = draft
        ? {
            ...draft,
            review: {
              ...draft.review,
              editor: await restoreTaskDraftEditor(props.crewId, draft, controller.signal),
            },
          }
        : undefined;
      if (controller.signal.aborted || props.generation !== getAuthGeneration()) return;
      setRestoredDraft(restored);
      setDefaults(context);
      setAllowed(true);
    })().then(undefined, (cause) => {
      if (!controller.signal.aborted && props.generation === getAuthGeneration())
        setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [
    props.crewId,
    props.userId,
    props.generation,
    props.viewId,
    props.initialWorkflow?.id,
    props.initialDraft,
    props.onSave,
    retry,
  ]);
  if (allowed && defaults)
    return <Editor {...props} initialDraft={restoredDraft} defaults={defaults} />;
  if (!active) return null;
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {allowed === undefined && !error && <ActivityIndicator />}
      {(error || allowed === false) && (
        <ThemedText accessibilityRole="alert">{error ?? t("taskCreate.managerOnly")}</ThemedText>
      )}
      {error && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setError(undefined);
            setRetry((value) => value + 1);
          }}
        >
          <ThemedText>{t("inbox.retry")}</ThemedText>
        </Pressable>
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
  initialDraft,
  defaults,
  closeLabel,
  suspended,
  onCreated,
  onStage,
  onSave,
  onClose,
}: Props & { defaults: TaskCreationDefaults }) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(crewId, true);
  const initial = initialDraft?.input,
    editor = initialDraft?.review.editor;
  const custom = useTaskCreationCustomFields(crewId, generation, initial?.customFieldValues);
  const [contractAssetNodeId, setContractAssetNodeId] = useState(
    initial?.contractAssetNodeId ?? null
  );
  const [requiredSkills, setRequiredSkills] = useState(initial?.requiredSkills ?? []);
  const [positionRole, setPositionRole] = useState(initial?.positionRole ?? "");
  const [taskKind, setTaskKind] = useState<TaskKind | null>(initial?.taskKind ?? null);
  const [planning, setPlanning] = useState<TaskPlanningDraft>(
    editor?.planning ?? {
      labels: [],
      cycle: defaults.cycle,
      episode: null,
    }
  );
  const [workflow, setWorkflow] = useState<TaskWorkflow | null>(
    editor ? editor.workflow : defaults.workflow
  );
  const [parent, setParent] = useState<TaskOption | null>(
    editor ? editor.parent : (initialParent ?? null)
  );
  const [blockers, setBlockers] = useState<TaskOption[]>(editor?.blockers ?? []);
  const [title, setTitle] = useState(initial?.title ?? ""),
    [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">(
    initial?.priority ?? "normal"
  );
  const [paymentTerms, setPaymentTerms] = useState<TaskPaymentTerms | null>(
    initial?.paymentTerms ?? "on_completion"
  );
  const [reward, setReward] = useState(compensationText(initial?.rewardUsdMinor));
  const [share, setShare] = useState(compensationText(initial?.profitShareBps));
  const [computePoints, setComputePoints] = useState(
    initial?.computeBudgetPoints?.toString() ?? ""
  );
  const [estimate, setEstimate] = useState(
    initial?.estimatePoints == null ? "" : String(initial.estimatePoints)
  );
  const [revisionLimit, setRevisionLimit] = useState(
    initial?.revisionLimit == null ? "" : String(initial.revisionLimit)
  );
  const [start, setStart] = useState(scheduleDateText(initial?.startAt ?? null)),
    [due, setDue] = useState(scheduleDateText(initial?.dueAt ?? null));
  const [assignees, setAssignees] = useState<TaskMention[]>(
      editor?.assignees ??
        initial?.assignees.map((row, index) => ({
          userId: row.userId,
          label: initialDraft?.review.assignees[index] ?? row.userId,
        })) ??
        []
    ),
    [picker, setPicker] = useState(false);
  const [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false);
  const attemptedRef = useRef(false),
    locked = attempted || op.busy;
  const [validationError, setValidationError] = useState<string>();
  const [approvalStatus, setApprovalStatus] = useState<string>();
  const submissionKey = useRef<string | undefined>(undefined);
  let deadlineInvalid = false;
  let input: ReturnType<typeof taskCreateInput.parse> | undefined;
  try {
    if (!custom.values) throw new Error("Custom fields are not ready");
    input = taskCreateInput.parse({
      customFieldValues: custom.values,
      title,
      description,
      contractAssetNodeId,
      requiredSkills,
      positionRole: positionRole.trim() || null,
      priority,
      taskKind,
      computeBudgetPoints: parsePlanningNumber(computePoints, 2_000_000_000),
      estimatePoints: parsePlanningNumber(estimate, 1_000_000),
      paymentTerms,
      rewardCurrency: appEnv.siteRegion === "cn" ? "CNY" : "USD",
      rewardUsdMinor: parseCompensation(reward, 100_000_000_000),
      profitShareBps: parseCompensation(share, 10_000),
      revisionLimit: parsePlanningNumber(revisionLimit, 100),
      ...(workflow ? { workflowStateId: workflow.id } : {}),
      cycleId: planning.cycle?.id ?? null,
      episodeId: planning.episode?.id ?? null,
      labelIds: planning.labels.map((item) => item.id),
      parentId: parent?.id ?? null,
      blockedByTaskIds: blockers.map((task) => task.id),
      startAt: parseScheduleDate(start, initial?.startAt ?? null),
      dueAt: parseScheduleDate(due, initial?.dueAt ?? null),
      assignees: assignees.map((member) => ({
        userId: member.userId,
        currency:
          initial?.assignees.find((row) => row.userId === member.userId)?.currency ??
          (appEnv.siteRegion === "cn" ? "CNY" : "USD"),
      })),
    });
    if (!onSave || input.dueAt !== initial?.dueAt) assertTaskCreationDeadline(input.dueAt);
  } catch (cause) {
    deadlineInvalid = cause instanceof TaskCreationDeadlineError;
    input = undefined;
  }
  if (!active || suspended) return null;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">{t(onSave ? "taskMenu.edit" : "taskCreate.title")}</ThemedText>
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
      <TaskCrewContext
        crewId={crewId}
        userId={userId}
        generation={generation}
        description={description}
        onChange={setDescription}
        disabled={locked}
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

      <ThemedText>{t("taskMenu.initialComputePoints")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskMenu.initialComputePoints")}
        value={computePoints}
        editable={!locked}
        style={{ color: theme.text, padding: 12 }}
        onChangeText={setComputePoints}
        keyboardType="number-pad"
      />
      <ThemedText>{t("taskMenu.initialComputeHint")}</ThemedText>
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
        showCycle={false}
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
      <TaskCompensationFields
        paymentTerms={paymentTerms}
        onPaymentTerms={setPaymentTerms}
        rewardCurrency={appEnv.siteRegion === "cn" ? "CNY" : "USD"}
        rewardRequired
        reward={reward}
        share={share}
        onReward={setReward}
        onShare={setShare}
        locked={locked}
      />
      <TaskContractField
        crewId={crewId}
        userId={userId}
        generation={generation}
        value={contractAssetNodeId}
        onChange={setContractAssetNodeId}
        locked={locked}
      />
      <CrewSkillsField
        value={requiredSkills}
        onChange={setRequiredSkills}
        generation={generation}
        locked={locked}
      />
      <ThemedText>{t("taskPlanning.positionRole")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskPlanning.positionRole")}
        value={positionRole}
        onChangeText={setPositionRole}
        maxLength={80}
        editable={!locked}
        style={{ color: theme.text, padding: 12 }}
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
        <ThemedText accessibilityRole="alert">
          {t(deadlineInvalid ? "taskCreate.deadlinePast" : "taskCreate.invalid")}
        </ThemedText>
      )}
      {!onSave && <ThemedText>{t("taskApproval.help")}</ThemedText>}
      {approvalStatus && <ThemedText>{approvalStatus}</ThemedText>}
      {validationError && <ThemedText accessibilityRole="alert">{validationError}</ThemedText>}
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
          if (
            !active ||
            suspended ||
            !input ||
            attemptedRef.current ||
            generation !== getAuthGeneration()
          )
            return;
          try {
            if (!onSave || input.dueAt !== initial?.dueAt) assertTaskCreationDeadline(input.dueAt);
          } catch {
            setValidationError(t("taskCreate.deadlinePast"));
            return;
          }
          setValidationError(undefined);
          const data = onSave
            ? input
            : { ...input, submissionKey: (submissionKey.current ??= uuid.v4()) };
          if (onStage) {
            attemptedRef.current = true;
            setAttempted(true);
            onStage(data, {
              editor: { planning, workflow, parent, blockers, assignees },
              context: [
                planning.episode && `${t("taskPlanning.episode")}: ${planning.episode.name}`,
                planning.cycle && `${t("taskPlanning.cycle")}: ${planning.cycle.name}`,
                workflow && `${t("thread.taskState")}: ${taskWorkflowLabel(workflow, t)}`,
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
          void op.run<{ id: string } | TaskRequestReceipt>(
            () => {
              attemptedRef.current = true;
              setAttempted(true);
              return onSave ? onSave(data) : createTask(crewId, data);
            },
            (task) => {
              if (isTaskRequestReceipt(task)) setApprovalStatus(t(`taskApproval.${task.status}`));
              else onCreated(task.id);
            },
            (cause) => {
              if (cause instanceof TaskCreationRequiredError) {
                attemptedRef.current = false;
                setAttempted(false);
                setValidationError(t("taskCreate.requiredFields"));
              } else setError(cause instanceof Error ? cause.message : String(cause));
            }
          );
        }}
      >
        <ThemedText>
          {t(
            onSave
              ? "taskBrief.save"
              : onStage
                ? initialDraft
                  ? "taskWorkbench.saveDraft"
                  : "taskWorkbench.stage"
                : "taskCreate.submit"
          )}
        </ThemedText>
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
