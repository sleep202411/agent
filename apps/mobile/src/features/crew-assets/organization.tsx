import { ConversationFile } from "../services/conversation-file";
import { AssetPermissions } from "./permissions";
import { AssetTrash, AssetLifecycleAction } from "./lifecycle";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useCrewAssets } from "./use-crew-assets";
import { fetchCrewAssetContext } from "./api";
import {
  assetName,
  createOrganizationFolder,
  eligibleMoveFolders,
  fetchOrganizationFolders,
  fetchOrganizationNode,
  setOrganizationFavorite,
  updateOrganizationNode,
  type OrganizationNode,
  type OrganizationFolder,
} from "./organization-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function AssetOrganization(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Browser key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Browser(props: Props) {
  const t = useTranslations(),
    theme = useTheme();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [sort, setSort] = useState<"modified" | "name" | "size">("modified");
  const clearSearch = () => {
    setSearch("");
    setQuery("");
  };
  const [showTrash, setShowTrash] = useState(false);
  const [path, setPath] = useState<{ id: string; name: string }[]>([]),
    [selection, setSelection] = useState<string>();
  const [source, setSource] = useState<"all" | "recent" | "favorites">("all");
  const listing = useCrewAssets(String(props.generation), props.crewId, {
    source,
    query: query || undefined,
    sort,
    parentId: source === "all" ? path.at(-1)?.id : undefined,
  });
  const back = () => {
    setSelection(undefined);
    listing.refresh();
  };
  if (showTrash)
    return (
      <AssetTrash
        {...props}
        onClose={() => {
          setShowTrash(false);
          listing.refresh();
        }}
      />
    );
  if (selection)
    return (
      <Editor
        {...props}
        nodeId={selection === "new" ? undefined : selection}
        initialParentId={path.at(-1)?.id ?? null}
        onClose={back}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("assetOrganization.title")}</ThemedText>
      <Button label={t("assetLifecycle.trash")} onPress={() => setShowTrash(true)} />
      {(["all", "recent", "favorites"] as const).map((value) => (
        <Button
          key={value}
          label={t(`crewAssets.source.${value}`)}
          selected={source === value}
          onPress={() => {
            setSource(value);
            setPath([]);
            clearSearch();
          }}
        />
      ))}
      <TextInput
        accessibilityLabel={t("crewAssets.search")}
        placeholder={t("crewAssets.search")}
        placeholderTextColor={theme.text}
        value={search}
        editable
        maxLength={256}
        onChangeText={setSearch}
        onSubmitEditing={() => setQuery(search.trim())}
        style={{ color: theme.text, padding: 12, backgroundColor: theme.backgroundElement }}
      />
      <Button label={t("crewAssets.searchAction")} onPress={() => setQuery(search.trim())} />
      {!!(search || query) && (
        <Button label={t("assetOrganization.clearSearch")} onPress={clearSearch} />
      )}
      <ThemedText>{t("assetOrganization.sort")}</ThemedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(["modified", "name", "size"] as const).map((value) => (
          <Button
            key={value}
            label={t(`assetOrganization.sort.${value}`)}
            selected={sort === value}
            onPress={() => setSort(value)}
          />
        ))}
      </View>
      <ThemedText>{path.map((p) => p.name).join(" / ") || t("studioMedia.root")}</ThemedText>
      {!!path.length && (
        <Button
          label={t("crewAssets.back")}
          onPress={() => {
            setPath((p) => p.slice(0, -1));
            clearSearch();
          }}
        />
      )}
      {source === "all" && (
        <Button label={t("assetOrganization.create")} onPress={() => setSelection("new")} />
      )}
      {listing.items.map((row) => (
        <View key={row.id} style={{ gap: 6 }}>
          {row.kind === "folder" && (
            <Button
              label={row.name}
              onPress={() => {
                setSource("all");
                setPath((p) => [...p, { id: row.id, name: row.name }]);
                clearSearch();
              }}
            />
          )}
          {row.kind === "file" && row.media && (
            <ConversationFile
              key={row.media.id}
              mediaAssetId={row.media.id}
              name={row.name}
              mediaKind={row.media.kind}
              contentType={row.media.contentType}
            />
          )}
          <Button
            label={`${t("assetOrganization.manage")}: ${row.name}`}
            onPress={() => setSelection(row.id)}
          />
        </View>
      ))}
      {!listing.loading && !listing.error && !listing.hasMore && listing.items.length === 0 && (
        <ThemedText>{t("crewAssets.empty")}</ThemedText>
      )}
      {listing.loading && <ActivityIndicator />}
      {listing.error && <ThemedText accessibilityRole="alert">{listing.error}</ThemedText>}
      {listing.hasMore && (
        <Button
          label={t("crewAssets.more")}
          disabled={listing.loading}
          onPress={listing.error ? listing.retry : listing.loadMore}
        />
      )}
      <Button label={t("thread.refresh")} onPress={listing.refresh} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Editor(props: Props & { nodeId?: string; initialParentId: string | null }) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    revision: number;
    node?: OrganizationNode;
    folders?: OrganizationFolder[];
    rootUpload?: boolean;
    error?: string;
  }>();
  useEffect(() => {
    const c = new AbortController();
    void (async () => {
      const node = props.nodeId
        ? await fetchOrganizationNode(
            props.crewId,
            props.userId,
            props.generation,
            props.nodeId,
            c.signal
          )
        : undefined;
      const folders = await fetchOrganizationFolders(
        props.crewId,
        props.userId,
        props.generation,
        c.signal
      );
      const context = await fetchCrewAssetContext(props.crewId, c.signal);
      if (!c.signal.aborted && props.generation === getAuthGeneration())
        setResult({ revision, node, folders, rootUpload: context.capabilities.upload });
    })().catch((e) => {
      if (!c.signal.aborted && props.generation === getAuthGeneration())
        setResult({ revision, error: e instanceof Error ? e.message : String(e) });
    });
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, props.nodeId, revision]);
  const visible = result?.revision === revision ? result : undefined;
  if (visible?.folders)
    return (
      <Form
        key={revision}
        {...props}
        node={visible.node}
        folders={visible.folders}
        rootUpload={!!visible.rootUpload}
        refresh={() => setRevision((v) => v + 1)}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      <Button label={t("thread.refresh")} onPress={() => setRevision((v) => v + 1)} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Form(
  props: Props & {
    node?: OrganizationNode;
    folders: OrganizationFolder[];
    rootUpload: boolean;
    initialParentId: string | null;
    refresh: () => void;
  }
) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const [showPermissions, setShowPermissions] = useState(false);
  const [showLifecycle, setShowLifecycle] = useState(false);
  const [name, setName] = useState(props.node?.name ?? ""),
    [parentId, setParentId] = useState(props.node ? props.node.parentId : props.initialParentId);
  const [attempted, setAttempted] = useState(false),
    [armed, setArmed] = useState(false),
    [error, setError] = useState<string>();
  const locked = attempted || op.busy;
  const canEdit = !props.node || ["edit", "manage"].includes(props.node.effectivePermission);
  const folders = eligibleMoveFolders(
    props.folders,
    props.node?.kind === "folder" ? props.node.id : undefined
  );
  const parsed = assetName.safeParse(name);
  const parentUnchanged = !!props.node && parentId === props.node.parentId;
  const destinationValid =
    parentUnchanged ||
    (parentId === null ? props.rootUpload : folders.some((f) => f.id === parentId));
  const changed =
    parsed.success &&
    destinationValid &&
    canEdit &&
    (!props.node || parsed.data !== props.node.name || parentId !== props.node.parentId);
  const actOn = (favorite = false) => {
    if (locked || props.generation !== getAuthGeneration()) return;
    if (favorite && !props.node) return;
    if (!favorite && (!changed || !parsed.success)) return;
    if (!favorite && !armed) {
      setArmed(true);
      return;
    }
    void op.run(
      async () => {
        setAttempted(true);
        if (favorite && props.node)
          return setOrganizationFavorite(
            props.crewId,
            props.userId,
            props.generation,
            props.node.id,
            !props.node.favorite
          );
        if (!parsed.success) return;
        return props.node
          ? updateOrganizationNode(props.crewId, props.userId, props.generation, props.node, {
              name: parsed.data,
              parentId,
            })
          : createOrganizationFolder(
              props.crewId,
              props.userId,
              props.generation,
              parsed.data,
              parentId
            );
      },
      props.onClose,
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  if (showPermissions && props.node)
    return <AssetPermissions {...props} nodeId={props.node.id} onClose={props.onClose} />;
  if (showLifecycle && props.node)
    return <AssetLifecycleAction {...props} node={props.node} onClose={props.onClose} />;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">
        {t(props.node ? "assetOrganization.manage" : "assetOrganization.create")}
      </ThemedText>
      <ThemedText>{t("assetOrganization.name")}</ThemedText>
      <TextInput
        accessibilityLabel={t("assetOrganization.name")}
        value={name}
        maxLength={256}
        editable={!locked && canEdit}
        onChangeText={(v) => {
          setName(v);
          setArmed(false);
        }}
        style={{ color: theme.text, padding: 12 }}
      />
      <ThemedText>{t("assetOrganization.destination")}</ThemedText>
      <Button
        label={t("studioMedia.root")}
        selected={parentId === null}
        disabled={locked || !canEdit || !props.rootUpload}
        onPress={() => {
          setParentId(null);
          setArmed(false);
        }}
      />
      {folders.map((folder) => (
        <Button
          key={folder.id}
          label={folder.name}
          selected={parentId === folder.id}
          disabled={locked || !canEdit}
          onPress={() => {
            setParentId(folder.id);
            setArmed(false);
          }}
        />
      ))}
      {props.node && parentId && !folders.some((f) => f.id === parentId) && (
        <ThemedText>{t("assetOrganization.keepParent")}</ThemedText>
      )}
      {armed && <ThemedText>{t("assetOrganization.confirmHelp")}</ThemedText>}
      <Button
        label={t(armed ? "assetOrganization.confirm" : "assetOrganization.save")}
        disabled={locked || !changed}
        onPress={() => actOn()}
      />
      {props.node && (
        <Button
          label={t(
            props.node.favorite ? "assetOrganization.unfavorite" : "assetOrganization.favorite"
          )}
          disabled={locked}
          onPress={() => actOn(true)}
        />
      )}
      {props.node && (
        <Button
          label={t("assetPermissions.title")}
          disabled={locked}
          onPress={() => setShowPermissions(true)}
        />
      )}
      {props.node && canEdit && (
        <Button
          label={t("assetLifecycle.moveTrash")}
          disabled={locked}
          onPress={() => setShowLifecycle(true)}
        />
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {error && attempted && <ThemedText>{t("assetOrganization.recheck")}</ThemedText>}
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
