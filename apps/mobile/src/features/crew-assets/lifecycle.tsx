import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import type { OrganizationNode } from "./organization-api";
import {
  fetchAssetTrash,
  permanentlyDeleteOrganizationAsset,
  restoreOrganizationAsset,
  trashOrganizationAsset,
  type TrashedAsset,
} from "./lifecycle-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function AssetTrash(props: Props) {
  const [revision, setRevision] = useState(0);
  return props.generation === getAuthGeneration() ? (
    <TrashList
      key={`${props.crewId}:${props.userId}:${props.generation}:${revision}`}
      {...props}
      refresh={() => setRevision((v) => v + 1)}
    />
  ) : null;
}
function TrashList(props: Props & { refresh: () => void }) {
  const t = useTranslations();
  const [selection, setSelection] = useState<TrashedAsset>();
  const [state, setState] = useState<{
    items: TrashedAsset[];
    loading: boolean;
    more: boolean;
    error?: string;
  }>({ items: [], loading: true, more: true });
  const session = useRef<
    | {
        controller: AbortController;
        busy: boolean;
        cursor: string | null;
        seen: Set<string>;
        items: TrashedAsset[];
        more: boolean;
      }
    | undefined
  >(undefined);
  const load = useCallback(async () => {
    const s = session.current;
    if (!s || s.busy || !s.more || s.controller.signal.aborted) return;
    s.busy = true;
    setState((v) => ({ ...v, loading: true, error: undefined }));
    try {
      const page = await fetchAssetTrash(
        props.crewId,
        props.userId,
        props.generation,
        s.cursor,
        s.controller.signal
      );
      if (s.controller.signal.aborted || props.generation !== getAuthGeneration()) return;
      if (page.nextCursor && s.seen.has(page.nextCursor))
        throw new Error("Asset trash pagination did not advance.");
      if (page.nextCursor) s.seen.add(page.nextCursor);
      s.cursor = page.nextCursor;
      s.more = !!page.nextCursor;
      s.items = Array.from(new Map([...s.items, ...page.items].map((r) => [r.id, r])).values());
      setState({ items: s.items, loading: false, more: s.more });
    } catch (e) {
      if (!s.controller.signal.aborted && props.generation === getAuthGeneration())
        setState({
          items: s.items,
          loading: false,
          more: s.more,
          error: e instanceof Error ? e.message : String(e),
        });
    } finally {
      s.busy = false;
    }
  }, [props.crewId, props.userId, props.generation]);
  useEffect(() => {
    const s = {
      controller: new AbortController(),
      busy: false,
      cursor: null,
      seen: new Set<string>(),
      items: [] as TrashedAsset[],
      more: true,
    };
    session.current = s;
    void load();
    return () => {
      s.controller.abort();
      session.current = undefined;
    };
  }, [load]);
  if (selection)
    return <AssetLifecycleAction {...props} node={selection} onClose={props.refresh} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("assetLifecycle.trash")}</ThemedText>
      {state.items.map((row) => (
        <Button
          key={row.id}
          label={row.name}
          disabled={state.loading || !!state.error}
          onPress={() => setSelection(row)}
        />
      ))}
      {state.loading && <ActivityIndicator />}
      {state.error && <ThemedText accessibilityRole="alert">{state.error}</ThemedText>}
      {!state.loading && !state.error && !state.items.length && !state.more && (
        <ThemedText>{t("assetLifecycle.empty")}</ThemedText>
      )}
      {state.more && (
        <Button
          label={t(state.error ? "thread.refresh" : "crewAssets.more")}
          disabled={state.loading}
          onPress={() => void load()}
        />
      )}
      <Button label={t("assetLifecycle.reload")} disabled={state.loading} onPress={props.refresh} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
export function AssetLifecycleAction(props: Props & { node: OrganizationNode | TrashedAsset }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${props.crewId}:${props.node.id}`, true);
  const [armed, setArmed] = useState<"trash" | "restore" | "delete">(),
    [typed, setTyped] = useState("");
  const [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const locked = attempted || op.busy;
  const actOn = (action: "trash" | "restore" | "delete") => {
    if (locked || props.generation !== getAuthGeneration()) return;
    if (armed !== action) {
      setArmed(action);
      setTyped("");
      return;
    }
    if (action === "delete" && typed !== props.node.name) return;
    void op.run(
      async () => {
        setAttempted(true);
        if (action === "trash" && props.node.status === "active")
          return trashOrganizationAsset(props.crewId, props.userId, props.generation, props.node);
        if (props.node.status !== "trashed")
          throw new Error("Refresh the asset before continuing.");
        return action === "restore"
          ? restoreOrganizationAsset(props.crewId, props.userId, props.generation, props.node)
          : permanentlyDeleteOrganizationAsset(
              props.crewId,
              props.userId,
              props.generation,
              props.node
            );
      },
      props.onClose,
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  const edit = ["edit", "manage"].includes(props.node.effectivePermission);
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">{props.node.name}</ThemedText>
      {props.node.status === "active" ? (
        <>
          <ThemedText>{t("assetLifecycle.trashHelp")}</ThemedText>
          <Button
            label={t(
              armed === "trash" ? "assetLifecycle.confirmTrash" : "assetLifecycle.moveTrash"
            )}
            disabled={locked || !edit}
            onPress={() => actOn("trash")}
          />
        </>
      ) : (
        <>
          <ThemedText>{t("assetLifecycle.restoreHelp")}</ThemedText>
          <Button
            label={t(
              armed === "restore" ? "assetLifecycle.confirmRestore" : "assetLifecycle.restore"
            )}
            disabled={locked || !edit}
            onPress={() => actOn("restore")}
          />
          {props.node.effectivePermission === "manage" && (
            <>
              <ThemedText>{t("assetLifecycle.deleteHelp")}</ThemedText>
              {armed === "delete" && (
                <>
                  <ThemedText>
                    {t("assetLifecycle.typeName").replace("{name}", props.node.name)}
                  </ThemedText>
                  <TextInput
                    accessibilityLabel={t("assetLifecycle.name")}
                    value={typed}
                    onChangeText={setTyped}
                    editable={!locked}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{ color: theme.text, padding: 12 }}
                  />
                </>
              )}
              <Button
                label={t(
                  armed === "delete" ? "assetLifecycle.confirmDelete" : "assetLifecycle.delete"
                )}
                disabled={locked || (armed === "delete" && typed !== props.node.name)}
                onPress={() => actOn("delete")}
              />
            </>
          )}
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {error && attempted && <ThemedText>{t("assetLifecycle.recheck")}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
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
