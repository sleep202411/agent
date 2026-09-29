import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  fetchTaskCustomFields,
  customFieldText,
  type CustomField,
  type CustomValue,
} from "./task-custom-fields-api";
import { normalizeCustomValue, updateCustomField } from "./task-custom-field-edit-api";
import { TaskMentionPicker } from "./task-mention-picker";
import { useUserDisplays } from "./user-displays";
import type { TaskDetail } from "./task-detail-api";
type Props = {
  task: TaskDetail;
  userId: string;
  generation: number;
  fields: CustomField[];
  onRefresh: () => void;
};
export function TaskCustomFieldEditing(props: Props) {
  if (["approved", "cancelled"].includes(props.task.status) || !props.fields.length) return null;
  return <Access key={`${props.task.id}:${props.task.version}:${props.generation}`} {...props} />;
}
function Access(props: Props) {
  const t = useTranslations();
  const [allowed, setAllowed] = useState(false),
    [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
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
    return <LoadEditor {...props} fieldId={selected} onCancel={() => setSelected(undefined)} />;
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
              if (props.generation === getAuthGeneration()) setSelected(f.id);
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
function LoadEditor(props: Props & { fieldId: string; onCancel: () => void }) {
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
  if (row) return <Editor {...props} field={row.field} value={row.value ?? null} />;
  return (
    <View>
      {!error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable accessibilityRole="button" onPress={error ? props.onRefresh : props.onCancel}>
        <ThemedText>{t(error ? "thread.refresh" : "myServices.cancel")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Editor({
  task,
  userId,
  generation,
  field,
  value,
  onRefresh,
  onCancel,
}: Props & { field: CustomField; value: CustomValue; onCancel: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(task.id, true);
  const [draft, setDraft] = useState<CustomValue>(value),
    [picker, setPicker] = useState(false),
    [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false);
  const attemptedRef = useRef(false),
    locked = attempted || op.busy;
  const users = useUserDisplays(
    String(generation),
    field.type === "user" && typeof draft === "string" ? [draft] : []
  );
  let normalized: CustomValue | undefined;
  try {
    normalized = normalizeCustomValue(field, draft);
  } catch {
    /* Validation is displayed below. */
  }
  const invalid = normalized === undefined;
  const unchanged = JSON.stringify(normalized) === JSON.stringify(value);
  const options =
    field.type === "checkbox"
      ? [
          { id: "yes", label: t("taskCustomFields.yes"), value: true },
          { id: "no", label: t("taskCustomFields.no"), value: false },
        ]
      : field.options.map((o) => ({ ...o, value: o.id }));
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">
        {field.name}
        {field.required ? " *" : ""}
      </ThemedText>
      {field.type === "text" || field.type === "number" || field.type === "date" ? (
        <TextInput
          accessibilityLabel={field.name}
          value={draft == null ? "" : String(draft)}
          onChangeText={setDraft}
          editable={!locked}
          maxLength={4000}
          keyboardType={field.type === "number" ? "numbers-and-punctuation" : "default"}
          placeholder={field.type === "date" ? "YYYY-MM-DD" : undefined}
          placeholderTextColor={theme.textSecondary}
          style={{ color: theme.text, padding: 12 }}
        />
      ) : field.type === "user" ? (
        <Pressable
          accessibilityRole="button"
          disabled={locked}
          onPress={() => setPicker(true)}
          style={{ padding: 12 }}
        >
          <ThemedText>
            {customFieldText(
              field,
              draft,
              { unset: t("taskCustomFields.chooseMember"), yes: "", no: "" },
              users
            )}
          </ThemedText>
        </Pressable>
      ) : (
        options.map((o) => {
          const selected = Array.isArray(draft)
            ? draft.includes(String(o.value))
            : draft === o.value;
          return (
            <Pressable
              key={o.id}
              accessibilityRole={field.type === "multi_select" ? "checkbox" : "radio"}
              accessibilityState={{ checked: selected, selected }}
              disabled={locked}
              style={{
                padding: 12,
                backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
              }}
              onPress={() =>
                setDraft(
                  field.type === "multi_select"
                    ? selected
                      ? (Array.isArray(draft) ? draft : []).filter((id) => id !== o.id)
                      : [...(Array.isArray(draft) ? draft : []), o.id]
                    : o.value
                )
              }
            >
              <ThemedText>{o.label}</ThemedText>
            </Pressable>
          );
        })
      )}
      {!field.required && (
        <Pressable accessibilityRole="button" disabled={locked} onPress={() => setDraft(null)}>
          <ThemedText>{t("taskCustomFields.clear")}</ThemedText>
        </Pressable>
      )}
      {invalid && (
        <ThemedText accessibilityRole="alert">{t("taskCustomFields.invalid")}</ThemedText>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        disabled={locked || invalid || unchanged}
        style={{ padding: 12 }}
        onPress={() => {
          if (
            locked ||
            attemptedRef.current ||
            invalid ||
            unchanged ||
            generation !== getAuthGeneration()
          )
            return;
          void op.run(
            () => {
              attemptedRef.current = true;
              setAttempted(true);
              return updateCustomField(task, field, draft);
            },
            onRefresh,
            (e) => setError(e instanceof Error ? e.message : String(e))
          );
        }}
      >
        <ThemedText>{t("taskPlanning.save")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        onPress={attempted ? onRefresh : onCancel}
      >
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      {op.busy && <ActivityIndicator />}
      <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          <TaskMentionPicker
            crewId={task.crewId}
            userId={userId}
            generation={generation}
            excludedIds={[]}
            includeSelf
            title={field.name}
            onClose={() => setPicker(false)}
            onSelect={(member) => {
              if (generation === getAuthGeneration() && !locked) {
                setDraft(member.userId);
                setPicker(false);
              }
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
