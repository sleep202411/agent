import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  assignmentInput,
  fetchTaskAssignments,
  parseTaskReward,
  taskRewardText,
  updateTaskAssignments,
  type AssignmentSnapshot,
} from "./task-assignment-api";
import { appEnv } from "@/config";
import { SafeAreaView } from "react-native-safe-area-context";
import { TaskMentionPicker } from "./task-mention-picker";
import { useUserDisplays } from "./user-displays";
import type { TaskDetail } from "./task-detail-api";
type Props = { task: TaskDetail; userId: string; generation: number; onRefresh: () => void };
export function TaskAssignments(props: Props) {
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
          <ThemedText>{t("taskAssignments.edit")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

function LoadEditor(props: Omit<Props, "userId"> & { onCancel: () => void }) {
  const t = useTranslations();
  const [snapshot, setSnapshot] = useState<AssignmentSnapshot>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskAssignments(props.task, controller.signal).then(
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
  snapshot: AssignmentSnapshot;
  generation: number;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(snapshot.id, true);
  const regionalCurrency = appEnv.siteRegion === "cn" ? "CNY" : "USD";
  const [draft, setDraft] = useState(() =>
    snapshot.assignees.map((a) => ({
      userId: a.userId,
      currency: a.rewardAmountMinor === null ? regionalCurrency : a.currency,
      reward: taskRewardText(a.rewardAmountMinor),
    }))
  );
  const [picker, setPicker] = useState(false),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const attemptedRef = useRef(false),
    locked = attempted || op.busy;
  const displays = useUserDisplays(
    String(generation),
    draft.map((a) => a.userId)
  );
  let input: ReturnType<typeof assignmentInput.parse> | undefined;
  try {
    input = assignmentInput.parse({
      expectedVersion: snapshot.version,
      assignees: draft.map((a) => ({
        userId: a.userId,
        currency: a.currency,
        rewardAmountMinor: parseTaskReward(a.reward),
      })),
    });
  } catch {
    /* Keep invalid amounts editable. */
  }
  const changed =
    input &&
    (input.assignees.length !== snapshot.assignees.length ||
      input.assignees.some(
        (a) =>
          !snapshot.assignees.some(
            (old) =>
              old.userId === a.userId &&
              old.currency === a.currency &&
              old.rewardAmountMinor === a.rewardAmountMinor
          )
      ));
  const label = (id: string) => displays?.get(id)?.nickname || id;
  return (
    <View style={{ gap: 10 }}>
      <ThemedText type="smallBold">{t("taskAssignments.edit")}</ThemedText>
      {draft.map((a) => (
        <View key={a.userId} style={{ gap: 8 }}>
          <ThemedText>
            {label(a.userId)} · {a.currency}
          </ThemedText>
          <ThemedText>{t("taskAssignments.reward")}</ThemedText>
          <TextInput
            accessibilityLabel={`${t("taskAssignments.reward")} ${label(a.userId)}`}
            value={a.reward}
            keyboardType="decimal-pad"
            editable={!locked}
            maxLength={12}
            onChangeText={(reward) =>
              setDraft((current) =>
                current.map((item) => (item.userId === a.userId ? { ...item, reward } : item))
              )
            }
            style={{ color: theme.text, padding: 12 }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            onPress={() =>
              setDraft((current) => current.filter((item) => item.userId !== a.userId))
            }
            style={{ padding: 12 }}
          >
            <ThemedText>
              {t("taskCreate.remove")} · {label(a.userId)}
            </ThemedText>
          </Pressable>
        </View>
      ))}
      <ThemedText>{t("taskAssignments.help")}</ThemedText>
      <Pressable
        accessibilityRole="button"
        disabled={locked || draft.length >= 30}
        onPress={() => setPicker(true)}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("taskCreate.add")}</ThemedText>
      </Pressable>
      {!input && <ThemedText accessibilityRole="alert">{t("taskAssignments.invalid")}</ThemedText>}
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
        disabled={!input || !changed || locked}
        style={{ padding: 12 }}
        onPress={() => {
          if (!input || !changed || attemptedRef.current || generation !== getAuthGeneration())
            return;
          const data = input;
          void op.run(
            () => {
              attemptedRef.current = true;
              setAttempted(true);
              return updateTaskAssignments(snapshot, data);
            },
            onRefresh,
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
      >
        <ThemedText>{t("taskBrief.save")}</ThemedText>
      </Pressable>
      {op.busy && <ActivityIndicator />}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        onPress={attempted ? onRefresh : onCancel}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          {picker && (
            <TaskMentionPicker
              crewId={snapshot.crewId}
              userId=""
              includeSelf
              generation={generation}
              title={t("taskCreate.assignees")}
              excludedIds={draft.map((a) => a.userId)}
              onClose={() => setPicker(false)}
              onSelect={(member) => {
                if (generation !== getAuthGeneration() || attemptedRef.current) return;
                setDraft((current) =>
                  current.length >= 30 || current.some((a) => a.userId === member.userId)
                    ? current
                    : [
                        ...current,
                        { userId: member.userId, currency: regionalCurrency, reward: "" },
                      ]
                );
                setPicker(false);
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
