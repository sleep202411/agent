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
import { TaskWorkflowField } from "./task-workflow-field";
import type { TaskWorkflow } from "./task-workflow-api";
import { TaskCreationRelations } from "./task-creation-relations";
import type { TaskOption } from "./task-options";
import type { TaskMention } from "./task-mentions";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  onCreated: (id: string) => void;
  onClose: () => void;
};
export function TaskCreate(props: Props) {
  const t = useTranslations();
  const [allowed, setAllowed] = useState<boolean>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskCommentAccess(props.crewId, props.userId, controller.signal).then(
      (access) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setAllowed(access.canManage);
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [props.crewId, props.userId, props.generation]);
  if (allowed) return <Editor {...props} />;
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {allowed === undefined && !error && <ActivityIndicator />}
      {(error || allowed === false) && (
        <ThemedText accessibilityRole="alert">{error ?? t("taskCreate.managerOnly")}</ThemedText>
      )}
      <Pressable accessibilityRole="button" onPress={props.onClose}>
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Editor({ crewId, userId, generation, onCreated, onClose }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(crewId, true);
  const [planning, setPlanning] = useState<TaskPlanningDraft>({
    labels: [],
    cycle: null,
    episode: null,
  });
  const [workflow, setWorkflow] = useState<TaskWorkflow | null>(null);
  const [parent, setParent] = useState<TaskOption | null>(null);
  const [blockers, setBlockers] = useState<TaskOption[]>([]);
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
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
    input = taskCreateInput.parse({
      title,
      description,
      priority,
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
        <ThemedText>{t("taskCreate.submit")}</ThemedText>
      </Pressable>
      {op.busy && <ActivityIndicator />}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        onPress={onClose}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("crewTasks.back")}</ThemedText>
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
