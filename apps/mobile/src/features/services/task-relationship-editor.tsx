import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TaskPicker } from "./task-picker";
import type { TaskOption } from "./task-options";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { updateTaskRelationships } from "./task-relationship-api";
import type { TaskDetail } from "./task-detail-api";
type Props = { task: TaskDetail; userId: string; generation: number; onRefresh: () => void };
export function TaskRelationshipEditor(props: Props) {
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
      <Editor
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
          <ThemedText>{t("taskRelationships.edit")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
function Editor({
  task,
  generation,
  onRefresh,
  onCancel,
}: Omit<Props, "userId"> & { onCancel: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(task.id, true);
  // Captured at editor opening; never rebase a draft onto a refreshed server version.
  const [snapshot] = useState(task);
  const [parent, setParent] = useState<TaskOption | null>(task.parent);
  const [blockers, setBlockers] = useState<TaskOption[]>(task.blockedBy);
  const [picker, setPicker] = useState<"parent" | "blocker">();
  const [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false);
  const attemptedRef = useRef(false);
  const locked = op.busy || attempted;
  const changed =
    (parent?.id ?? null) !== (snapshot.parent?.id ?? null) ||
    blockers.length !== snapshot.blockedBy.length ||
    blockers.some((item) => !snapshot.blockedBy.some((old) => old.id === item.id));
  const canSave = changed && !locked;
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
          onPress={() => setParent(null)}
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
          onPress={() => setBlockers((current) => current.filter((b) => b.id !== item.id))}
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
        disabled={!canSave}
        style={{ padding: 12 }}
        onPress={() => {
          if (!canSave || attemptedRef.current || generation !== getAuthGeneration()) return;
          void op.run(
            () => {
              attemptedRef.current = true;
              setAttempted(true);
              return updateTaskRelationships(snapshot, {
                expectedVersion: snapshot.version,
                parentId: parent?.id ?? null,
                blockedByTaskIds: blockers.map((item) => item.id),
              });
            },
            onRefresh,
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
      >
        <ThemedText>{t("taskRelationships.save")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        onPress={attempted ? onRefresh : onCancel}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      {op.busy && <ActivityIndicator />}
      <Modal visible={!!picker} animationType="slide" onRequestClose={() => setPicker(undefined)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          {picker && (
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
                if (
                  generation !== getAuthGeneration() ||
                  attemptedRef.current ||
                  item.id === task.id
                )
                  return;
                if (picker === "parent") setParent(item);
                else
                  setBlockers((current) =>
                    current.some((b) => b.id === item.id) || current.length >= 50
                      ? current
                      : [...current, item]
                  );
                setPicker(undefined);
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
