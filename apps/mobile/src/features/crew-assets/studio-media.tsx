import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ConversationFile } from "../services/conversation-file";
import { useCrewAssets } from "./use-crew-assets";
import { fetchCrewAssetContext } from "./api";
import {
  fetchStudioAssetNode,
  fetchStudioMediaOptions,
  importStudioMedia,
  setStudioMediaLink,
  type StudioAssetNode,
  type StudioMediaOptions,
  type StudioMediaSource,
} from "./studio-media-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function StudioMedia(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Browser key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Browser(props: Props) {
  const t = useTranslations();
  const [folders, setFolders] = useState<{ id: string; name: string; permission: string }[]>([]),
    [target, setTarget] = useState<{ nodeId?: string; parentId: string | null }>();
  const [contextRevision, setContextRevision] = useState(0);
  const [contextResult, setContextResult] = useState<{
    revision: number;
    upload?: boolean;
    view?: boolean;
    error?: string;
  }>();
  const context = contextResult?.revision === contextRevision ? contextResult : undefined;
  const canView = context?.view === true && !context.error;
  const rootUpload = canView && context?.upload;
  const parent = folders.at(-1);
  const listing = useCrewAssets(canView ? String(props.generation) : undefined, props.crewId, {
    parentId: parent?.id,
    source: "all",
  });
  useEffect(() => {
    const c = new AbortController();
    void fetchCrewAssetContext(props.crewId, c.signal).then(
      (context) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setContextResult({
            revision: contextRevision,
            upload: context.capabilities.upload,
            view: context.capabilities.view,
          });
      },
      (e) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setContextResult({
            revision: contextRevision,
            error: e instanceof Error ? e.message : String(e),
          });
      }
    );
    return () => c.abort();
  }, [props.crewId, props.generation, contextRevision]);
  const refresh = () => {
    listing.refresh();
    setContextRevision((v) => v + 1);
  };
  const back = () => {
    setTarget(undefined);
    refresh();
  };
  if (!canView)
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <ThemedText type="smallBold">{t("studioMedia.title")}</ThemedText>
        {!context ? (
          <ActivityIndicator />
        ) : (
          <ThemedText accessibilityRole="alert">
            {context.error || t("studioMedia.accessDenied")}
          </ThemedText>
        )}
        <Button label={t("thread.refresh")} onPress={refresh} />
        <Button label={t("crewTasks.back")} onPress={props.onClose} />
      </ScrollView>
    );
  if (target) return <Selection {...props} target={target} onClose={back} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("studioMedia.title")}</ThemedText>
      <ThemedText>{folders.map((f) => f.name).join(" / ") || t("studioMedia.root")}</ThemedText>
      {!!parent && (
        <Button label={t("crewAssets.back")} onPress={() => setFolders((f) => f.slice(0, -1))} />
      )}
      <Button
        label={t("studioMedia.importHere")}
        disabled={
          listing.loading ||
          !!listing.error ||
          !(parent ? parent.permission !== "view" : rootUpload)
        }
        onPress={() => setTarget({ parentId: parent?.id ?? null })}
      />
      {listing.items.map((row) => (
        <Button
          key={row.id}
          label={row.name}
          disabled={
            listing.loading ||
            !!listing.error ||
            (row.kind === "file" && row.effectivePermission !== "manage")
          }
          onPress={() =>
            row.kind === "folder"
              ? setFolders((f) => [
                  ...f,
                  { id: row.id, name: row.name, permission: row.effectivePermission },
                ])
              : setTarget({ nodeId: row.id, parentId: parent?.id ?? null })
          }
        />
      ))}
      {listing.loading && <ActivityIndicator />}
      {listing.error && <ThemedText accessibilityRole="alert">{listing.error}</ThemedText>}
      {listing.hasMore && (
        <Button
          label={t("crewAssets.more")}
          disabled={listing.loading}
          onPress={listing.error ? listing.retry : listing.loadMore}
        />
      )}
      {contextResult?.revision === contextRevision && contextResult.error && (
        <ThemedText accessibilityRole="alert">{contextResult.error}</ThemedText>
      )}
      <Button label={t("thread.refresh")} onPress={refresh} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Selection(props: Props & { target: { nodeId?: string; parentId: string | null } }) {
  const t = useTranslations();
  const [source, setSource] = useState<StudioMediaSource>({
    projectId: null,
    storyProjectId: null,
  });
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([source, revision]);
  const [result, setResult] = useState<{
    key: string;
    options?: StudioMediaOptions;
    node?: StudioAssetNode;
    error?: string;
  }>();
  useEffect(() => {
    const c = new AbortController();
    void (async () => {
      const node = props.target.nodeId
        ? await fetchStudioAssetNode(
            props.crewId,
            props.userId,
            props.generation,
            props.target.nodeId,
            c.signal
          )
        : undefined;
      if (node && (node.kind !== "file" || node.effectivePermission !== "manage"))
        throw new Error("Manage permission on this file is required.");
      const options = await fetchStudioMediaOptions(
        props.crewId,
        props.userId,
        props.generation,
        source,
        c.signal
      );
      if (!c.signal.aborted && props.generation === getAuthGeneration())
        setResult({ key, node, options });
    })().catch((e) => {
      if (!c.signal.aborted && props.generation === getAuthGeneration())
        setResult({ key, error: e instanceof Error ? e.message : String(e) });
    });
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, props.target.nodeId, source, key]);
  const visible = result?.key === key ? result : undefined;
  if (visible?.options)
    return (
      <Form
        key={key}
        {...props}
        options={visible.options}
        node={visible.node}
        source={source}
        setSource={setSource}
        refresh={() => setRevision((v) => v + 1)}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("studioMedia.title")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      <Button label={t("thread.refresh")} onPress={() => setRevision((v) => v + 1)} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Form(
  props: Props & {
    target: { parentId: string | null };
    options: StudioMediaOptions;
    node?: StudioAssetNode;
    source: StudioMediaSource;
    setSource: (s: StudioMediaSource) => void;
    refresh: () => void;
  }
) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState("");
  const [armed, setArmed] = useState<"save" | "unlink">(),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const locked = attempted || op.busy;
  const actOn = (action: "save" | "unlink") => {
    if (locked || props.generation !== getAuthGeneration()) return;
    if (action === "save" && (!selected.length || !props.options.workspaceId)) return;
    if (action === "unlink" && !props.node?.linkedStudio) return;
    if (armed !== action) {
      setArmed(action);
      return;
    }
    void op.run(
      async () => {
        setAttempted(true);
        if (props.node)
          return setStudioMediaLink(
            props.crewId,
            props.userId,
            props.generation,
            props.node,
            props.options.workspaceId,
            props.source,
            action === "unlink" ? null : selected[0]!
          );
        return importStudioMedia(
          props.crewId,
          props.userId,
          props.generation,
          props.options.workspaceId!,
          props.source,
          props.target.parentId,
          selected
        );
      },
      props.onClose,
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">
        {t(props.node ? "studioMedia.bind" : "studioMedia.importHere")}
      </ThemedText>
      {props.node && <ThemedText>{props.node.name}</ThemedText>}
      <ThemedText>{t(props.node ? "studioMedia.bindHelp" : "studioMedia.importHelp")}</ThemedText>
      {!props.options.workspaceId && <ThemedText>{t("studioMedia.noWorkspace")}</ThemedText>}
      <Button
        label={t("studioMedia.allProjects")}
        selected={!props.source.projectId && !props.source.storyProjectId}
        disabled={locked}
        onPress={() => props.setSource({ projectId: null, storyProjectId: null })}
      />
      {props.options.projects.map((p) => (
        <Button
          key={`${p.kind}:${p.id}`}
          label={`${p.name} · ${p.kind}`}
          selected={
            p.id === (p.kind === "canvas" ? props.source.projectId : props.source.storyProjectId)
          }
          disabled={locked}
          onPress={() =>
            props.setSource({
              projectId: p.kind === "canvas" ? p.id : null,
              storyProjectId: p.kind === "story" ? p.id : null,
            })
          }
        />
      ))}
      <TextInput
        accessibilityLabel={t("studioMedia.search")}
        value={query}
        onChangeText={setQuery}
        editable={!locked}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>
        {t("crewAssets.selected")} {selected.length} / {props.node ? 1 : 40}
      </ThemedText>
      {props.options.items
        .filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()))
        .map((item) => (
          <View key={item.id}>
            <Button
              label={item.name}
              selected={selected.includes(item.id)}
              disabled={
                locked || (!props.node && selected.length >= 40 && !selected.includes(item.id))
              }
              onPress={() => {
                setArmed(undefined);
                setSelected((s) =>
                  s.includes(item.id)
                    ? s.filter((id) => id !== item.id)
                    : props.node
                      ? [item.id]
                      : [...s, item.id]
                );
              }}
            />
            {!locked && (
              <ConversationFile
                mediaAssetId={item.id}
                name={item.name}
                mediaKind={item.kind}
                contentType={item.contentType}
              />
            )}
          </View>
        ))}
      {!props.options.items.length && <ThemedText>{t("studioMedia.empty")}</ThemedText>}
      {armed && (
        <ThemedText>
          {t(armed === "unlink" ? "studioMedia.unlinkHelp" : "studioMedia.confirmHelp")}
        </ThemedText>
      )}
      <Button
        label={t(armed === "save" ? "studioMedia.confirm" : "studioMedia.save")}
        disabled={locked || !selected.length || !props.options.workspaceId}
        onPress={() => actOn("save")}
      />
      {props.node?.linkedStudio && (
        <Button
          label={t(armed === "unlink" ? "studioMedia.confirmUnlink" : "studioMedia.unlink")}
          disabled={locked}
          onPress={() => actOn("unlink")}
        />
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {error && attempted && <ThemedText>{t("studioMedia.recheck")}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      <Button label={t("thread.refresh")} disabled={op.busy} onPress={props.refresh} />
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onClose} />
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
      accessibilityRole={selected === undefined ? "button" : "checkbox"}
      accessibilityState={{ disabled: !!disabled, checked: selected }}
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
