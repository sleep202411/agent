import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  useTaskAssignmentSession,
  parseAssignmentDraft,
  type TaskAssignmentSession,
} from "./use-task-assignment-session";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  fetchTaskAssignments,
  taskRewardText,
  type AssignmentSnapshot,
} from "./task-assignment-api";
import { appEnv } from "@/config";
import { SafeAreaView } from "react-native-safe-area-context";
import { TaskMentionPicker } from "./task-mention-picker";
import { useUserDisplays } from "./user-displays";
import type { TaskDetail } from "./task-detail-api";
type Props = {
  task: TaskDetail;
  userId: string;
  generation: number;
  onRefresh: () => void;
  session?: TaskAssignmentSession;
};
export function TaskAssignments(props: Props) {
  if (props.session) return <AssignmentAccess {...props} session={props.session} />;
  return <LocalAssignments key={`${props.task.id}:${props.generation}`} {...props} />;
}
function LocalAssignments(props: Props) {
  const session = useTaskAssignmentSession(props.task.id, props.generation, props.onRefresh);
  return <AssignmentAccess {...props} session={session} />;
}
function AssignmentAccess(props: Props & { session: TaskAssignmentSession }) {
  if (["approved", "cancelled"].includes(props.task.status)) return null;
  return <Access key={`${props.task.id}:${props.task.version}:${props.generation}`} {...props} />;
}
function Access({
  task,
  userId,
  generation,
  onRefresh,
  session,
}: Props & { session: TaskAssignmentSession }) {
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
          <ThemedText>{t("taskAssignments.edit")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

function LoadEditor(props: Omit<Props, "userId"> & { session: TaskAssignmentSession }) {
  const t = useTranslations();
  const initialize = props.session.initialize;
  const [snapshot, setSnapshot] = useState<AssignmentSnapshot>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskAssignments(props.task, controller.signal).then(
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
  snapshot: AssignmentSnapshot;
  generation: number;
  onRefresh: () => void;
  session: TaskAssignmentSession;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const regionalCurrency = appEnv.siteRegion === "cn" ? "CNY" : "USD";
  const state = session.draft!,
    draft = state.rows,
    error = state.error;
  const [picker, setPicker] = useState(false);
  const locked = session.busy || !!state.attemptedAt;
  const stale = snapshot.version !== state.snapshot.version;
  const canReview =
    !session.busy && (stale || (!!state.attemptedAt && snapshot !== state.attemptedAt));
  const displays = useUserDisplays(String(generation), [
    ...new Set([...draft.map((a) => a.userId), ...snapshot.assignees.map((a) => a.userId)]),
  ]);
  const input = parseAssignmentDraft(state);
  const changed =
    input &&
    (input.assignees.length !== state.snapshot.assignees.length ||
      input.assignees.some(
        (a) =>
          !state.snapshot.assignees.some(
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
              session.change((current) =>
                current.map((item) => (item.userId === a.userId ? { ...item, reward } : item))
              )
            }
            style={{ color: theme.text, padding: 12 }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            onPress={() =>
              session.change((current) => current.filter((item) => item.userId !== a.userId))
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
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {(error || stale) && (
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
          <ThemedText>{t("taskAssignments.latest")}</ThemedText>
          {snapshot.assignees.length ? (
            snapshot.assignees.map((a) => (
              <ThemedText key={a.userId}>
                {label(a.userId)} · {a.currency} ·{" "}
                {taskRewardText(a.rewardAmountMinor) || t("thread.taskUnset")}
              </ThemedText>
            ))
          ) : (
            <ThemedText>{t("thread.taskUnset")}</ThemedText>
          )}
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
        disabled={!input || !changed || locked || stale}
        style={{ padding: 12, opacity: !input || !changed || locked || stale ? 0.45 : 1 }}
        onPress={() => {
          if (input && changed && !locked && !stale) session.save(snapshot);
        }}
      >
        <ThemedText>{t("taskBrief.save")}</ThemedText>
      </Pressable>
      {session.busy && <ActivityIndicator />}
      <Pressable
        accessibilityRole="button"
        disabled={session.busy}
        onPress={session.cancel}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      <Modal
        visible={picker && !locked}
        animationType="slide"
        onRequestClose={() => setPicker(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          {picker && !locked && (
            <TaskMentionPicker
              crewId={snapshot.crewId}
              userId=""
              includeSelf
              generation={generation}
              title={t("taskCreate.assignees")}
              excludedIds={draft.map((a) => a.userId)}
              onClose={() => setPicker(false)}
              onSelect={(member) => {
                if (generation !== getAuthGeneration() || locked) return;
                session.change((current) =>
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
