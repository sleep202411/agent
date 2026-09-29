import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  createTaskCycle,
  deleteTaskCycle,
  fetchManagedCycles,
  cycleChanges,
  cycleSettings,
  cycleDateText,
  parseCycleDate,
  updateTaskCycle,
  type ManagedCycle,
} from "./task-cycle-management-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function TaskCycleManagement(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0),
    [selection, setSelection] = useState<ManagedCycle | "new">();
  const [result, setResult] = useState<{
    revision: number;
    cycles?: ManagedCycle[];
    error?: string;
  }>();
  useEffect(() => {
    const c = new AbortController();
    void fetchManagedCycles(props.crewId, props.userId, props.generation, c.signal).then(
      (cycles) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setResult({ revision, cycles });
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
      <Form {...props} cycle={selection === "new" ? undefined : selection} onReturn={refresh} />
    );
  const visible = result?.revision === revision ? result : undefined;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("taskCycles.title")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {visible?.cycles && (
        <>
          <Button
            label={t("taskCycles.add")}
            onPress={() => {
              if (props.generation === getAuthGeneration()) setSelection("new");
            }}
          />
          {visible.cycles.length === 0 && <ThemedText>{t("taskCycles.empty")}</ThemedText>}
          {visible.cycles.map((cycle) => (
            <Pressable
              key={cycle.id}
              accessibilityRole="button"
              onPress={() => {
                if (props.generation === getAuthGeneration()) setSelection(cycle);
              }}
              style={{ padding: 12, gap: 6 }}
            >
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <ThemedText>
                  C{cycle.number} · {cycle.name} · {t(`taskCycles.${cycle.status}`)}
                </ThemedText>
              </View>
              {!!cycle.goal && <ThemedText>{cycle.goal}</ThemedText>}
            </Pressable>
          ))}
        </>
      )}
      <Button label={t("thread.refresh")} onPress={refresh} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Form(props: Props & { cycle?: ManagedCycle; onReturn: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${props.crewId}:${props.cycle?.id ?? "new"}`, true);
  const [name, setName] = useState(props.cycle?.name ?? ""),
    [goal, setGoal] = useState(props.cycle?.goal ?? ""),
    [start, setStart] = useState(props.cycle ? cycleDateText(props.cycle.startAt) : ""),
    [end, setEnd] = useState(props.cycle ? cycleDateText(props.cycle.endAt) : ""),
    [status, setStatus] = useState<"planned" | "active" | "completed" | "cancelled">(
      props.cycle?.status ?? "planned"
    );
  const [armed, setArmed] = useState(false),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const locked = attempted || op.busy;
  let dates: { startAt: string; endAt: string } | undefined;
  try {
    dates = {
      startAt: parseCycleDate(start, false, props.cycle?.startAt),
      endAt: parseCycleDate(end, true, props.cycle?.endAt),
    };
  } catch {
    /* Editable date validation. */
  }
  const parsed = cycleSettings.safeParse({ name, goal, status, ...dates });
  const changed =
    parsed.success &&
    (!props.cycle || Object.keys(cycleChanges(props.cycle, parsed.data)).length > 0);
  const actOn = (remove = false) => {
    if (locked || props.generation !== getAuthGeneration()) return;
    if (remove && !props.cycle) return;
    if (!remove && (!parsed.success || !changed)) return;
    if (remove && !armed) {
      setArmed(true);
      return;
    }
    void op.run(
      async () => {
        setAttempted(true);
        if (remove && props.cycle)
          return deleteTaskCycle(props.cycle, props.userId, props.generation);
        if (!parsed.success) return;
        return props.cycle
          ? updateTaskCycle(props.cycle, props.userId, props.generation, parsed.data)
          : createTaskCycle(props.crewId, props.userId, props.generation, {
              name: parsed.data.name,
              goal: parsed.data.goal,
              startAt: parsed.data.startAt,
              endAt: parsed.data.endAt,
            });
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
        {t(props.cycle ? "taskCycles.edit" : "taskCycles.add")}
      </ThemedText>
      <ThemedText>{t("taskCycles.shared")}</ThemedText>
      <ThemedText>{t("taskCycles.name")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskCycles.name")}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setArmed(false);
        }}
        editable={!locked}
        maxLength={100}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskCycles.goal")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskCycles.goal")}
        value={goal}
        onChangeText={(v) => {
          setGoal(v);
          setArmed(false);
        }}
        editable={!locked}
        multiline
        maxLength={2000}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>
        {t("taskCycles.datesHelp")} · {Intl.DateTimeFormat().resolvedOptions().timeZone}
      </ThemedText>
      <ThemedText>{t("taskCycles.start")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskCycles.start")}
        value={start}
        onChangeText={(v) => {
          setStart(v);
          setArmed(false);
        }}
        editable={!locked}
        maxLength={10}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.textSecondary}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("taskCycles.end")}</ThemedText>
      <TextInput
        accessibilityLabel={t("taskCycles.end")}
        value={end}
        onChangeText={(v) => {
          setEnd(v);
          setArmed(false);
        }}
        editable={!locked}
        maxLength={10}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.textSecondary}
        style={{ color: theme.text, padding: 12 }}
      />
      {props.cycle ? (
        <>
          <ThemedText>{t("taskCycles.status")}</ThemedText>
          <ThemedText>{t("taskCycles.activeHelp")}</ThemedText>
          {(["planned", "active", "completed", "cancelled"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: status === value, disabled: locked }}
              disabled={locked}
              onPress={() => {
                setStatus(value);
                setArmed(false);
              }}
              style={{
                padding: 12,
                backgroundColor:
                  status === value ? theme.backgroundSelected : theme.backgroundElement,
              }}
            >
              <ThemedText>{t(`taskCycles.${value}`)}</ThemedText>
            </Pressable>
          ))}
        </>
      ) : (
        <ThemedText>{t("taskCycles.createdPlanned")}</ThemedText>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {error && attempted && <ThemedText>{t("taskCycles.recheck")}</ThemedText>}
      <Button label={t("taskCycles.save")} disabled={locked || !changed} onPress={() => actOn()} />
      {props.cycle && (
        <>
          {armed && (
            <ThemedText>
              {t("taskCycles.deleteHelp").replace("{name}", props.cycle.name)}
            </ThemedText>
          )}
          <Button
            label={t(armed ? "taskCycles.confirmDelete" : "taskCycles.delete")}
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
