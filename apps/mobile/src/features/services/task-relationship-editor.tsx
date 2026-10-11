import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TaskPicker } from "./task-picker";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  useTaskRelationshipSession,
  type TaskRelationshipSession,
} from "./use-task-relationship-session";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import type { TaskDetail } from "./task-detail-api";
type Props = {
  task: TaskDetail;
  userId: string;
  generation: number;
  onRefresh: () => void;
  session?: TaskRelationshipSession;
};
export function TaskRelationshipEditor(props: Props) {
  if (props.session) return <RelationshipAccess {...props} session={props.session} />;
  return <LocalRelationships key={`${props.task.id}:${props.generation}`} {...props} />;
}
function LocalRelationships(props: Props) {
  const session = useTaskRelationshipSession(props.task.id, props.generation, props.onRefresh);
  return <RelationshipAccess {...props} session={session} />;
}
type ActiveProps = Props & { session: TaskRelationshipSession };
function RelationshipAccess(props: ActiveProps) {
  if (["approved", "cancelled"].includes(props.task.status)) return null;
  return <Access key={`${props.task.id}:${props.task.version}:${props.generation}`} {...props} />;
}
function Access({ task, userId, generation, onRefresh, session }: ActiveProps) {
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
  if (session.draft && allowed)
    return <Editor task={task} generation={generation} onRefresh={onRefresh} session={session} />;
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
            if (generation === getAuthGeneration()) session.open(task);
          }}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("taskRelationships.edit")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
function Editor({ task, generation, onRefresh, session }: Omit<ActiveProps, "userId">) {
  const t = useTranslations(),
    theme = useTheme();
  const { snapshot, parent, blockers, error, attemptedAt } = session.draft!;
  const [picker, setPicker] = useState<"parent" | "blocker">();
  const locked = session.busy || !!attemptedAt;
  const stale = task.version !== snapshot.version;
  const canReview = !session.busy && (stale || (!!attemptedAt && task !== attemptedAt));
  const changed =
    (parent?.id ?? null) !== (snapshot.parent?.id ?? null) ||
    blockers.length !== snapshot.blockedBy.length ||
    blockers.some((item) => !snapshot.blockedBy.some((old) => old.id === item.id));
  const canSave = changed && !locked && !stale;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("taskRelationships.edit")}</ThemedText>
      <ThemedText>{t("taskRelations.parentTask")}</ThemedText>
      {parent && (
        <ThemedText>
          TASK-{parent.number} · {parent.title}
        </ThemedText>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={locked}
        onPress={() => setPicker("parent")}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("taskRelationships.chooseParent")}</ThemedText>
      </Pressable>
      {parent && (
        <Pressable
          accessibilityRole="button"
          disabled={locked}
          onPress={() => session.change((draft) => ({ parent: null, blockers: draft.blockers }))}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("taskRelationships.removeParent")}</ThemedText>
        </Pressable>
      )}
      <ThemedText>
        {t("taskRelations.blockedBy")} · {blockers.length}/50
      </ThemedText>
      {blockers.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          disabled={locked}
          accessibilityLabel={`${t("taskRelationships.removeBlocker")} TASK-${item.number} ${item.title}`}
          onPress={() =>
            session.change((draft) => ({
              parent: draft.parent,
              blockers: draft.blockers.filter((b) => b.id !== item.id),
            }))
          }
          style={{ padding: 12 }}
        >
          <ThemedText>
            TASK-{item.number} · {item.title} ×
          </ThemedText>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={locked || blockers.length >= 50}
        onPress={() => setPicker("blocker")}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("taskRelationships.addBlocker")}</ThemedText>
      </Pressable>
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
          <ThemedText>{t("taskRelationships.latest")}</ThemedText>
          <ThemedText>
            {t("taskRelations.parentTask")}:{" "}
            {task.parent
              ? `TASK-${task.parent.number} · ${task.parent.title}`
              : t("thread.taskUnset")}
          </ThemedText>
          <ThemedText>
            {t("taskRelations.blockedBy")} · {task.blockedBy.length}
          </ThemedText>
          {task.blockedBy.map((item) => (
            <ThemedText key={item.id}>
              TASK-{item.number} · {item.title}
            </ThemedText>
          ))}
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => session.review(task)}
          >
            <ThemedText>{t("taskBrief.reviewLatest")}</ThemedText>
          </Pressable>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={!canSave}
        style={{ padding: 12, opacity: canSave ? 1 : 0.45 }}
        onPress={() => {
          if (canSave) session.save(task);
        }}
      >
        <ThemedText>{t("taskRelationships.save")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={session.busy}
        onPress={session.cancel}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      {session.busy && <ActivityIndicator />}
      <Modal
        visible={!!picker && !locked}
        animationType="slide"
        onRequestClose={() => setPicker(undefined)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          {picker && !locked && (
            <TaskPicker
              closeLabel={t("myServices.cancel")}
              crewId={task.crewId}
              generation={generation}
              title={t(
                picker === "parent"
                  ? "taskRelationships.chooseParent"
                  : "taskRelationships.addBlocker"
              )}
              excludedIds={[task.id, ...(picker === "blocker" ? blockers.map((b) => b.id) : [])]}
              onClose={() => setPicker(undefined)}
              onSelect={(item) => {
                if (generation !== getAuthGeneration() || locked || item.id === task.id) return;
                session.change((draft) => ({
                  parent: picker === "parent" ? item : draft.parent,
                  blockers:
                    picker === "blocker" &&
                    !draft.blockers.some((b) => b.id === item.id) &&
                    draft.blockers.length < 50
                      ? [...draft.blockers, item]
                      : draft.blockers,
                }));
                setPicker(undefined);
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
