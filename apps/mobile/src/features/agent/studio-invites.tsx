import { StoryRoleGuide } from "./story-role-guide";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  View,
} from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { appEnv } from "@/config/app-env";
import {
  createStudioInvite,
  inviteRoles,
  listStudioInvites,
  revokeStudioInvite,
  studioInviteUrl,
  StudioInviteWriteError,
  type StudioInvite,
  type StudioInviteRole,
  type StudioInviteScope,
} from "./api/studio-invites-api";
type Props = { scope: StudioInviteScope; generation: number; onClose: () => void };
export function StudioInvites(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.scope.kind}:${props.scope.id}:${props.generation}`} {...props} />
  ) : null;
}
function Session({ scope, generation, onClose }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const [rows, setRows] = useState<StudioInvite[]>();
  const [role, setRole] = useState<StudioInviteRole>(
    scope.kind === "workspace" ? "editor" : "viewer"
  );
  const [days, setDays] = useState("");
  const [error, setError] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [uncertain, setUncertain] = useState(false),
    [rechecked, setRechecked] = useState(false);
  const [armed, setArmed] = useState<string>();
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
      setSecret(undefined);
      setRows(undefined);
      setArmed(undefined);
      if (!active) {
        pending.current?.abort();
        return;
      }
      setLoading(true);
      setError(undefined);
      try {
        const result = await listStudioInvites(scope, generation, c.signal);
        if (!c.signal.aborted) {
          setRows(result);
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
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!operation.current) onClose();
      return true;
    });
    return () => subscription.remove();
  }, [active, onClose]);
  const parsedDays = days.trim() === "" ? null : Number(days);
  const validDays =
    parsedDays === null ||
    (/^\d+$/.test(days) && Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 30);
  const locked = busy || loading || uncertain || !rows;
  const mutate = async (inviteId?: string) => {
    if (!active || locked || operation.current || !current() || (!inviteId && !validDays)) return;
    if (inviteId && armed !== inviteId) {
      setArmed(inviteId);
      return;
    }
    operation.current = true;
    setBusy(true);
    setSecret(undefined);
    setError(undefined);
    const c = new AbortController();
    pending.current = c;
    try {
      if (inviteId) await revokeStudioInvite(scope, generation, inviteId, c.signal);
      else {
        const result = await createStudioInvite(scope, generation, role, parsedDays, c.signal);
        if (current() && !c.signal.aborted)
          setSecret(studioInviteUrl(result.token, appEnv.appRegion));
      }
      if (current()) {
        // Refresh without clearing a newly minted link; the token cannot be fetched again.
        try {
          const list = await listStudioInvites(scope, generation, c.signal);
          if (current()) setRows(list);
        } catch (e) {
          if (current() && !c.signal.aborted) {
            setRows(undefined);
            setError(e instanceof Error ? e.message : String(e));
          }
        }
        setArmed(undefined);
      }
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : String(e));
        if (e instanceof StudioInviteWriteError) {
          setUncertain(true);
          setRechecked(false);
        }
      }
    } finally {
      operation.current = false;
      if (current()) setBusy(false);
    }
  };
  if (!active) return null;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">
        {t("studioInvites.title")} · {scope.name}
      </ThemedText>
      <ThemedText type="small">{t("studioInvites.help")}</ThemedText>
      {loading && <ActivityIndicator />}
      {rows && (
        <>
          <ThemedText type="smallBold">{t("studioInvites.role")}</ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {inviteRoles(scope).map((value) => (
              <Action
                key={value}
                selected={role === value}
                disabled={locked}
                label={t(`studioInvites.${value}`)}
                onPress={() => setRole(value)}
              />
            ))}
          </View>
          {scope.kind === "story-project" && <StoryRoleGuide role={role} />}
          <ThemedText type="small">{t("studioInvites.days")}</ThemedText>
          <TextInput
            accessibilityLabel={t("studioInvites.days")}
            value={days}
            onChangeText={setDays}
            editable={!locked}
            keyboardType="number-pad"
            maxLength={2}
            style={{
              color: theme.text,
              padding: 12,
              borderWidth: 1,
              borderColor: theme.textSecondary,
              borderRadius: 8,
            }}
          />
          {!validDays && (
            <ThemedText accessibilityRole="alert">{t("studioInvites.invalidDays")}</ThemedText>
          )}
          <Action
            label={t("studioInvites.create")}
            disabled={locked || !validDays}
            onPress={() => void mutate()}
          />
          {!rows.length && <ThemedText>{t("studioInvites.empty")}</ThemedText>}
          {rows.map((row) => (
            <View
              key={row.inviteId}
              style={{
                padding: 12,
                gap: 8,
                backgroundColor: theme.backgroundElement,
                borderRadius: 8,
              }}
            >
              <ThemedText>
                {t(`studioInvites.${row.role}`)} · {t(`studioInvites.${row.status}`)}
              </ThemedText>
              <ThemedText type="small">
                {row.expiresAt === null
                  ? t("studioInvites.never")
                  : new Date(row.expiresAt).toLocaleString()}
              </ThemedText>
              {row.status !== "revoked" && (
                <Action
                  label={t(
                    armed === row.inviteId ? "studioInvites.confirmRevoke" : "studioInvites.revoke"
                  )}
                  disabled={locked}
                  onPress={() => void mutate(row.inviteId)}
                />
              )}
            </View>
          ))}
        </>
      )}
      {secret && (
        <Action
          label={t("studioInvites.share")}
          disabled={busy}
          onPress={() => {
            void Share.share({ message: secret }).catch((e) => {
              if (current()) setError(e instanceof Error ? e.message : String(e));
            });
          }}
        />
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {uncertain && (
        <>
          <ThemedText>{t("studioInvites.uncertain")}</ThemedText>
          <Action
            label={t("studioInvites.reviewed")}
            disabled={!rechecked || loading || busy}
            onPress={() => {
              setUncertain(false);
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
        borderColor: theme.brand,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
