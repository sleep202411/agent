import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { appEnv } from "@/config/app-env";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import type { GenerationProject } from "./projects-api";
import {
  castingAcceptUrl,
  castingBox,
  castingCommand,
  castingRecipient,
  listCastingInvites,
  writeCastingInvite,
  type CastingCommand,
  type CastingInvite,
  type CreatedCastingInvite,
} from "./casting-invites-api";
function ActionButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 10, opacity: disabled ? 0.45 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
export function CastingInvitesPanel({
  userId,
  generation,
  project,
  onBack,
  onBusyChange,
}: {
  userId: string;
  generation: number;
  project: GenerationProject;
  onBack: () => void;
  onBusyChange: (v: boolean) => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation("casting-invites", true);
  const [box] = useState(() => castingBox(userId, generation, project));
  const [initial] = useState(() => {
    try {
      return { pending: box.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [rows, setRows] = useState<CastingInvite[]>(),
    [error, setError] = useState(initial.error),
    [epoch, setEpoch] = useState(0),
    [loading, setLoading] = useState(true),
    [mode, setMode] = useState<"user" | "contact">("user"),
    [value, setValue] = useState(""),
    [confirm, setConfirm] = useState<CastingCommand | "clear">(),
    [created, setCreated] = useState<CreatedCastingInvite>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    onBusyChange(op.busy);
    return () => onBusyChange(false);
  }, [op.busy, onBusyChange]);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setRows(undefined);
    setConfirm(undefined);
    void listCastingInvites(project, generation, c.signal)
      .then((items) => {
        if (!c.signal.aborted) {
          setRows(items);
          setError("");
          setCreated((old) =>
            old &&
            items.some(
              (i) =>
                i.id === old.id && i.status === "pending" && Date.parse(i.expiresAt) > Date.now()
            )
              ? old
              : undefined
          );
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
          setCreated(undefined);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [project, generation, epoch]);
  const locked = loading || op.busy || !!pending || !rows;
  function prepare(action: "create" | "revoke", inviteId?: string) {
    if (locked) return;
    try {
      setConfirm(
        castingCommand.parse({
          action,
          clientKey: uuid.v4(),
          workspaceId: project.workspaceId,
          projectId: project.id,
          ...(action === "create"
            ? { recipient: castingRecipient.parse({ mode, value }) }
            : { inviteId }),
        })
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function submit(intent: CastingCommand) {
    setConfirm(undefined);
    setCreated(undefined);
    void op.run(
      () => writeCastingInvite(intent, userId, generation, project, controller.current!.signal),
      (result) => {
        setCreated(result);
        setPending(null);
        setValue("");
        setEpoch((v) => v + 1);
      },
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setRows(undefined);
        try {
          setPending(box.read());
        } catch {
          /* Preserve corrupt pending storage; never overwrite it. */
        }
      }
    );
  }
  function share() {
    if (!created || op.busy) return;
    const receipt = created;
    void op.run(
      async () => {
        const items = await listCastingInvites(project, generation, controller.current!.signal);
        if (
          !items.some(
            (r) =>
              r.id === receipt.id && r.status === "pending" && Date.parse(r.expiresAt) > Date.now()
          )
        )
          throw new Error(t("casting.linkUnavailable"));
        await Share.share({ message: castingAcceptUrl(receipt.token, appEnv.appRegion) });
      },
      () => {},
      (e) => {
        setCreated(undefined);
        setRows(undefined);
        setError(e instanceof Error ? e.message : String(e));
      }
    );
  }
  const btn = (label: string, onPress: () => void, disabled = false, key?: string) => (
    <ActionButton key={key} label={label} onPress={onPress} disabled={disabled} />
  );
  const recipient = (r?: CastingInvite) =>
    r?.inviteeUserId ?? r?.inviteeContact ?? t("casting.unknownRecipient");
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {btn(t("common.back"), onBack, op.busy)}
        {btn(t("casting.refresh"), () => setEpoch((v) => v + 1), op.busy || loading)}
      </View>
      <ThemedText type="smallBold">{t("casting.title")}</ThemedText>
      <ThemedText type="small">{t("casting.hint")}</ThemedText>
      {loading ? <ActivityIndicator /> : null}
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
      {pending ? (
        <View style={{ gap: 6 }}>
          <ThemedText>{t("casting.pending")}</ThemedText>
          <ThemedText type="small">
            {pending.action === "create" ? pending.recipient.value : pending.inviteId}
          </ThemedText>
          {btn(t("casting.clear"), () => setConfirm("clear"), op.busy || loading)}
        </View>
      ) : null}
      {confirm ? (
        <View style={{ gap: 6 }}>
          <ThemedText>
            {t(
              confirm === "clear"
                ? "casting.clearHint"
                : confirm.action === "create"
                  ? "casting.confirmCreate"
                  : "casting.confirmRevoke"
            )}
          </ThemedText>
          {confirm !== "clear" ? (
            <ThemedText type="small">
              {confirm.action === "create"
                ? confirm.recipient.value
                : recipient(rows?.find((r) => r.id === confirm.inviteId)!)}
            </ThemedText>
          ) : null}
          <ActionButton
            label={t("casting.confirm")}
            onPress={() => {
              if (confirm === "clear") {
                try {
                  if (pending) box.clear(pending.clientKey);
                  setPending(null);
                  setConfirm(undefined);
                } catch (e) {
                  setError(String(e));
                }
              } else submit(confirm);
            }}
            disabled={op.busy}
          />
          {btn(t("common.cancel"), () => setConfirm(undefined), op.busy)}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {(["user", "contact"] as const).map((m) =>
          btn(`${mode === m ? "✓ " : ""}${t(`casting.mode.${m}`)}`, () => setMode(m), locked, m)
        )}
      </View>
      <ThemedText type="small">{t(`casting.modeHint.${mode}`)}</ThemedText>
      <TextInput
        accessibilityLabel={t(`casting.mode.${mode}`)}
        value={value}
        editable={!locked}
        onChangeText={setValue}
        maxLength={mode === "user" ? 64 : 256}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t(`casting.mode.${mode}`)}
        placeholderTextColor={theme.textSecondary}
        style={{
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          padding: 12,
          borderRadius: 10,
        }}
      />
      {btn(t("casting.create"), () => prepare("create"), locked || !value.trim())}
      {created ? (
        <View>
          <ThemedText type="small">{t("casting.linkOnce")}</ThemedText>
          <ActionButton label={t("casting.share")} onPress={share} disabled={op.busy || loading} />
        </View>
      ) : null}
      {!loading && rows?.length === 0 ? (
        <ThemedText type="small">{t("casting.empty")}</ThemedText>
      ) : null}
      {rows?.map((r) => (
        <View
          key={r.id}
          style={{
            gap: 4,
            padding: 12,
            borderRadius: 10,
            backgroundColor: theme.backgroundElement,
          }}
        >
          <ThemedText>{recipient(r)}</ThemedText>
          <ThemedText type="small">{t(`casting.status.${r.status}`)}</ThemedText>
          <ThemedText type="small">
            {t("casting.expires")}: {new Date(r.expiresAt).toLocaleString()}
          </ThemedText>
          {r.status === "pending"
            ? btn(t("casting.revoke"), () => prepare("revoke", r.id), locked)
            : null}
        </View>
      ))}
    </ScrollView>
  );
}
