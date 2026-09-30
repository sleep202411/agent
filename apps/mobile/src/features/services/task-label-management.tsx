import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  createTaskLabel,
  deleteTaskLabel,
  fetchManagedLabels,
  labelChanges,
  taskLabelInput,
  updateTaskLabel,
  type ManagedLabel,
} from "./task-label-management-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function TaskLabelManagement(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0),
    [selection, setSelection] = useState<ManagedLabel | "new">();
  const [result, setResult] = useState<{
    revision: number;
    labels?: ManagedLabel[];
    error?: string;
  }>();
  useEffect(() => {
    const c = new AbortController();
    void fetchManagedLabels(props.crewId, props.userId, props.generation, c.signal).then(
      (labels) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setResult({ revision, labels });
      },
      (e) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setResult({ revision, error: e instanceof Error ? e.message : String(e) });
      }
    );
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, revision]);
  const refresh = () => {
    setSelection(undefined);
    setRevision((v) => v + 1);
  };
  if (selection)
    return (
      <Form {...props} label={selection === "new" ? undefined : selection} onReturn={refresh} />
    );
  const visible = result?.revision === revision ? result : undefined;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("taskLabels.title")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {visible?.labels && (
        <>
          <Button
            label={t("taskLabels.add")}
            onPress={() => {
              if (props.generation === getAuthGeneration()) setSelection("new");
            }}
          />
          {visible.labels.length === 0 && <ThemedText>{t("taskLabels.empty")}</ThemedText>}
          {visible.labels.map((label) => (
            <Pressable
              key={label.id}
              accessibilityRole="button"
              onPress={() => {
                if (props.generation === getAuthGeneration()) setSelection(label);
              }}
              style={{ padding: 12, gap: 6 }}
            >
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <View
                  style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: label.color }}
                />
                <ThemedText>{label.name}</ThemedText>
              </View>
              {!!label.description && <ThemedText>{label.description}</ThemedText>}
            </Pressable>
          ))}
        </>
      )}
      <Button label={t("thread.refresh")} onPress={refresh} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Form(props: Props & { label?: ManagedLabel; onReturn: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${props.crewId}:${props.label?.id ?? "new"}`, true);
  const [name, setName] = useState(props.label?.name ?? ""),
    [description, setDescription] = useState(props.label?.description ?? ""),
    [color, setColor] = useState(props.label?.color ?? "#e52227");
  const [armed, setArmed] = useState(false),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const locked = attempted || op.busy;
  const parsed = taskLabelInput.safeParse({ name, description, color });
  const changed =
    parsed.success &&
    (!props.label || Object.keys(labelChanges(props.label, parsed.data)).length > 0);
  const actOn = (remove = false) => {
    if (locked || props.generation !== getAuthGeneration()) return;
    if (remove && !props.label) return;
    if (!remove && (!parsed.success || !changed)) return;
    if (remove && !armed) {
      setArmed(true);
      return;
    }
    void op.run(
      async () => {
        setAttempted(true);
        if (remove && props.label)
          return deleteTaskLabel(props.label, props.userId, props.generation);
        if (!parsed.success) return;
        return props.label
          ? updateTaskLabel(props.label, props.userId, props.generation, parsed.data)
          : createTaskLabel(props.crewId, props.userId, props.generation, parsed.data);
      },
      props.onReturn,
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">
        {t(props.label ? "taskLabels.edit" : "taskLabels.add")}
      </ThemedText>
      <ThemedText>{t("taskLabels.shared")}</ThemedText>
      <ThemedText>{t("taskLabels.name")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskLabels.name")}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setArmed(false);
        }}
        editable={!locked}
        maxLength={64}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskLabels.description")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskLabels.description")}
        value={description}
        onChangeText={(v) => {
          setDescription(v);
          setArmed(false);
        }}
        editable={!locked}
        multiline
        maxLength={240}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskLabels.color")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskLabels.color")}
        value={color}
        onChangeText={(v) => {
          setColor(v);
          setArmed(false);
        }}
        editable={!locked}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={7}
        placeholder="#e52227"
        placeholderTextColor={theme.textSecondary}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskLabels.colorHelp")}</ThemedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {["#e52227", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#737373"].map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityLabel={`${t("taskLabels.color")} ${value}`}
            accessibilityState={{ selected: color.toLowerCase() === value, disabled: locked }}
            disabled={locked}
            onPress={() => {
              setColor(value);
              setArmed(false);
            }}
            style={{
              padding: 12,
              borderRadius: 8,
              borderWidth: 2,
              borderColor: color.toLowerCase() === value ? theme.text : theme.border,
            }}
          >
            <View style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: value }} />
          </Pressable>
        ))}
      </View>
      {parsed.success && (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <View
            style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: parsed.data.color }}
          />
          <ThemedText>{parsed.data.name}</ThemedText>
        </View>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {error && attempted && <ThemedText>{t("taskLabels.recheck")}</ThemedText>}
      <Button label={t("taskLabels.save")} disabled={locked || !changed} onPress={() => actOn()} />
      {props.label && (
        <>
          {armed && (
            <ThemedText>
              {t("taskLabels.deleteHelp").replace("{name}", props.label.name)}
            </ThemedText>
          )}
          <Button
            label={t(armed ? "taskLabels.confirmDelete" : "taskLabels.delete")}
            disabled={locked}
            onPress={() => actOn(true)}
          />
        </>
      )}
      {op.busy && <ActivityIndicator />}
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onReturn} />
    </ScrollView>
  );
}
function Button({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
