import { StoryRoleGuide } from "./story-role-guide";
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
import { inviteRoles, type StudioInviteRole } from "./api/studio-invites-api";
import {
  changeStudioMember,
  fetchStudioMembers,
  StudioMemberWriteError,
  type StudioMember,
  type StudioMemberChange,
  type StudioMembersState,
  type StudioMemberScope,
} from "./api/studio-members-api";
type Props = { scope: StudioMemberScope; generation: number; onClose: () => void };
export function StudioMembers(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.scope.kind}:${props.scope.id}:${props.generation}`} {...props} />
  ) : null;
}
function Session({ scope, generation, onClose }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const [data, setData] = useState<StudioMembersState>();
  const [account, setAccount] = useState(""),
    [role, setRole] = useState<StudioInviteRole>("viewer");
  const [selected, setSelected] = useState<StudioMember>(),
    [confirm, setConfirm] = useState<StudioMemberChange>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [uncertain, setUncertain] = useState(false),
    [rechecked, setRechecked] = useState(false);
  const [revision, setRevision] = useState(0);
  const alive = useRef(true),
    operation = useRef(false),
    pending = useRef<AbortController | null>(null);
  const current = () => alive.current && generation === getAuthGeneration();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void Promise.resolve().then(async () => {
      if (c.signal.aborted) return;
      setData(undefined);
      setConfirm(undefined);
      setSelected(undefined);
      if (!active) {
        pending.current?.abort();
        return;
      }
      setLoading(true);
      setError(undefined);
      try {
        const result = await fetchStudioMembers(scope, generation, c.signal);
        if (!c.signal.aborted) {
          setData(result);
          setRechecked(true);
        }
      } catch (e) {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    });
    return () => c.abort();
  }, [scope, generation, active, revision]);
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!operation.current) onClose();
      return true;
    });
    return () => sub.remove();
  }, [active, onClose]);
  const locked = busy || loading || uncertain || !data;
  async function submit() {
    if (!confirm || locked || operation.current || !active || !current()) return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    const c = new AbortController();
    pending.current = c;
    try {
      await changeStudioMember(scope, generation, confirm, c.signal);
      if (current()) {
        setAccount("");
        setConfirm(undefined);
        setRevision((v) => v + 1);
      }
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : String(e));
        if (e instanceof StudioMemberWriteError) {
          setUncertain(true);
          setRechecked(false);
        } else setConfirm(undefined);
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
        {t("studioMembers.title")} · {scope.name}
      </ThemedText>
      <ThemedText type="small">{t("studioMembers.help")}</ThemedText>
      {loading && <ActivityIndicator />}
      {data?.canAdd && !selected && (
        <>
          <TextInput
            accessibilityLabel={t("studioMembers.account")}
            placeholder={t("studioMembers.account")}
            placeholderTextColor={theme.textSecondary}
            value={account}
            editable={!locked}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(v) => {
              setAccount(v);
              setConfirm(undefined);
            }}
            style={{
              padding: 12,
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.textSecondary,
              borderRadius: 8,
            }}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {inviteRoles(scope).map((value) => (
              <Action
                key={value}
                selected={value === role}
                disabled={locked}
                label={t(`studioInvites.${value}`)}
                onPress={() => {
                  setRole(value);
                  setConfirm(undefined);
                }}
              />
            ))}
          </View>
          {scope.kind === "story-project" && <StoryRoleGuide role={role} />}
          <Action
            label={t("studioMembers.add")}
            disabled={locked || !account.trim()}
            onPress={() => setConfirm({ kind: "add", account: account.trim(), role })}
          />
        </>
      )}
      {data?.members.map((member) => (
        <View
          key={member.memberId}
          style={{ padding: 12, gap: 8, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        >
          <ThemedText type="smallBold">
            {member.nickname || member.userId}
            {member.isSelf ? ` · ${t("studioMembers.you")}` : ""}
          </ThemedText>
          <ThemedText>
            {member.role === "owner" || member.role === "billing"
              ? t(`studioMembers.${member.role}`)
              : t(`studioInvites.${member.role}`)}
          </ThemedText>
          {member.accessScope === "project_only" && (
            <ThemedText type="small">{t("studioMembers.projectOnly")}</ThemedText>
          )}
          {!member.isOwner && data.canEdit && (
            <Action
              label={t("studioMembers.edit")}
              disabled={locked}
              onPress={() => {
                setSelected(member);
                setRole(
                  inviteRoles(scope).includes(member.role as StudioInviteRole)
                    ? (member.role as StudioInviteRole)
                    : "viewer"
                );
                setConfirm(undefined);
              }}
            />
          )}
          {!member.isOwner &&
            data.canRemove &&
            !(scope.kind === "workspace" && member.accessScope === "project_only") && (
              <Action
                label={t("studioMembers.remove")}
                disabled={locked}
                onPress={() => setConfirm({ kind: "remove", member })}
              />
            )}
        </View>
      ))}
      {selected && (
        <>
          <ThemedText>{selected.nickname || selected.userId}</ThemedText>
          {scope.kind === "workspace" && selected.accessScope === "project_only" && (
            <ThemedText>{t("studioMembers.promote")}</ThemedText>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {inviteRoles(scope).map((value) => (
              <Action
                key={value}
                selected={value === role}
                disabled={locked}
                label={t(`studioInvites.${value}`)}
                onPress={() => {
                  setRole(value);
                  setConfirm(undefined);
                }}
              />
            ))}
          </View>
          {scope.kind === "story-project" && <StoryRoleGuide role={role} />}
          <Action
            label={t("studioMembers.save")}
            disabled={locked || (role === selected.role && selected.accessScope !== "project_only")}
            onPress={() => setConfirm({ kind: "role", member: selected, role })}
          />
          <Action
            label={t("studioMembers.cancel")}
            disabled={busy}
            onPress={() => {
              setSelected(undefined);
              setConfirm(undefined);
            }}
          />
        </>
      )}
      {confirm && (
        <>
          <ThemedText>
            {confirm.kind === "remove"
              ? t(
                  scope.kind === "workspace"
                    ? "studioMembers.removeWorkspace"
                    : "studioMembers.removeStory"
                )
              : t("studioMembers.confirmHelp")}
          </ThemedText>
          <ThemedText>
            {confirm.kind === "add"
              ? confirm.account
              : confirm.member.nickname || confirm.member.userId}
            {confirm.kind !== "remove" ? ` · ${t(`studioInvites.${confirm.role}`)}` : ""}
          </ThemedText>
          <Action
            label={t("studioMembers.confirm")}
            disabled={locked}
            onPress={() => void submit()}
          />
          <Action
            label={t("studioMembers.cancel")}
            disabled={busy}
            onPress={() => setConfirm(undefined)}
          />
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {uncertain && (
        <>
          <ThemedText>{t("studioMembers.uncertain")}</ThemedText>
          <Action
            label={t("studioMembers.reviewed")}
            disabled={!rechecked || busy || loading}
            onPress={() => {
              setUncertain(false);
              setConfirm(undefined);
              setError(undefined);
            }}
          />
        </>
      )}
      {busy && <ActivityIndicator />}
      <Action
        label={t("thread.refresh")}
        disabled={busy}
        onPress={() => setRevision((v) => v + 1)}
      />
      <Action label={t("crewTasks.back")} disabled={busy} onPress={onClose} />
    </ScrollView>
  );
}
function Action({
  label,
  disabled,
  selected,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  selected?: boolean;
  onPress: () => void;
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
        borderColor: theme.brand,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
