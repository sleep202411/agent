import { TaskPaymentTermsField } from "./task-payment-terms-field";
import { fetchTaskDetail, type TaskDetail } from "./task-detail-api";
import { isPresetPosition } from "@repo/shared/crew";
import { CrewSkillsField } from "./crew-skills-field";
import {
  positionDraft,
  positionEditDraft,
  editPosition,
  type EditablePosition,
  type PositionEditDraft,
} from "./position-edit-api";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import {
  PRESET_POSITIONS,
  WORK_MODES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  SALARY_PERIODS,
  type CurrencyCode,
} from "@repo/shared/crew";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { isChinaRegion } from "@/config/app-env";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { crewPositionLabel } from "@/lib/crew-position-label";
import { TaskPicker } from "./task-picker";
import { taskLabel, type TaskOption } from "./task-options";
import {
  createPosition,
  fetchPositionCreateAccess,
  newPosition,
  positionAmount,
  positionCurrencies,
  type NewPosition,
} from "./position-create-api";
export function PositionCreate(props: {
  active?: boolean;
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  closeLabel?: string;
  editing?: EditablePosition;
  initialTask?: TaskOption;
  initialPosition?: (typeof PRESET_POSITIONS)[number]["value"];
}) {
  const initial = props.editing ? positionDraft(props.editing) : undefined;
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const [access, setAccess] = useState<Awaited<ReturnType<typeof fetchPositionCreateAccess>>>(),
    [error, setError] = useState<string>();
  const [role, setRole] = useState(initial?.positionType ?? props.initialPosition ?? "director"),
    [description, setDescription] = useState(initial?.description ?? ""),
    [count, setCount] = useState(String(initial?.targetCount ?? 1)),
    [skills, setSkills] = useState<string[]>(initial?.requiredSkills ?? []),
    [location, setLocation] = useState(initial?.location ?? ""),
    [min, setMin] = useState(initial?.salary.min == null ? "" : String(initial.salary.min)),
    [max, setMax] = useState(initial?.salary.max == null ? "" : String(initial.salary.max)),
    [duration, setDuration] = useState(
      initial?.durationMonths == null ? "" : String(initial.durationMonths)
    ),
    [share, setShare] = useState(
      initial?.revenueSharePercent == null ? "" : String(initial.revenueSharePercent)
    ),
    [closeDate, setCloseDate] = useState(initial?.closeDate ?? "");
  const [mode, setMode] = useState<NewPosition["workMode"]>(initial?.workMode ?? "remote"),
    [employment, setEmployment] = useState<NewPosition["employmentType"]>(
      initial?.employmentType ?? "project_based"
    ),
    [experience, setExperience] = useState<NewPosition["experienceLevel"]>(
      initial?.experienceLevel ?? "any"
    ),
    [period, setPeriod] = useState<NewPosition["salary"]["period"]>(
      initial?.salary.period ?? "project"
    ),
    [currency, setCurrency] = useState<CurrencyCode>(
      initial?.salary.currency ?? (isChinaRegion ? "CNY" : "USD")
    ),
    [negotiable, setNegotiable] = useState(initial?.salary.negotiable ?? false);
  const [paymentTerms, setPaymentTerms] = useState<NewPosition["paymentTerms"]>(
    initial?.paymentTerms ?? null
  );
  const [roleChosen, setRoleChosen] = useState(!!initial || !!props.initialPosition);
  const [source, setSource] = useState<{ id: string; data?: TaskDetail; error?: string }>();
  const [sourceRevision, setSourceRevision] = useState(0);
  const [importedTask, setImportedTask] = useState<string>();
  const [task, setTask] = useState<TaskOption | undefined>(props.initialTask),
    [picking, setPicking] = useState(false),
    [expanded, setExpanded] = useState<string>(),
    [attempted, setAttempted] = useState(false),
    [saved, setSaved] = useState<string>();
  const [readError, setReadError] = useState<string>();
  const [readRevision, setReadRevision] = useState(0);
  const readKey = `${props.active !== false}:${readRevision}`;
  const [previousReadKey, setPreviousReadKey] = useState(readKey);
  if (previousReadKey !== readKey) {
    setPreviousReadKey(readKey);
    setAccess(undefined);
    setReadError(undefined);
  }
  useEffect(() => {
    if (props.active === false) return;
    const c = new AbortController();
    void fetchPositionCreateAccess(props.crewId, props.userId, props.generation, c.signal).then(
      (value) => {
        if (!c.signal.aborted) setAccess(value);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setReadError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, props.active, readRevision]);
  useEffect(() => {
    if (!task || props.editing || props.active === false || !access?.canLinkTask) return;
    const controller = new AbortController();
    void fetchTaskDetail(props.crewId, task.id, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSource({ id: task.id, data });
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSource({ id: task.id, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [
    task,
    props.crewId,
    props.generation,
    props.active,
    props.editing,
    access?.canLinkTask,
    sourceRevision,
  ]);
  const taskSource = task && source?.id === task.id ? source : undefined;
  const importPending = !!task && !props.editing && !taskSource?.data;
  if (
    props.active !== false &&
    props.generation === getAuthGeneration() &&
    access?.canLinkTask &&
    !props.editing &&
    !op.busy &&
    !attempted &&
    taskSource?.data &&
    importedTask !== task?.id
  ) {
    const data = taskSource.data;
    setImportedTask(task!.id);
    setPaymentTerms(data.paymentTerms ?? null);
    if (!roleChosen && data.positionRole && isPresetPosition(data.positionRole)) {
      setRole(data.positionRole);
      setRoleChosen(true);
    }
    setDescription((current) => (current.trim() ? current : data.description));
    setSkills((current) => (current.length ? current : (data.requiredSkills ?? [])));
    if (data.rewardUsdMinor != null && !min && !max && positionCurrencies.includes("USD")) {
      setCurrency("USD");
      setMin(String(data.rewardUsdMinor / 100));
      setMax(String(data.rewardUsdMinor / 100));
      setPeriod("project");
    }
    if (data.dueAt && !closeDate) setCloseDate(data.dueAt.slice(0, 10));
  }
  const locked = op.busy || attempted;
  const action = (label: string, onPress: () => void, disabled = false, selected = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || op.busy, selected }}
      disabled={disabled || op.busy}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: selected ? theme.brand : theme.border,
        backgroundColor: theme.backgroundElement,
        opacity: disabled || op.busy ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  const field = (
    key: Parameters<typeof t>[0],
    value: string,
    onChangeText: (v: string) => void,
    maxLength: number,
    multiline = false
  ) => (
    <View style={{ gap: 6 }}>
      <ThemedText>{t(key)}</ThemedText>
      <TextInput
        accessibilityLabel={t(key)}
        value={value}
        onChangeText={onChangeText}
        editable={!locked}
        maxLength={maxLength}
        multiline={multiline}
        style={{
          color: theme.text,
          padding: 12,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 8,
          minHeight: multiline ? 90 : 44,
        }}
      />
    </View>
  );
  const choice = <T extends string>(
    key: Parameters<typeof t>[0],
    value: T,
    values: readonly T[],
    change: (v: T) => void,
    label: (v: T) => string
  ) => (
    <View style={{ gap: 6 }}>
      {action(
        `${t(key)} · ${label(value)}`,
        () => setExpanded(expanded === key ? undefined : key),
        locked
      )}
      {expanded === key &&
        values.map((v) => (
          <View key={v}>
            {action(
              label(v),
              () => {
                change(v);
                setExpanded(undefined);
              },
              locked,
              v === value
            )}
          </View>
        ))}
    </View>
  );
  const submit = () => {
    if (
      props.active === false ||
      !access ||
      locked ||
      importPending ||
      props.generation !== getAuthGeneration()
    )
      return;
    let data: PositionEditDraft;
    try {
      if (
        !/^\d+$/.test(count) ||
        (duration && !/^\d+$/.test(duration)) ||
        (share && !/^\d+(\.\d)?$/.test(share))
      )
        throw new Error("Invalid number");
      data = (props.editing ? positionEditDraft : newPosition).parse({
        positionType: role,
        description,
        targetCount: Number(count),
        workMode: mode,
        location: mode === "remote" ? null : location.trim() || null,
        employmentType: employment,
        experienceLevel: experience,
        requiredSkills: skills,
        paymentTerms,
        salary: {
          period,
          currency,
          min: positionAmount(min, currency),
          max: positionAmount(max, currency),
          negotiable,
        },
        durationMonths: duration ? Number(duration) : null,
        revenueSharePercent: share ? Number(share) : null,
        closeDate: closeDate.trim() || null,
        ...(props.editing?.taskId
          ? { taskId: props.editing.taskId }
          : task
            ? { taskId: task.id }
            : {}),
        recruitmentVisibility: initial?.recruitmentVisibility ?? "public",
      });
    } catch {
      setError(t("positionCreate.invalid"));
      return;
    }
    if (props.editing && initial) {
      if (data.targetCount < props.editing.recruitedCount) {
        setError(t("positionCreate.invalid"));
        return;
      }
      if (
        (Object.keys(initial) as (keyof PositionEditDraft)[]).every(
          (key) => JSON.stringify(initial[key]) === JSON.stringify(data[key])
        )
      ) {
        setError(t("positionEdit.noChanges"));
        return;
      }
    }
    void op.run(
      () => {
        setAttempted(true);
        setError(undefined);
        return props.editing
          ? editPosition(props.editing, props.userId, props.generation, data)
          : createPosition(props.crewId, props.userId, props.generation, newPosition.parse(data));
      },
      (result) => setSaved(result.id),
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  if (props.active === false) return null;
  if (picking && access)
    return (
      <TaskPicker
        crewId={props.crewId}
        generation={props.generation}
        recruitmentOnly
        title={t("positionCreate.task")}
        closeLabel={t("nativeApplications.back")}
        onSelect={(value) => {
          setSource(undefined);
          setImportedTask(undefined);
          setTask(value);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>{t(props.editing ? "positionEdit.title" : "positionCreate.title")}</ThemedText>
      {!access && !readError && <ActivityIndicator />}
      {readError && <ThemedText accessibilityRole="alert">{readError}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && (
        <ThemedText>
          {t(props.editing ? "positionEdit.saved" : "positionCreate.saved").replace("{id}", saved)}
        </ThemedText>
      )}
      {attempted && !saved && !op.busy && (
        <ThemedText>
          {t(props.editing ? "positionEdit.recheck" : "positionCreate.recheck")}
        </ThemedText>
      )}
      {access && !attempted && (
        <>
          {props.editing ? (
            <ThemedText>{crewPositionLabel(role, t)}</ThemedText>
          ) : (
            choice(
              "positionCreate.role",
              role,
              PRESET_POSITIONS.map((p) => p.value),
              (value) => {
                setRole(value);
                setRoleChosen(true);
              },
              (v) => crewPositionLabel(v, t)
            )
          )}
          {field("positionCreate.description", description, setDescription, 10000, true)}
          {!props.editing &&
            taskSource?.data &&
            access.canLinkTask &&
            action(
              t("positionCreate.useTaskBrief"),
              () => setDescription(taskSource.data!.description),
              locked || !!description.trim()
            )}
          <ThemedText>{t("positionCreate.publicBriefHelp")}</ThemedText>
          {field("positionCreate.count", count, setCount, 2)}
          <CrewSkillsField
            value={skills}
            onChange={setSkills}
            generation={props.generation}
            locked={locked}
          />
          {choice("positionCreate.mode", mode, WORK_MODES, setMode, (v) =>
            t(`positionCreate.${v}`)
          )}
          {mode !== "remote" && field("positionCreate.location", location, setLocation, 128)}
          {choice("positionCreate.employment", employment, EMPLOYMENT_TYPES, setEmployment, (v) =>
            t(`positionCreate.${v}`)
          )}
          {choice("positionCreate.experience", experience, EXPERIENCE_LEVELS, setExperience, (v) =>
            t(`positionCreate.${v}`)
          )}
          <TaskPaymentTermsField
            value={paymentTerms ?? null}
            onChange={setPaymentTerms}
            locked={locked}
          />
          {choice("positionCreate.currency", currency, positionCurrencies, setCurrency, (v) => v)}
          {choice("positionCreate.period", period, SALARY_PERIODS, setPeriod, (v) =>
            t(`crewTerms.${v}`)
          )}
          {field("positionCreate.min", min, setMin, 12)}
          {field("positionCreate.max", max, setMax, 12)}
          {action(
            t("positionCreate.negotiable"),
            () => setNegotiable((v) => !v),
            locked,
            negotiable
          )}
          {field("positionCreate.duration", duration, setDuration, 2)}
          {field("positionCreate.share", share, setShare, 4)}
          {field("positionCreate.closeDate", closeDate, setCloseDate, 10)}
          {!props.editing && access.canLinkTask && (
            <>
              {action(
                task ? taskLabel(task) : t("positionCreate.task"),
                () => setPicking(true),
                locked
              )}
              {task && importPending && !taskSource?.error && <ActivityIndicator />}
              {taskSource?.error && (
                <>
                  <ThemedText accessibilityRole="alert">{taskSource.error}</ThemedText>
                  {action(
                    t("common.retry"),
                    () => {
                      setSource(undefined);
                      setSourceRevision((n) => n + 1);
                    },
                    locked
                  )}
                </>
              )}
              {taskSource?.data?.rewardUsdMinor != null && !positionCurrencies.includes("USD") && (
                <ThemedText>{t("positionCreate.taskUsdReward")}</ThemedText>
              )}
              {task &&
                action(
                  t("positionCreate.clearTask"),
                  () => {
                    setTask(undefined);
                  },
                  locked
                )}
            </>
          )}
          <ThemedText>
            {t(props.editing ? "positionEdit.help" : "positionCreate.visibilityHelp")}
          </ThemedText>
          {action(
            t(props.editing ? "positionEdit.save" : "positionCreate.publish"),
            submit,
            locked || importPending
          )}
        </>
      )}
      {!access && readError && action(t("common.retry"), () => setReadRevision((n) => n + 1))}
      {op.busy && <ActivityIndicator />}
      {action(props.closeLabel ?? t("nativeApplications.back"), props.onClose)}
    </ScrollView>
  );
}
