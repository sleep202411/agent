import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, ScrollView, TextInput } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  canDeleteWorkspace,
  canEditWorkspace,
  createStudioWorkspace,
  deleteStudioWorkspace,
  fetchWorkspaceSettings,
  updateStudioWorkspace,
  workspaceDraftSchema,
  WorkspaceSettingsWriteError,
  type StudioWorkspaceSettings,
} from "./api/studio-workspace-settings-api";
type Props = {
  workspaceId?: string;
  generation: number;
  onClose: () => void;
  onDone: (workspaceId?: string) => void;
};
export function StudioWorkspaceSettingsScreen(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.workspaceId ?? "new"}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    revision: number;
    workspace?: StudioWorkspaceSettings;
    error?: string;
  }>();
  useEffect(() => {
    const c = new AbortController();
    void Promise.resolve().then(async () => {
      try {
        const workspace = props.workspaceId
          ? await fetchWorkspaceSettings(props.workspaceId, props.generation, c.signal)
          : undefined;
        if (!c.signal.aborted) setResult({ revision, workspace });
      } catch (e) {
        if (!c.signal.aborted)
          setResult({ revision, error: e instanceof Error ? e.message : String(e) });
      }
    });
    return () => c.abort();
  }, [props.workspaceId, props.generation, revision]);
  if (result?.revision === revision && !result.error)
    return (
      <Form
        key={revision}
        {...props}
        snapshot={result.workspace}
        reload={() => setRevision((v) => v + 1)}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {result?.error ? (
        <ThemedText accessibilityRole="alert">{result.error}</ThemedText>
      ) : (
        <ActivityIndicator />
      )}
      <Action label={t("thread.refresh")} onPress={() => setRevision((v) => v + 1)} />
      <Action label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Form({
  snapshot,
  reload,
  ...props
}: Props & { snapshot?: StudioWorkspaceSettings; reload: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const [name, setName] = useState(snapshot?.name ?? ""),
    [description, setDescription] = useState(snapshot?.description ?? "");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [done, setDone] = useState(false),
    [deleting, setDeleting] = useState(false);
  const operation = useRef(false),
    alive = useRef(true),
    pending = useRef<AbortController | null>(null);
  const { onClose } = props;
  const current = () => alive.current && props.generation === getAuthGeneration();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active) pending.current?.abort();
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!operation.current) onClose();
      return true;
    });
    return () => sub.remove();
  }, [active, onClose]);
  const editable = !snapshot || canEditWorkspace(snapshot);
  const locked = busy || uncertain || done;
  const valid = workspaceDraftSchema.safeParse({ name, description }).success;
  async function submit(remove: boolean) {
    if (operation.current || locked || !active || !current() || (!remove && (!editable || !valid)))
      return;
    if (remove && (!snapshot || !canDeleteWorkspace(snapshot) || confirmation !== snapshot.name))
      return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    const c = new AbortController();
    pending.current = c;
    try {
      if (remove) await deleteStudioWorkspace(snapshot!, confirmation, props.generation, c.signal);
      else if (snapshot)
        await updateStudioWorkspace(snapshot, { name, description }, props.generation, c.signal);
      else {
        const created = await createStudioWorkspace({ name, description }, props.generation);
        if (current()) {
          setDone(true);
          if (!c.signal.aborted) props.onDone(created.id);
        }
        return;
      }
      if (current()) {
        setDone(true);
        if (!c.signal.aborted) props.onDone(remove ? undefined : snapshot!.id);
      }
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : String(e));
        if (e instanceof WorkspaceSettingsWriteError) setUncertain(true);
      }
    } finally {
      operation.current = false;
      if (current()) setBusy(false);
    }
  }
  if (!active) return null;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">
        {t(snapshot ? "studioWorkspace.settings" : "studioWorkspace.create")}
      </ThemedText>
      {!editable && <ThemedText>{t("studioWorkspace.readOnly")}</ThemedText>}
      <ThemedText>{t("studioWorkspace.name")}</ThemedText>
      <TextInput
        accessibilityLabel={t("studioWorkspace.name")}
        value={name}
        onChangeText={setName}
        maxLength={120}
        editable={editable && !locked}
        style={{
          color: theme.text,
          padding: 12,
          backgroundColor: theme.backgroundElement,
          borderRadius: 8,
        }}
      />
      <ThemedText>{t("studioWorkspace.description")}</ThemedText>
      <TextInput
        accessibilityLabel={t("studioWorkspace.description")}
        value={description}
        onChangeText={setDescription}
        maxLength={500}
        multiline
        editable={editable && !locked}
        style={{
          color: theme.text,
          padding: 12,
          backgroundColor: theme.backgroundElement,
          borderRadius: 8,
          minHeight: 90,
        }}
      />
      {editable && (
        <Action
          label={t(snapshot ? "studioWorkspace.save" : "studioWorkspace.create")}
          disabled={locked || !valid}
          onPress={() => void submit(false)}
        />
      )}
      {snapshot?.isDefault && <ThemedText>{t("studioWorkspace.default")}</ThemedText>}
      {snapshot && canDeleteWorkspace(snapshot) && (
        <>
          <Action
            label={t("studioWorkspace.delete")}
            disabled={locked}
            onPress={() => setDeleting((v) => !v)}
          />
          {deleting && (
            <>
              <ThemedText>{t("studioWorkspace.deleteHelp")}</ThemedText>
              <ThemedText>{snapshot.name}</ThemedText>
              <TextInput
                accessibilityLabel={t("studioWorkspace.confirmName")}
                value={confirmation}
                onChangeText={setConfirmation}
                editable={!locked}
                style={{
                  color: theme.text,
                  padding: 12,
                  backgroundColor: theme.backgroundElement,
                  borderRadius: 8,
                }}
              />
              <Action
                label={t("studioWorkspace.confirmDelete")}
                disabled={locked || confirmation !== snapshot.name}
                onPress={() => void submit(true)}
              />
            </>
          )}
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {uncertain && <ThemedText>{t("studioWorkspace.uncertain")}</ThemedText>}
      {done && <ThemedText>{t("studioWorkspace.done")}</ThemedText>}
      {snapshot && <Action label={t("studioWorkspace.reload")} disabled={busy} onPress={reload} />}
      {busy && <ActivityIndicator />}
      <Action label={t("crewTasks.back")} disabled={busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function Action({
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
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
