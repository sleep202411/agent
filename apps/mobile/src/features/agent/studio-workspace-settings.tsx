import { Image } from "expo-image";
import { appEnv } from "@/config/app-env";
import {
  workspaceIconPresets,
  workspaceIconUrl,
  type WorkspaceIconPreset,
} from "./workspace-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
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
import { SubscriptionPanel } from "@/features/paywall/components/subscription-panel";
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
  const [icon, setIcon] = useState<WorkspaceIconPreset | undefined>(
    snapshot ? undefined : "aurora"
  );
  const avatarUrl = icon ? workspaceIconUrl(icon, appEnv.appRegion) : snapshot?.avatarUrl;
  const [showPlan, setShowPlan] = useState(false);
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
  const valid = workspaceDraftSchema.safeParse({ name, description, icon }).success;
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
        await updateStudioWorkspace(
          snapshot,
          { name, description, icon },
          props.generation,
          c.signal
        );
      else {
        const created = await createStudioWorkspace({ name, description, icon }, props.generation);
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
      <ThemedText>{t("studioWorkspace.icon")}</ThemedText>
      {avatarUrl && (
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: 56, height: 56, borderRadius: 8 }}
          contentFit="cover"
          accessibilityLabel={t("studioWorkspace.icon")}
        />
      )}
      {editable && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {workspaceIconPresets.map((preset) => {
            const url = workspaceIconUrl(preset, appEnv.appRegion);
            const selected = avatarUrl === url;
            return (
              <Pressable
                key={preset}
                accessibilityRole="radio"
                accessibilityLabel={t(`studioWorkspace.icon_${preset}`)}
                accessibilityState={{ checked: selected, disabled: locked }}
                disabled={locked}
                onPress={() => setIcon(preset)}
                style={{
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 2,
                  borderColor: selected ? theme.brand : theme.backgroundElement,
                  backgroundColor: theme.backgroundElement,
                }}
              >
                <Image
                  source={{ uri: url }}
                  style={{ width: 40, height: 40, borderRadius: 8 }}
                  contentFit="cover"
                />
                <ThemedText type="small">{t(`studioWorkspace.icon_${preset}`)}</ThemedText>
              </Pressable>
            );
          })}
        </View>
      )}
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
      {snapshot?.accessScope === "workspace" && (
        <>
          <Action
            label={t("subscription.title")}
            disabled={busy}
            onPress={() => setShowPlan((value) => !value)}
          />
          {showPlan && (
            <SubscriptionPanel
              generation={props.generation}
              workspaceId={snapshot.id}
              canManage={
                ["owner", "admin", "billing"].includes(snapshot.role ?? "") &&
                snapshot.status === "active" &&
                !locked
              }
            />
          )}
        </>
      )}
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
