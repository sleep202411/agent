import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useUserDisplays } from "./user-displays";
import {
  fetchProjectProperties,
  updateProjectProperties,
  projectValues,
  projectChanges,
  valuesOf,
  projectStatuses,
  projectPriorities,
  projectGranularities,
  type ProjectContext,
  type ProjectValues,
} from "./project-properties-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function ProjectProperties(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    revision: number;
    data?: ProjectContext;
    error?: string;
  }>();
  useEffect(() => {
    const c = new AbortController();
    void fetchProjectProperties(props.crewId, props.userId, props.generation, c.signal).then(
      (data) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setResult({ revision, data });
      },
      (e) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setResult({ revision, error: e instanceof Error ? e.message : String(e) });
      }
    );
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, revision]);
  const visible = result?.revision === revision ? result : undefined;
  if (visible?.data)
    return (
      <Form
        key={revision}
        {...props}
        data={visible.data}
        refresh={() => setRevision((v) => v + 1)}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("projectProperties.title")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      <Button label={t("thread.refresh")} onPress={() => setRevision((v) => v + 1)} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Form(props: Props & { data: ProjectContext; refresh: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const [value, setValue] = useState<ProjectValues>(() => valuesOf(props.data)),
    [confirming, setConfirming] = useState(false),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const [leadSearch, setLeadSearch] = useState("");
  const displays = useUserDisplays(
    String(props.generation),
    props.data.members.map((m) => m.userId)
  );
  const locked = op.busy || attempted || confirming || !props.data.capabilities.manage;
  const parsed = projectValues.safeParse(value);
  const changed = parsed.success && Object.keys(projectChanges(props.data, parsed.data)).length > 0;
  const change = <K extends keyof ProjectValues>(key: K, v: ProjectValues[K]) =>
    setValue((old) => ({ ...old, [key]: v }));
  const save = () => {
    if (
      op.busy ||
      attempted ||
      !props.data.capabilities.manage ||
      !changed ||
      !parsed.success ||
      props.generation !== getAuthGeneration()
    )
      return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    void op.run(
      async () => {
        setAttempted(true);
        await updateProjectProperties(
          props.crewId,
          props.userId,
          props.generation,
          props.data,
          parsed.data
        );
      },
      props.refresh,
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">{t("projectProperties.title")}</ThemedText>
      {!props.data.capabilities.manage && (
        <ThemedText>{t("projectProperties.readOnly")}</ThemedText>
      )}
      <ThemedText>{t("projectProperties.status")}</ThemedText>
      <Choices
        values={projectStatuses}
        selected={value.status}
        label={(s) => t(`projectProperties.${s}`)}
        disabled={locked}
        choose={(s) => change("status", s)}
      />
      <ThemedText>{t("projectProperties.priority")}</ThemedText>
      <Button
        label={t("projectProperties.none")}
        selected={value.priority === null}
        disabled={locked}
        onPress={() => change("priority", null)}
      />
      <Choices
        values={projectPriorities}
        selected={value.priority}
        label={(s) => t(`projectProperties.${s}`)}
        disabled={locked}
        choose={(s) => change("priority", s)}
      />
      <ThemedText>{t("projectProperties.lead")}</ThemedText>
      {value.leadMemberId && !props.data.members.some((m) => m.id === value.leadMemberId) && (
        <ThemedText>
          {t("projectProperties.unavailableLead")}: {value.leadMemberId}
        </ThemedText>
      )}
      <Button
        label={t("projectProperties.none")}
        selected={value.leadMemberId === null}
        disabled={locked}
        onPress={() => change("leadMemberId", null)}
      />
      {props.data.members.length > 0 && (
        <TextInput
          accessibilityLabel={t("projectProperties.searchLead")}
          placeholder={t("projectProperties.searchLead")}
          placeholderTextColor={theme.text}
          value={leadSearch}
          onChangeText={setLeadSearch}
          editable={!locked}
          style={{ padding: 12, color: theme.text, backgroundColor: theme.backgroundElement }}
        />
      )}
      {props.data.members
        .filter(
          (m) =>
            m.id === value.leadMemberId ||
            `${displays?.get(m.userId)?.nickname || ""} ${m.userId}`
              .toLowerCase()
              .includes(leadSearch.trim().toLowerCase())
        )
        .map((m) => (
          <Button
            key={m.id}
            label={`${displays?.get(m.userId)?.nickname || m.userId} · ${m.userId}`}
            selected={m.id === value.leadMemberId}
            disabled={locked}
            onPress={() => change("leadMemberId", m.id)}
          />
        ))}
      {(["start", "target"] as const).map((kind) => (
        <View key={kind} style={{ gap: 8 }}>
          <ThemedText>
            {t(kind === "start" ? "projectProperties.start" : "projectProperties.target")}
          </ThemedText>
          <TextInput
            accessibilityLabel={t(
              kind === "start" ? "projectProperties.start" : "projectProperties.target"
            )}
            value={value[`${kind}Date`] ?? ""}
            onChangeText={(s) => change(`${kind}Date`, s || null)}
            editable={!locked}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.text}
            autoCapitalize="none"
            style={{ padding: 12, color: theme.text, backgroundColor: theme.backgroundElement }}
          />
          <Choices
            values={projectGranularities}
            selected={value[`${kind}DateGranularity`]}
            label={(s) => t(`projectProperties.${s}`)}
            disabled={locked}
            choose={(s) => change(`${kind}DateGranularity`, s)}
          />
        </View>
      ))}
      <ThemedText>{t("projectProperties.dateHelp")}</ThemedText>
      <ThemedText>{t("projectProperties.labels")}</ThemedText>
      {props.data.labelOptions.length === 0 && (
        <ThemedText>{t("projectProperties.none")}</ThemedText>
      )}
      {[
        ...props.data.labelOptions,
        ...props.data.labels.filter(
          (l) => !props.data.labelOptions.some((option) => option.id === l.id)
        ),
      ].map((l) => (
        <Button
          key={l.id}
          label={l.name}
          selected={value.labelIds.includes(l.id)}
          disabled={locked}
          onPress={() =>
            change(
              "labelIds",
              value.labelIds.includes(l.id)
                ? value.labelIds.filter((id) => id !== l.id)
                : [...value.labelIds, l.id]
            )
          }
        />
      ))}
      {!parsed.success && (
        <ThemedText accessibilityRole="alert">{parsed.error.issues[0]?.message}</ThemedText>
      )}
      {confirming && <ThemedText>{t("projectProperties.confirmHelp")}</ThemedText>}
      {props.data.capabilities.manage && (
        <Button
          label={t(confirming ? "projectProperties.save" : "projectProperties.review")}
          disabled={!changed || op.busy || attempted}
          onPress={save}
        />
      )}
      {confirming && (
        <Button
          label={t("memberAccess.edit")}
          disabled={op.busy || attempted}
          onPress={() => setConfirming(false)}
        />
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && error && <ThemedText>{t("memberAccess.recheck")}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      <Button label={t("thread.refresh")} disabled={op.busy} onPress={props.refresh} />
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function Choices<T extends string>({
  values,
  selected,
  label,
  disabled,
  choose,
}: {
  values: readonly T[];
  selected: T | null;
  label: (v: T) => string;
  disabled: boolean;
  choose: (v: T) => void;
}) {
  return (
    <View style={{ gap: 6, flexDirection: "row", flexWrap: "wrap" }}>
      {values.map((v) => (
        <Button
          key={v}
          label={label(v)}
          selected={selected === v}
          disabled={disabled}
          onPress={() => choose(v)}
        />
      ))}
    </View>
  );
}
function Button({
  label,
  onPress,
  disabled,
  selected,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>
        {selected ? "✓ " : ""}
        {label}
      </ThemedText>
    </Pressable>
  );
}
