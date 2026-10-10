import { taskWorkflowLabel } from "./task-workflow-label";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  createManagedWorkflow,
  deleteManagedWorkflow,
  fetchManagedWorkflows,
  reorderManagedWorkflows,
  setWorkflowArchived,
  updateManagedWorkflow,
  workflowSemantic,
  workflowSettings,
  type ManagedWorkflow,
} from "./task-workflow-management-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function TaskWorkflowManagement(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0),
    [selection, setSelection] = useState<ManagedWorkflow | "new">();
  const [result, setResult] = useState<{
    revision: number;
    rows?: ManagedWorkflow[];
    error?: string;
  }>();
  useEffect(() => {
    const c = new AbortController();
    void fetchManagedWorkflows(props.crewId, props.userId, props.generation, c.signal).then(
      (rows) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setResult({ revision, rows });
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
  const visible = result?.revision === revision ? result : undefined;
  if (selection && visible?.rows)
    return (
      <Form
        {...props}
        state={selection === "new" ? undefined : selection}
        rows={visible.rows}
        onReturn={refresh}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("taskWorkflowManagement.title")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {visible?.rows && (
        <>
          <Button
            label={t("taskWorkflowManagement.add")}
            disabled={visible.rows.filter((r) => !r.archived).length >= 24}
            onPress={() => setSelection("new")}
          />
          {visible.rows.map((row) => (
            <Button
              key={row.id}
              label={`${taskWorkflowLabel(row, t)} · ${t(`taskWorkflowManagement.${row.archived ? "archived" : "active"}`)} · ${row.taskCount}`}
              onPress={() => setSelection(row)}
            />
          ))}
        </>
      )}
      <Button label={t("thread.refresh")} onPress={refresh} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Form(
  props: Props & { state?: ManagedWorkflow; rows: ManagedWorkflow[]; onReturn: () => void }
) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${props.crewId}:${props.state?.id ?? "new"}`, true);
  const [name, setName] = useState(props.state?.name ?? ""),
    [color, setColor] = useState(props.state?.color ?? "#E52227");
  const [semantic, setSemantic] = useState<ManagedWorkflow["semantic"]>(
    props.state?.semantic ?? "in_progress"
  );
  const [after, setAfter] = useState<string | null>(null),
    [replacement, setReplacement] = useState<string>();
  const [armed, setArmed] = useState<"archive" | "delete">(),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const locked = op.busy || attempted;
  const parsed = workflowSettings.safeParse({ name, color });
  const changed =
    parsed.success &&
    (!props.state ||
      parsed.data.name !== props.state.name ||
      parsed.data.color !== props.state.color);
  const active = props.rows.filter((r) => !r.archived).sort((a, b) => a.position - b.position);
  const index = active.findIndex((r) => r.id === props.state?.id);
  const candidates = active.filter(
    (r) => r.id !== props.state?.id && r.semantic === props.state?.semantic
  );
  const actOn = (kind: "save" | "archive" | "restore" | "delete" | "up" | "down") => {
    if (locked || props.generation !== getAuthGeneration()) return;
    if (kind === "save" && (!parsed.success || !changed)) return;
    if ((kind === "archive" || kind === "delete") && armed !== kind) {
      setArmed(kind);
      return;
    }
    void op.run(
      async () => {
        setAttempted(true);
        const s = props.state;
        if (kind === "save" && parsed.success)
          return s
            ? updateManagedWorkflow(s, props.userId, props.generation, parsed.data)
            : createManagedWorkflow(props.crewId, props.userId, props.generation, {
                ...parsed.data,
                semantic,
                afterStateId: after,
              });
        if (!s) return;
        if (kind === "archive" || kind === "restore")
          return setWorkflowArchived(
            s,
            props.userId,
            props.generation,
            kind === "archive",
            replacement
          );
        if (kind === "delete") return deleteManagedWorkflow(s, props.userId, props.generation);
        const next = index + (kind === "up" ? -1 : 1);
        if (index < 0 || next < 0 || next >= active.length)
          throw new Error("Workflow order changed. Refresh before continuing.");
        const ordered = [...active];
        [ordered[index], ordered[next]] = [ordered[next]!, ordered[index]!];
        return reorderManagedWorkflows(props.crewId, props.userId, props.generation, ordered);
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
        {t(props.state ? "taskWorkflowManagement.edit" : "taskWorkflowManagement.add")}
      </ThemedText>
      <ThemedText>{t("taskWorkflowManagement.shared")}</ThemedText>
      <ThemedText>{t("taskLabels.name")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskLabels.name")}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setArmed(undefined);
        }}
        editable={!locked}
        maxLength={80}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskLabels.color")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskLabels.color")}
        value={color}
        onChangeText={(v) => {
          setColor(v);
          setArmed(undefined);
        }}
        editable={!locked}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={7}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskLabels.colorHelp")}</ThemedText>
      <ThemedText>{t("taskWorkflowManagement.status")}</ThemedText>
      {props.state ? (
        <ThemedText>{t(`taskWorkflowManagement.${semantic}`)}</ThemedText>
      ) : (
        <>
          {workflowSemantic.options.map((value) => (
            <Choice
              key={value}
              label={t(`taskWorkflowManagement.${value}`)}
              selected={semantic === value}
              disabled={locked}
              onPress={() => setSemantic(value)}
            />
          ))}
          <ThemedText>{t("taskWorkflowManagement.insertAfter")}</ThemedText>
          <Choice
            label={t("taskWorkflowManagement.atEnd")}
            selected={after === null}
            disabled={locked}
            onPress={() => setAfter(null)}
          />
          {active.map((row) => (
            <Choice
              key={row.id}
              label={taskWorkflowLabel(row, t)}
              selected={after === row.id}
              disabled={locked}
              onPress={() => setAfter(row.id)}
            />
          ))}
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {error && attempted && <ThemedText>{t("taskWorkflowManagement.recheck")}</ThemedText>}
      <Button
        label={t("taskLabels.save")}
        disabled={locked || !changed}
        onPress={() => actOn("save")}
      />
      {props.state && (
        <>
          {!props.state.archived && (
            <>
              <Button
                label={t("taskWorkflowManagement.up")}
                disabled={locked || index <= 0}
                onPress={() => actOn("up")}
              />
              <Button
                label={t("taskWorkflowManagement.down")}
                disabled={locked || index < 0 || index >= active.length - 1}
                onPress={() => actOn("down")}
              />
              {armed === "archive" && (
                <>
                  <ThemedText>{t("taskWorkflowManagement.archiveHelp")}</ThemedText>
                  {(props.state.taskCount ?? 0) > 0 && (
                    <>
                      <ThemedText>{t("taskWorkflowManagement.replacement")}</ThemedText>
                      {!candidates.length && (
                        <ThemedText>{t("taskWorkflowManagement.noReplacement")}</ThemedText>
                      )}
                      {candidates.map((row) => (
                        <Choice
                          key={row.id}
                          label={taskWorkflowLabel(row, t)}
                          selected={replacement === row.id}
                          disabled={locked}
                          onPress={() => setReplacement(row.id)}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
              <Button
                label={t(
                  armed === "archive"
                    ? "taskWorkflowManagement.confirmArchive"
                    : "taskWorkflowManagement.archive"
                )}
                disabled={
                  locked ||
                  active.length <= 1 ||
                  (armed === "archive" && (props.state.taskCount ?? 0) > 0 && !replacement)
                }
                onPress={() => actOn("archive")}
              />
            </>
          )}
          {props.state.archived && (
            <>
              <Button
                label={t("taskWorkflowManagement.restore")}
                disabled={locked || active.length >= 24}
                onPress={() => actOn("restore")}
              />
              {props.state.systemKey === null && (
                <>
                  {armed === "delete" && (
                    <ThemedText>{t("taskWorkflowManagement.deleteHelp")}</ThemedText>
                  )}
                  <Button
                    label={t(armed === "delete" ? "taskLabels.confirmDelete" : "taskLabels.delete")}
                    disabled={locked || props.state.taskCount !== 0}
                    onPress={() => actOn("delete")}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
      {op.busy && <ActivityIndicator />}
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onReturn} />
    </ScrollView>
  );
}
function Choice({
  selected,
  ...props
}: {
  selected: boolean;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return <Button {...props} selected={selected} />;
}
function Button({
  label,
  disabled,
  onPress,
  selected,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  selected?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={selected === undefined ? "button" : "radio"}
      accessibilityState={{ disabled: !!disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
        borderWidth: selected ? 1 : 0,
        borderColor: theme.text,
      }}
    >
      <View>
        <ThemedText>{label}</ThemedText>
      </View>
    </Pressable>
  );
}
