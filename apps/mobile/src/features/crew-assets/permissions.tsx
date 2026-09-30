import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useUserDisplays } from "../services/user-displays";
import {
  fetchAssetPermissions,
  fetchAssetPermissionMembers,
  fetchAssetPermissionEvents,
  saveAssetPermissions,
  type AssetGrant,
  type PermissionSnapshot,
  type PermissionEvent,
} from "./permissions-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  nodeId: string;
  onClose: () => void;
};
export function AssetPermissions(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session
      key={`${props.crewId}:${props.nodeId}:${props.userId}:${props.generation}`}
      {...props}
    />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    revision: number;
    permissions?: PermissionSnapshot;
    globalManage?: boolean;
    members?: string[];
    error?: string;
  }>();
  useEffect(() => {
    const c = new AbortController();
    void (async () => {
      const data = await fetchAssetPermissions(
        props.crewId,
        props.userId,
        props.generation,
        props.nodeId,
        c.signal
      );
      const members = data.permissions.canManage
        ? await fetchAssetPermissionMembers(props.crewId, props.userId, props.generation, c.signal)
        : [];
      if (!c.signal.aborted && props.generation === getAuthGeneration())
        setResult({ revision, ...data, members });
    })().catch((e) => {
      if (!c.signal.aborted && props.generation === getAuthGeneration())
        setResult({ revision, error: e instanceof Error ? e.message : String(e) });
    });
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, props.nodeId, revision]);
  const visible = result?.revision === revision ? result : undefined;
  const refresh = () => setRevision((v) => v + 1);
  if (visible?.permissions && visible.members)
    return (
      <Form
        key={revision}
        {...props}
        snapshot={visible.permissions}
        globalManage={!!visible.globalManage}
        members={visible.members}
        refresh={refresh}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("assetPermissions.title")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      <Button label={t("thread.refresh")} onPress={refresh} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Form(
  props: Props & {
    snapshot: PermissionSnapshot;
    globalManage: boolean;
    members: string[];
    refresh: () => void;
  }
) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${props.crewId}:${props.nodeId}`, true);
  const [mode, setMode] = useState(props.snapshot.accessMode);
  const [grants, setGrants] = useState<AssetGrant[]>(props.snapshot.grants);
  const [query, setQuery] = useState("");
  const [armed, setArmed] = useState(false),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const [history, setHistory] = useState(false);
  const displays = useUserDisplays(String(props.generation), [
    ...new Set([...props.members, ...grants.map((g) => g.userId)]),
  ]);
  const label = (id: string) => `${displays?.get(id)?.nickname || id} (${id})`;
  const locked = op.busy || attempted || !props.snapshot.canManage;
  const effective = mode === "inherit" ? [] : grants;
  const changed =
    mode !== props.snapshot.accessMode ||
    effective.length !== props.snapshot.grants.length ||
    effective.some(
      (g) =>
        !props.snapshot.grants.some((s) => s.userId === g.userId && s.permission === g.permission)
    );
  const edit = (id: string, permission: AssetGrant["permission"] | "none") => {
    setArmed(false);
    setGrants((old) => [
      ...old.filter((g) => g.userId !== id),
      ...(permission === "none" ? [] : [{ userId: id, permission }]),
    ]);
  };
  const save = () => {
    if (locked || !changed || props.generation !== getAuthGeneration()) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    void op.run(
      async () => {
        setAttempted(true);
        return saveAssetPermissions(
          props.crewId,
          props.userId,
          props.generation,
          props.nodeId,
          props.snapshot,
          { accessMode: mode, grants: effective }
        );
      },
      props.onClose,
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  if (history) return <History {...props} onClose={() => setHistory(false)} />;
  const ids = [...new Set([...props.members, ...grants.map((g) => g.userId)])].filter((id) =>
    label(id).toLowerCase().includes(query.toLowerCase())
  );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">{t("assetPermissions.title")}</ThemedText>
      <ThemedText>
        {t("assetPermissions.effective")}:{" "}
        {t(`assetPermissions.${props.snapshot.effectivePermission}`)}
      </ThemedText>
      {(["inherit", "restricted"] as const).map((value) => (
        <Button
          key={value}
          label={t(`assetPermissions.${value}`)}
          selected={mode === value}
          disabled={locked}
          onPress={() => {
            setMode(value);
            setArmed(false);
          }}
        />
      ))}
      <ThemedText>
        {t(mode === "inherit" ? "assetPermissions.inheritHelp" : "assetPermissions.restrictedHelp")}
      </ThemedText>
      {mode === "restricted" && (
        <>
          {!props.globalManage && props.snapshot.canManage && (
            <ThemedText>{t("assetPermissions.retained")}</ThemedText>
          )}
          <TextInput
            accessibilityLabel={t("assetPermissions.search")}
            placeholder={t("assetPermissions.search")}
            value={query}
            onChangeText={setQuery}
            style={{ color: theme.text, padding: 12 }}
          />
          {ids.map((id) => (
            <View key={id} style={{ gap: 6 }}>
              <ThemedText>{label(id)}</ThemedText>
              {!props.members.includes(id) && props.snapshot.canManage && (
                <ThemedText>{t("assetPermissions.inactive")}</ThemedText>
              )}
              {(["none", "view", "upload", "edit", "manage"] as const).map((permission) => (
                <Button
                  key={permission}
                  label={t(`assetPermissions.${permission}`)}
                  selected={
                    (grants.find((g) => g.userId === id)?.permission ?? "none") === permission
                  }
                  disabled={
                    locked ||
                    (!props.members.includes(id) && permission !== "none") ||
                    (!props.globalManage && id === props.userId && permission !== "manage")
                  }
                  onPress={() => edit(id, permission)}
                />
              ))}
            </View>
          ))}
        </>
      )}
      {armed && <ThemedText>{t("assetPermissions.confirmHelp")}</ThemedText>}
      {props.snapshot.canManage && (
        <Button
          label={t(armed ? "assetOrganization.confirm" : "assetOrganization.save")}
          disabled={locked || !changed}
          onPress={save}
        />
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && error && <ThemedText>{t("assetOrganization.recheck")}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      {props.snapshot.canManage && (
        <Button
          label={t("assetPermissions.history")}
          disabled={op.busy || attempted}
          onPress={() => setHistory(true)}
        />
      )}
      <Button label={t("thread.refresh")} disabled={op.busy} onPress={props.refresh} />
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function History(props: Props) {
  const t = useTranslations();
  const [rows, setRows] = useState<PermissionEvent[]>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void fetchAssetPermissionEvents(
      props.crewId,
      props.userId,
      props.generation,
      props.nodeId,
      c.signal
    )
      .then((v) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setRows(v);
      })
      .catch((e) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(e instanceof Error ? e.message : String(e));
      });
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, props.nodeId]);
  const displays = useUserDisplays(String(props.generation), [
    ...new Set(
      (rows ?? []).flatMap((r) => [
        r.actorUserId,
        ...r.previousGrants.map((g) => g.userId),
        ...r.nextGrants.map((g) => g.userId),
      ])
    ),
  ]);
  const show = (items: AssetGrant[]) =>
    items
      .map(
        (g) =>
          `${displays?.get(g.userId)?.nickname || g.userId}: ${t(`assetPermissions.${g.permission}`)}`
      )
      .join(", ") || t("assetPermissions.none");
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("assetPermissions.history")}</ThemedText>
      <ThemedText>{t("assetPermissions.historyHelp")}</ThemedText>
      {!rows && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {rows?.length === 0 && <ThemedText>{t("assetPermissions.emptyHistory")}</ThemedText>}
      {rows?.map((row) => (
        <View key={row.id} style={{ gap: 6 }}>
          <ThemedText>
            {displays?.get(row.actorUserId)?.nickname || row.actorUserId} ·{" "}
            {new Date(row.createdAt).toLocaleString()}
          </ThemedText>
          <ThemedText>
            {t(`assetPermissions.${row.previousMode}`)} → {t(`assetPermissions.${row.nextMode}`)} ·{" "}
            {row.previousVersion} → {row.nextVersion}
          </ThemedText>
          <ThemedText>
            {show(row.previousGrants)} → {show(row.nextGrants)}
          </ThemedText>
        </View>
      ))}
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
