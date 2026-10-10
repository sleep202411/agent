import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  fetchCrewStudioWorkspace,
  initializeCrewStudioWorkspace,
  linkCrewStudioWorkspace,
  type CrewStudioWorkspaceState,
} from "./crew-studio-workspace-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  backLabel?: string;
};
export function CrewStudioWorkspace(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    revision: number;
    value?: CrewStudioWorkspaceState;
    error?: string;
  }>();
  useEffect(() => {
    const c = new AbortController();
    void fetchCrewStudioWorkspace(props.crewId, props.userId, props.generation, c.signal).then(
      (value) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setResult({ revision, value });
      },
      (e) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setResult({ revision, error: e instanceof Error ? e.message : String(e) });
      }
    );
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, revision]);
  const visible = result?.revision === revision ? result : undefined;
  const refresh = () => setRevision((v) => v + 1);
  if (visible?.value)
    return <Form key={revision} {...props} snapshot={visible.value} refresh={refresh} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("crewStudio.title")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      <Button label={t("thread.refresh")} onPress={refresh} />
      <Button label={props.backLabel ?? t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Form(props: Props & { snapshot: CrewStudioWorkspaceState; refresh: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState<string>();
  const [armed, setArmed] = useState<"link" | "unlink" | "initialize">();
  const [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const locked = attempted || op.busy;
  const { snapshot } = props;
  const selected = snapshot.options.find((row) => row.id === choice);
  const canLink =
    !!selected && (selected.id !== snapshot.workspace?.id || !!snapshot.legacyProject);
  const canInitialize = !snapshot.workspace && !snapshot.legacyProject;
  const actOn = (action: "link" | "unlink" | "initialize") => {
    if (locked || props.generation !== getAuthGeneration()) return;
    if (action === "link" && !canLink) return;
    if (action === "initialize" && !canInitialize) return;
    if (action === "unlink" && !snapshot.workspace && !snapshot.legacyProject) return;
    if (armed !== action) {
      setArmed(action);
      return;
    }
    void op.run(
      async () => {
        setAttempted(true);
        if (action === "initialize")
          return initializeCrewStudioWorkspace(snapshot, props.userId, props.generation);
        return linkCrewStudioWorkspace(
          snapshot,
          props.userId,
          props.generation,
          action === "unlink" ? null : selected!.id
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
      <ThemedText type="smallBold">{t("crewStudio.title")}</ThemedText>
      <ThemedText>{t("crewStudio.help")}</ThemedText>
      <ThemedText>
        {t("crewStudio.current")}: {snapshot.workspace?.name ?? t("crewStudio.none")}
      </ThemedText>
      {snapshot.legacyProject && (
        <ThemedText>
          {t("crewStudio.legacy")
            .replace("{name}", snapshot.legacyProject.name)
            .replace("{workspace}", snapshot.legacyProject.workspace.name)}
        </ThemedText>
      )}
      <TextInput
        accessibilityLabel={t("crewStudio.search")}
        placeholder={t("crewStudio.search")}
        placeholderTextColor={theme.textSecondary}
        value={query}
        editable={!locked}
        onChangeText={setQuery}
        style={{ color: theme.text, padding: 12 }}
      />
      {snapshot.options
        .filter((row) => row.name.toLowerCase().includes(query.trim().toLowerCase()))
        .map((row) => (
          <Button
            key={row.id}
            label={row.name}
            selected={choice === row.id}
            disabled={locked}
            onPress={() => {
              setChoice(row.id);
              setArmed(undefined);
            }}
          />
        ))}
      {!snapshot.options.length && <ThemedText>{t("crewStudio.empty")}</ThemedText>}
      {selected && (
        <ThemedText>{t("crewStudio.selected").replace("{name}", selected.name)}</ThemedText>
      )}
      {armed && (
        <ThemedText>
          {t(
            armed === "link"
              ? "crewStudio.linkHelp"
              : armed === "unlink"
                ? "crewStudio.unlinkHelp"
                : "crewStudio.initializeHelp"
          )}
        </ThemedText>
      )}
      <Button
        label={t(armed === "link" ? "crewStudio.confirmLink" : "crewStudio.link")}
        disabled={locked || !canLink}
        onPress={() => actOn("link")}
      />
      {(snapshot.workspace || snapshot.legacyProject) && (
        <Button
          label={t(armed === "unlink" ? "crewStudio.confirmUnlink" : "crewStudio.unlink")}
          disabled={locked}
          onPress={() => actOn("unlink")}
        />
      )}
      {canInitialize && (
        <Button
          label={t(
            armed === "initialize" ? "crewStudio.confirmInitialize" : "crewStudio.initialize"
          )}
          disabled={locked}
          onPress={() => actOn("initialize")}
        />
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {error && attempted && <ThemedText>{t("crewStudio.recheck")}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      <Button label={t("thread.refresh")} disabled={op.busy} onPress={props.refresh} />
      <Button
        label={props.backLabel ?? t("crewTasks.back")}
        disabled={op.busy}
        onPress={props.onClose}
      />
    </ScrollView>
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
      accessibilityRole={selected === undefined ? "button" : "radio"}
      accessibilityState={{ disabled: !!disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        borderWidth: selected ? 1 : 0,
        borderColor: theme.text,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
