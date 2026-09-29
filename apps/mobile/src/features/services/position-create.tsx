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
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const [access, setAccess] = useState<Awaited<ReturnType<typeof fetchPositionCreateAccess>>>(),
    [error, setError] = useState<string>();
  const [role, setRole] = useState("director"),
    [description, setDescription] = useState(""),
    [count, setCount] = useState("1"),
    [skills, setSkills] = useState(""),
    [location, setLocation] = useState(""),
    [min, setMin] = useState(""),
    [max, setMax] = useState(""),
    [duration, setDuration] = useState(""),
    [share, setShare] = useState(""),
    [closeDate, setCloseDate] = useState("");
  const [mode, setMode] = useState<NewPosition["workMode"]>("remote"),
    [employment, setEmployment] = useState<NewPosition["employmentType"]>("project_based"),
    [experience, setExperience] = useState<NewPosition["experienceLevel"]>("any"),
    [period, setPeriod] = useState<NewPosition["salary"]["period"]>("project"),
    [currency, setCurrency] = useState<CurrencyCode>(isChinaRegion ? "CNY" : "USD"),
    [negotiable, setNegotiable] = useState(false),
    [visibility, setVisibility] = useState<"public" | "private">("public");
  const [task, setTask] = useState<TaskOption>(),
    [picking, setPicking] = useState(false),
    [expanded, setExpanded] = useState<string>(),
    [attempted, setAttempted] = useState(false),
    [saved, setSaved] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void fetchPositionCreateAccess(props.crewId, props.userId, props.generation, c.signal).then(
      (value) => {
        if (!c.signal.aborted) setAccess(value);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation]);
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
    if (!access || locked || props.generation !== getAuthGeneration()) return;
    let data: NewPosition;
    try {
      if (
        !/^\d+$/.test(count) ||
        (duration && !/^\d+$/.test(duration)) ||
        (share && !/^\d+(\.\d)?$/.test(share))
      )
        throw new Error("Invalid number");
      data = newPosition.parse({
        positionType: role,
        description,
        targetCount: Number(count),
        workMode: mode,
        location: mode === "remote" ? null : location.trim() || null,
        employmentType: employment,
        experienceLevel: experience,
        requiredSkills: skills
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
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
        ...(task ? { taskId: task.id } : {}),
        recruitmentVisibility: visibility,
      });
    } catch {
      setError(t("positionCreate.invalid"));
      return;
    }
    void op.run(
      () => {
        setAttempted(true);
        setError(undefined);
        return createPosition(props.crewId, props.userId, props.generation, data);
      },
      (result) => setSaved(result.id),
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  if (picking)
    return (
      <TaskPicker
        crewId={props.crewId}
        generation={props.generation}
        recruitmentOnly
        title={t("positionCreate.task")}
        closeLabel={t("nativeApplications.back")}
        onSelect={(value) => {
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
      <ThemedText>{t("positionCreate.title")}</ThemedText>
      {!access && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("positionCreate.saved").replace("{id}", saved)}</ThemedText>}
      {attempted && !saved && !op.busy && <ThemedText>{t("positionCreate.recheck")}</ThemedText>}
      {access && !attempted && (
        <>
          {choice(
            "positionCreate.role",
            role,
            PRESET_POSITIONS.map((p) => p.value),
            setRole,
            (v) => crewPositionLabel(v, t)
          )}
          {field("positionCreate.description", description, setDescription, 1000, true)}
          {field("positionCreate.count", count, setCount, 2)}
          {field("positionCreate.skills", skills, setSkills, 1300, true)}
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
          {access.canLinkTask && (
            <>
              {action(
                task ? taskLabel(task) : t("positionCreate.task"),
                () => setPicking(true),
                locked
              )}
              {task &&
                action(
                  t("positionCreate.clearTask"),
                  () => {
                    setTask(undefined);
                    setVisibility("public");
                  },
                  locked
                )}
            </>
          )}
          {task &&
            choice(
              "positionCreate.visibility",
              visibility,
              ["public", "private"] as const,
              setVisibility,
              (v) => t(`positionCreate.${v}`)
            )}
          <ThemedText>{t("positionCreate.visibilityHelp")}</ThemedText>
          {action(t("positionCreate.publish"), submit, locked)}
        </>
      )}
      {op.busy && <ActivityIndicator />}
      {action(t("nativeApplications.back"), props.onClose)}
    </ScrollView>
  );
}
