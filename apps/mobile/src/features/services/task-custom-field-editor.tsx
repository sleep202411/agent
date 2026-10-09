import { TaskCustomFieldControl } from "./task-custom-field-control";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  useTaskCustomFieldSession,
  type TaskCustomFieldSession,
  type FieldSnapshot,
} from "./use-task-custom-field-session";
import { customFieldText } from "./task-custom-fields-api";
import { useUserDisplays } from "./user-displays";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  fetchTaskCustomFields,
  type CustomField,
  type CustomValue,
} from "./task-custom-fields-api";
import { normalizeCustomValue } from "./task-custom-field-edit-api";
import type { TaskDetail } from "./task-detail-api";
type Props = {
  task: TaskDetail;
  userId: string;
  generation: number;
  fields: CustomField[];
  onRefresh: () => void;
  session?: TaskCustomFieldSession;
};
export function TaskCustomFieldEditing(props: Props) {
  if (props.session) return <FieldAccess {...props} session={props.session} />;
  return <LocalFields key={`${props.task.id}:${props.generation}`} {...props} />;
}
function LocalFields(props: Props) {
  const session = useTaskCustomFieldSession(props.task.id, props.generation, props.onRefresh);
  return <FieldAccess {...props} session={session} />;
}
type ActiveProps = Props & { session: TaskCustomFieldSession };
function FieldAccess(props: ActiveProps) {
  if (["approved", "cancelled"].includes(props.task.status)) return null;
  return <Access key={`${props.task.id}:${props.task.version}:${props.generation}`} {...props} />;
}
function Access(props: ActiveProps) {
  const t = useTranslations();
  const [allowed, setAllowed] = useState(false),
    [error, setError] = useState<string>();
  const selected = props.session.selected;
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskCommentAccess(props.task.crewId, props.userId, controller.signal).then(
      (a) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setAllowed(a.canManage);
      },
      (e) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => controller.abort();
  }, [props.task.crewId, props.userId, props.generation]);
  if (selected && allowed)
    return <LoadEditor {...props} fieldId={selected} onCancel={props.session.cancel} />;
  return (
    <View style={{ gap: 8 }}>
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={props.onRefresh}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
        </>
      )}
      {allowed &&
        props.fields.map((f) => (
          <Pressable
            key={f.id}
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => {
              if (props.generation === getAuthGeneration()) props.session.open(f.id);
            }}
          >
            <ThemedText>
              {t("taskCustomFields.edit")} · {f.name}
            </ThemedText>
          </Pressable>
        ))}
    </View>
  );
}
function LoadEditor(props: ActiveProps & { fieldId: string; onCancel: () => void }) {
  const t = useTranslations();
  const [row, setRow] = useState<{ field: CustomField; value: CustomValue | undefined }>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskCustomFields(props.task, controller.signal).then(
      (rows) => {
        if (controller.signal.aborted || props.generation !== getAuthGeneration()) return;
        const found = rows.find((r) => r.field.id === props.fieldId);
        if (found) setRow(found);
        else setError("Custom field no longer exists. Refresh the task.");
      },
      (e) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => controller.abort();
  }, [props.task, props.fieldId, props.generation]);
  const snapshot = useMemo(
    () => row && { task: props.task, field: row.field, value: row.value ?? null },
    [row, props.task]
  );
  const initialize = props.session.initialize;
  useEffect(() => {
    if (snapshot) initialize(snapshot);
  }, [snapshot, initialize]);
  if (snapshot && props.session.draft) return <Editor {...props} snapshot={snapshot} />;
  return (
    <View>
      {!error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable accessibilityRole="button" onPress={error ? props.onRefresh : props.onCancel}>
        <ThemedText>{t(error ? "thread.refresh" : "myServices.cancel")}</ThemedText>
      </Pressable>
      {error && (
        <Pressable
          accessibilityRole="button"
          disabled={props.session.busy}
          onPress={props.onCancel}
        >
          <ThemedText>{t("myServices.cancel")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
function Editor({
  task,
  userId,
  generation,
  onRefresh,
  session,
  snapshot,
}: ActiveProps & { snapshot: FieldSnapshot }) {
  const t = useTranslations();
  const draft = session.draft!;
  const field = draft.snapshot.field;
  const locked = !!draft.attemptedAt || session.busy;
  const stale =
    task.version !== draft.snapshot.task.version ||
    JSON.stringify(snapshot.field) !== JSON.stringify(field);
  const compatible = field.type === snapshot.field.type;
  const canReview =
    compatible &&
    !session.busy &&
    (stale || (!!draft.attemptedAt && snapshot !== draft.attemptedAt));
  const users = useUserDisplays(
    String(generation),
    snapshot.field.type === "user" && typeof snapshot.value === "string" ? [snapshot.value] : []
  );
  let normalized: CustomValue | undefined;
  try {
    normalized = normalizeCustomValue(field, draft.value);
  } catch {
    /* Inline validation below. */
  }
  const invalid = normalized === undefined;
  const canSave =
    !locked &&
    !stale &&
    !invalid &&
    JSON.stringify(normalized) !== JSON.stringify(draft.snapshot.value);
  return (
    <View style={{ gap: 8 }}>
      <TaskCustomFieldControl
        field={field}
        draft={draft.value}
        setDraft={session.change}
        locked={locked}
        crewId={task.crewId}
        userId={userId}
        generation={generation}
      />
      {invalid && (
        <ThemedText accessibilityRole="alert">{t("taskCustomFields.invalid")}</ThemedText>
      )}
      {draft.error && <ThemedText accessibilityRole="alert">{draft.error}</ThemedText>}
      {(stale || draft.error) && (
        <Pressable
          accessibilityRole="button"
          disabled={session.busy}
          onPress={onRefresh}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("thread.refresh")}</ThemedText>
        </Pressable>
      )}
      {stale && !compatible && (
        <ThemedText accessibilityRole="alert">{t("taskCustomFields.typeChanged")}</ThemedText>
      )}
      {canReview && (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("taskCustomFields.latest")}</ThemedText>
          <ThemedText>
            {snapshot.field.name}:{" "}
            {customFieldText(
              snapshot.field,
              snapshot.value,
              {
                unset: t("thread.taskUnset"),
                yes: t("taskCustomFields.yes"),
                no: t("taskCustomFields.no"),
              },
              users
            )}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => session.review(snapshot)}
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
          if (canSave) session.save(snapshot);
        }}
      >
        <ThemedText>{t("taskBrief.save")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={session.busy}
        style={{ padding: 12, opacity: session.busy ? 0.45 : 1 }}
        onPress={session.cancel}
      >
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      {session.busy && <ActivityIndicator />}
    </View>
  );
}
