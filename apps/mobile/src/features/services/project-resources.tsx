import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { CrewAssetPicker } from "../crew-assets/asset-picker";
import type { CrewAsset } from "../crew-assets/api";
import { ConversationFile } from "./conversation-file";
import {
  fetchProjectResources,
  addProjectResource,
  removeProjectResource,
  resolveProjectResource,
  resourceInput,
  type ProjectResource,
} from "./project-resources-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function ProjectResources(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0),
    [adding, setAdding] = useState(false),
    [removing, setRemoving] = useState<ProjectResource>(),
    [opening, setOpening] = useState<ProjectResource>();
  const [result, setResult] = useState<{
    revision: number;
    data?: Awaited<ReturnType<typeof fetchProjectResources>>;
    error?: string;
  }>();
  useEffect(() => {
    const c = new AbortController();
    void fetchProjectResources(props.crewId, props.userId, props.generation, c.signal).then(
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
  const refresh = () => {
    setAdding(false);
    setRemoving(undefined);
    setOpening(undefined);
    setRevision((v) => v + 1);
  };
  const visible = result?.revision === revision ? result : undefined;
  if (adding) return <Add {...props} onClose={refresh} />;
  if (removing) return <Remove {...props} resource={removing} onClose={refresh} />;
  if (opening) return <Open {...props} resource={opening} onClose={refresh} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("projectResources.title")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {visible?.data?.canManage && (
        <Button label={t("projectResources.add")} onPress={() => setAdding(true)} />
      )}
      {visible?.data?.resources.length === 0 && (
        <ThemedText>{t("projectResources.empty")}</ThemedText>
      )}
      {visible?.data?.resources.map((resource) => (
        <View key={resource.id} style={{ gap: 6 }}>
          <ThemedText type="smallBold">{resource.title}</ThemedText>
          <ThemedText>
            {t(resource.kind === "link" ? "projectResources.link" : "projectResources.asset")}
          </ThemedText>
          <Button label={t("projectResources.open")} onPress={() => setOpening(resource)} />
          {visible.data?.canManage && (
            <Button label={t("projectResources.remove")} onPress={() => setRemoving(resource)} />
          )}
        </View>
      ))}
      <Button label={t("thread.refresh")} onPress={refresh} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Add(props: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const [kind, setKind] = useState<"link" | "asset">("link"),
    [title, setTitle] = useState(""),
    [url, setUrl] = useState(""),
    [asset, setAsset] = useState<CrewAsset>(),
    [choosing, setChoosing] = useState(false),
    [confirming, setConfirming] = useState(false),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const parsed = resourceInput.safeParse(
    kind === "link"
      ? { kind, url, ...(title.trim() ? { title: title.trim() } : {}) }
      : { kind, assetNodeId: asset?.id, ...(title.trim() ? { title: title.trim() } : {}) }
  );
  const locked = op.busy || attempted || confirming;
  const save = () => {
    if (!parsed.success || op.busy || attempted || props.generation !== getAuthGeneration()) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    void op.run(
      async () => {
        setAttempted(true);
        await addProjectResource(props.crewId, props.userId, props.generation, parsed.data);
      },
      props.onClose,
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  if (choosing)
    return (
      <CrewAssetPicker
        crewId={props.crewId}
        remaining={1}
        excludedIds={[]}
        onClose={() => setChoosing(false)}
        onSelect={(rows) => {
          if (props.generation !== getAuthGeneration()) return;
          const selected = rows[0];
          if (selected) {
            setAsset(selected);
            setTitle(selected.name.slice(0, 180));
          }
          setChoosing(false);
        }}
      />
    );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">{t("projectResources.add")}</ThemedText>
      {(["link", "asset"] as const).map((v) => (
        <Button
          key={v}
          label={t(v === "link" ? "projectResources.link" : "projectResources.asset")}
          selected={v === kind}
          disabled={locked}
          onPress={() => setKind(v)}
        />
      ))}
      <ThemedText>{t("projectResources.name")}</ThemedText>
      <TextInput
        accessibilityLabel={t("projectResources.name")}
        value={title}
        maxLength={180}
        onChangeText={setTitle}
        editable={!locked}
        style={{ color: theme.text, backgroundColor: theme.backgroundElement, padding: 12 }}
      />
      {kind === "link" ? (
        <>
          <ThemedText>{t("projectResources.url")}</ThemedText>
          <TextInput
            accessibilityLabel={t("projectResources.url")}
            value={url}
            onChangeText={setUrl}
            editable={!locked}
            maxLength={2048}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ color: theme.text, backgroundColor: theme.backgroundElement, padding: 12 }}
          />
        </>
      ) : (
        <>
          <ThemedText>{asset?.name}</ThemedText>
          <Button
            label={t("crewAssets.choose")}
            disabled={locked}
            onPress={() => setChoosing(true)}
          />
        </>
      )}
      {confirming && <ThemedText>{t("projectResources.confirmHelp")}</ThemedText>}
      <Button
        label={t(confirming ? "projectResources.confirmAdd" : "projectResources.review")}
        disabled={!parsed.success || attempted || op.busy}
        onPress={save}
      />
      {confirming && (
        <Button
          label={t("memberAccess.edit")}
          disabled={attempted || op.busy}
          onPress={() => setConfirming(false)}
        />
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && error && <ThemedText>{t("projectResources.recheck")}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function Remove(props: Props & { resource: ProjectResource }) {
  const t = useTranslations(),
    op = useAuthFormOperation(`${props.crewId}:${props.resource.id}`, true);
  const [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{props.resource.title}</ThemedText>
      <ThemedText>{t("projectResources.removeHelp")}</ThemedText>
      <Button
        label={t("projectResources.confirmRemove")}
        disabled={op.busy || attempted}
        onPress={() => {
          if (op.busy || attempted || props.generation !== getAuthGeneration()) return;
          void op.run(
            async () => {
              setAttempted(true);
              await removeProjectResource(
                props.crewId,
                props.userId,
                props.generation,
                props.resource
              );
            },
            props.onClose,
            (e) => setError(e instanceof Error ? e.message : String(e))
          );
        }}
      />
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && error && <ThemedText>{t("projectResources.recheck")}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function Open(props: Props & { resource: ProjectResource }) {
  const t = useTranslations();
  const [resolved, setResolved] = useState<Awaited<ReturnType<typeof resolveProjectResource>>>(),
    [error, setError] = useState<string>();
  const op = useAuthFormOperation(`${props.crewId}:${props.resource.id}`, true);
  useEffect(() => {
    const c = new AbortController();
    void resolveProjectResource(
      props.crewId,
      props.userId,
      props.generation,
      props.resource,
      c.signal
    ).then(
      (v) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setResolved(v);
      },
      (e) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, props.resource]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{props.resource.title}</ThemedText>
      {!resolved && !error && <ActivityIndicator />}
      {resolved?.kind === "asset" && <ConversationFile {...resolved} />}
      {resolved?.kind === "link" && (
        <>
          <ThemedText>{resolved.url}</ThemedText>
          <Button
            label={t("projectResources.openLink")}
            disabled={op.busy}
            onPress={() => {
              if (props.generation !== getAuthGeneration()) return;
              void op.run(
                () => Linking.openURL(resolved.url),
                () => {},
                (e) => setError(e instanceof Error ? e.message : String(e))
              );
            }}
          />
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
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
