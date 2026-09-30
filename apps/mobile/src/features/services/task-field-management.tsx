import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  createFieldDefinition,
  updateFieldDefinition,
  deleteFieldDefinition,
  fetchManagedFields,
  fieldOptionsFromLabels,
  fieldDefinitionInput,
  type ManagedField,
  type FieldDefinitionInput,
} from "./task-field-management-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function TaskFieldManagement(props: Props) {
  return <Access key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />;
}
function Access(props: Props) {
  const t = useTranslations();
  const [fields, setFields] = useState<ManagedField[]>(),
    [error, setError] = useState<string>(),
    [attempt, setAttempt] = useState(0),
    [selection, setSelection] = useState<ManagedField | "new">();
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const access = await fetchTaskCommentAccess(props.crewId, props.userId, controller.signal);
      if (!access.canManage) throw new Error(t("taskCreate.managerOnly"));
      if (controller.signal.aborted || props.generation !== getAuthGeneration()) return;
      return fetchManagedFields(props.crewId, controller.signal);
    })().then(
      (value) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setFields(value);
      },
      (e) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => controller.abort();
  }, [props.crewId, props.userId, props.generation, attempt, t]);
  const refresh = () => {
    setSelection(undefined);
    setFields(undefined);
    setError(undefined);
    setAttempt((n) => n + 1);
  };
  if (selection)
    return (
      <Form
        {...props}
        field={selection === "new" ? undefined : selection}
        onCancel={() => setSelection(undefined)}
        onRefresh={refresh}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("taskFields.title")}</ThemedText>
      {!fields && !error && <ActivityIndicator />}
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={refresh}>
            <ThemedText>{t("inbox.retry")}</ThemedText>
          </Pressable>
        </>
      )}
      {fields && (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (props.generation === getAuthGeneration()) setSelection("new");
            }}
          >
            <ThemedText>{t("taskFields.add")}</ThemedText>
          </Pressable>
          {fields.map((field) => (
            <Pressable
              key={field.id}
              accessibilityRole="button"
              style={{ padding: 12 }}
              onPress={() => {
                if (props.generation === getAuthGeneration()) setSelection(field);
              }}
            >
              <ThemedText>
                {field.name} · {t(`taskFields.${field.type}`)}
              </ThemedText>
            </Pressable>
          ))}
        </>
      )}
      <Pressable accessibilityRole="button" onPress={props.onClose}>
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
function Form({
  crewId,
  generation,
  field,
  onCancel,
  onRefresh,
}: Props & { field?: ManagedField; onCancel: () => void; onRefresh: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(crewId, true);
  const [name, setName] = useState(field?.name ?? ""),
    [description, setDescription] = useState(field?.description ?? ""),
    [type, setType] = useState<FieldDefinitionInput["type"]>(field?.type ?? "text"),
    [required, setRequired] = useState(field?.required ?? false),
    [labels, setLabels] = useState(field?.options.map((o) => o.label).join(", ") ?? "");
  const [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false),
    [deleteArmed, setDeleteArmed] = useState(false);
  const attemptedRef = useRef(false);
  const locked = op.busy || attempted;
  const supportsOptions = ["single_select", "multi_select"].includes(type);
  // UUIDs are created once at submission, not while rendering the draft.
  const names = [
    ...new Set(
      labels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
  const valid =
    !!name.trim() &&
    name.trim().length <= 80 &&
    description.trim().length <= 240 &&
    (!supportsOptions || (names.length <= 50 && names.every((s) => s.length <= 80)));
  const actOn = (remove = false) => {
    if (locked || attemptedRef.current || generation !== getAuthGeneration() || (!remove && !valid))
      return;
    void op.run<unknown>(
      () => {
        let input: FieldDefinitionInput | undefined;
        if (!remove)
          input = fieldDefinitionInput.parse({
            name,
            description,
            type,
            required,
            options: supportsOptions
              ? field && labels === field.options.map((o) => o.label).join(", ")
                ? field.options
                : fieldOptionsFromLabels(labels, field?.options ?? [], () => uuid.v4())
              : [],
          });
        attemptedRef.current = true;
        setAttempted(true);
        if (remove) {
          if (!field || !deleteArmed) throw new Error("Confirm deletion first.");
          return deleteFieldDefinition(field);
        }
        if (field) {
          const { type: _type, ...settings } = input!;
          return updateFieldDefinition(field, { ...settings, expectedUpdatedAt: field.updatedAt });
        }
        return createFieldDefinition(crewId, input!);
      },
      onRefresh,
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">{t(field ? "taskFields.edit" : "taskFields.add")}</ThemedText>
      <ThemedText>{t("taskFields.name")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskFields.name")}
        value={name}
        onChangeText={setName}
        maxLength={80}
        editable={!locked}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskFields.description")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskFields.description")}
        value={description}
        onChangeText={setDescription}
        maxLength={240}
        editable={!locked}
        style={{ color: theme.text, padding: 12 }}
      />
      {field ? (
        <ThemedText>{t(`taskFields.${type}`)}</ThemedText>
      ) : (
        <View>
          {(
            ["text", "number", "date", "checkbox", "single_select", "multi_select", "user"] as const
          ).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: type === value }}
              disabled={locked}
              onPress={() => setType(value)}
              style={{
                padding: 12,
                backgroundColor:
                  type === value ? theme.backgroundSelected : theme.backgroundElement,
              }}
            >
              <ThemedText>{t(`taskFields.${value}`)}</ThemedText>
            </Pressable>
          ))}
        </View>
      )}
      {supportsOptions && (
        <>
          <ThemedText>{t("taskFields.options")}</ThemedText>
          <TextInput
            accessibilityLabel={t("taskFields.options")}
            value={labels}
            onChangeText={setLabels}
            editable={!locked}
            maxLength={4050}
            style={{ color: theme.text, padding: 12 }}
          />
        </>
      )}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: required }}
        disabled={locked}
        onPress={() => setRequired((v) => !v)}
      >
        <ThemedText>
          {t("taskFields.required")} ·{" "}
          {t(required ? "taskCustomFields.yes" : "taskCustomFields.no")}
        </ThemedText>
      </Pressable>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        disabled={locked || !valid || deleteArmed}
        onPress={() => actOn()}
      >
        <ThemedText>{t("taskPlanning.save")}</ThemedText>
      </Pressable>
      {field && (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            onPress={() => {
              if (deleteArmed) actOn(true);
              else setDeleteArmed(true);
            }}
          >
            <ThemedText>
              {t(deleteArmed ? "taskFields.confirmDelete" : "taskFields.delete")}
            </ThemedText>
          </Pressable>
          {deleteArmed && (
            <ThemedText accessibilityRole="alert">{t("taskFields.deleteWarning")}</ThemedText>
          )}
        </>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        onPress={attempted ? onRefresh : onCancel}
      >
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      {op.busy && <ActivityIndicator />}
    </ScrollView>
  );
}
