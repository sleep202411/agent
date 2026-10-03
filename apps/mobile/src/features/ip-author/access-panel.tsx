import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ApiRequestError } from "@/lib/api-client";
import { invalidateBrowse } from "@/data/browse-refresh";
import { IpUserLookup } from "./user-lookup";
import {
  accessOutbox,
  fetchIpAccess,
  submitIpAccess,
  type AccessCommand,
  type IpAccess,
  type IpEditGrant,
} from "./access-api";
type Props = { ipId: string; userId: string; generation: number };
function Button({
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
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
export function IpAccessPanel(props: Props) {
  return useIsFocused() && getAuthGeneration() === props.generation ? (
    <Session key={`${props.ipId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session({ ipId, userId, generation }: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    op = useAuthFormOperation(ipId, true);
  const [outbox] = useState(() => accessOutbox(ipId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [snapshot, setSnapshot] = useState<IpAccess>();
  const [error, setError] = useState(initial.error),
    [loading, setLoading] = useState(true),
    [saved, setSaved] = useState<"" | "saved" | "observed" | "revocationObserved" | "transferred">(
      ""
    );
  const [selected, setSelected] = useState<{ userId: string; nickname: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{
    action: "revoke" | "transfer";
    grant: IpEditGrant;
  }>();
  const [removeOldOwner, setRemoveOldOwner] = useState(false),
    [left, setLeft] = useState(false);
  const [checked, setChecked] = useState(false),
    [resolving, setResolving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void fetchIpAccess(ipId, userId, generation, c.signal)
      .then((value) => {
        if (!c.signal.aborted) setSnapshot(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message ?? e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [ipId, userId, generation]);
  const frozen = !active || op.busy || loading || !!pending || !!initial.error;
  const failure = (e: unknown) => {
    setError(String(e instanceof Error ? e.message : e));
    if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) {
      setSnapshot(undefined);
      setSelected(null);
      setConfirmation(undefined);
    }
  };
  const refresh = () => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setChecked(false);
    setResolving(false);
    void op.run(
      () => fetchIpAccess(ipId, userId, generation, signal),
      (value) => {
        setSnapshot(value);
        setConfirmation(undefined);
        setSelected(null);
        setError(initial.error);
        setChecked(!!pending);
        setLeft(false);
      },
      (e) => {
        failure(e);
        // Loss of visibility cannot prove a transfer completed. It only permits an explicit local-record acknowledgement.
        if (e instanceof ApiRequestError && [403, 404].includes(e.status)) setChecked(!!pending);
      }
    );
  };
  const run = (command: AccessCommand) => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setError("");
    setSaved("");
    setChecked(false);
    setResolving(false);
    void op.run(
      async () => {
        try {
          return await submitIpAccess(ipId, userId, generation, command, signal);
        } finally {
          if (!signal.aborted && getAuthGeneration() === generation) setPending(outbox.read());
        }
      },
      (result) => {
        setPending(null);
        setSelected(null);
        setConfirmation(undefined);
        invalidateBrowse();
        setSaved(
          result.observed
            ? command.action === "revoke"
              ? "revocationObserved"
              : "observed"
            : command.action === "transfer"
              ? "transferred"
              : "saved"
        );
        setSnapshot(undefined);
        if (command.action === "transfer" && command.removeOldOwner) {
          setLeft(true);
          return;
        }
        setLoading(true);
        void fetchIpAccess(ipId, userId, generation, signal)
          .then((value) => {
            if (!signal.aborted) setSnapshot(value);
          })
          .catch((e) => {
            if (!signal.aborted) failure(e);
          })
          .finally(() => {
            if (!signal.aborted) setLoading(false);
          });
      },
      failure
    );
  };
  const card = {
    padding: 12,
    gap: 8,
    borderRadius: 8,
    backgroundColor: theme.backgroundElement,
  } as const;
  const accountLabel = (id: string) => {
    const name = snapshot?.ip.contributors?.find((item) => item.userId === id)?.displayName?.trim();
    return name ? `${name} · ${id}` : id;
  };
  const selectedBlocked =
    selected &&
    (selected.userId === snapshot?.ip.createdById ||
      snapshot?.grants.some((item) => item.userId === selected.userId));
  return (
    <ScrollView
      style={{ display: active ? "flex" : "none" }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      {(loading || op.busy) && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!!saved && <ThemedText>{t(`ipAccess.${saved}`)}</ThemedText>}
      {left && <ThemedText>{t("ipAccess.left")}</ThemedText>}
      <Button label={t("thread.refresh")} onPress={refresh} disabled={loading || op.busy} />
      {snapshot && (
        <>
          <ThemedText type="smallBold">{snapshot.ip.title}</ThemedText>
          <ThemedText type="small">
            {t("ipAccess.owner")}: {accountLabel(snapshot.ip.createdById)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t("ipAccess.scope")}
          </ThemedText>
          {!snapshot.ip.viewerAccess.canManageAcl ? (
            <ThemedText>{t("ipAccess.editorHint")}</ThemedText>
          ) : (
            <>
              {!snapshot.grants.length && <ThemedText>{t("ipAccess.empty")}</ThemedText>}
              {snapshot.grants.map((item) => (
                <View key={item.id} style={card}>
                  <ThemedText type="smallBold">
                    {t("ipAccess.editor")}: {accountLabel(item.userId)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t("ipAccess.grantedAt").replace(
                      "{date}",
                      new Date(item.createdAt).toLocaleString(locale)
                    )}
                  </ThemedText>
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    <Button
                      label={t("ipAccess.revoke")}
                      disabled={frozen}
                      onPress={() => setConfirmation({ action: "revoke", grant: item })}
                    />
                    {snapshot.ip.viewerAccess.canTransferOwner && (
                      <Button
                        label={t("ipAccess.transfer")}
                        disabled={frozen}
                        onPress={() => {
                          setRemoveOldOwner(false);
                          setConfirmation({ action: "transfer", grant: item });
                        }}
                      />
                    )}
                  </View>
                  {confirmation?.grant.id === item.id && (
                    <View style={{ gap: 8 }}>
                      <ThemedText>
                        {t(
                          confirmation.action === "transfer"
                            ? "ipAccess.transferConfirm"
                            : "ipAccess.revokeConfirm"
                        ).replace("{user}", accountLabel(item.userId))}
                      </ThemedText>
                      {confirmation.action === "transfer" && (
                        <Pressable
                          accessibilityRole="checkbox"
                          disabled={frozen}
                          accessibilityState={{ checked: removeOldOwner, disabled: frozen }}
                          style={{ padding: 12 }}
                          onPress={() => setRemoveOldOwner(!removeOldOwner)}
                        >
                          <ThemedText>
                            {removeOldOwner ? "☑ " : "☐ "}
                            {t("ipAccess.removeSelf")}
                          </ThemedText>
                        </Pressable>
                      )}
                      <Button
                        label={t(
                          confirmation.action === "transfer"
                            ? "ipAccess.confirmTransfer"
                            : "ipAccess.confirmRevoke"
                        )}
                        disabled={frozen}
                        onPress={() =>
                          run(
                            confirmation.action === "transfer"
                              ? {
                                  clientKey: uuid.v4(),
                                  action: "transfer",
                                  toUserId: item.userId,
                                  removeOldOwner,
                                  expectedVersion: snapshot.ip.version,
                                }
                              : {
                                  clientKey: uuid.v4(),
                                  action: "revoke",
                                  toUserId: item.userId,
                                  grantId: item.id,
                                }
                          )
                        }
                      />
                      <Button
                        label={t("common.cancel")}
                        disabled={frozen}
                        onPress={() => setConfirmation(undefined)}
                      />
                    </View>
                  )}
                </View>
              ))}
              <View style={card}>
                <ThemedText type="smallBold">{t("ipAccess.grant")}</ThemedText>
                {selected ? (
                  <View>
                    <ThemedText>
                      {selected.nickname || t("ipContributors.account")} · {selected.userId}
                    </ThemedText>
                    {selectedBlocked && <ThemedText>{t("ipAccess.alreadyAccess")}</ThemedText>}
                    <Button
                      label={t("ipAccess.chooseAnother")}
                      disabled={frozen}
                      onPress={() => setSelected(null)}
                    />
                  </View>
                ) : (
                  <IpUserLookup
                    generation={generation}
                    disabled={frozen}
                    onSelect={setSelected}
                    description={t("ipAccess.lookupHint")}
                  />
                )}
                <Button
                  label={t("ipAccess.confirmGrant")}
                  disabled={frozen || !selected || !!selectedBlocked}
                  onPress={() => {
                    if (selected)
                      run({ clientKey: uuid.v4(), action: "grant", toUserId: selected.userId });
                  }}
                />
              </View>
            </>
          )}
        </>
      )}
      {pending && (
        <View style={card}>
          <ThemedText>{t("ipAccess.pending")}</ThemedText>
          <ThemedText>
            {t(`ipAccess.${pending.action}`)} · {pending.toUserId}
          </ThemedText>
          {!snapshot && <ThemedText>{t("ipAccess.unavailable")}</ThemedText>}
          <Button
            label={t("ipAccess.retry")}
            disabled={op.busy || loading || !snapshot || !!initial.error}
            onPress={() => run(pending)}
          />
          <Button
            label={t("ipAccess.reviewed")}
            disabled={!checked || op.busy || loading || !!initial.error}
            onPress={() => setResolving(true)}
          />
          {resolving && (
            <View>
              <ThemedText>{t("ipAccess.resolveHint")}</ThemedText>
              <Button
                label={t("ipAccess.confirmResolve")}
                disabled={op.busy || loading}
                onPress={() => {
                  try {
                    outbox.clear(pending.clientKey);
                    setPending(null);
                    setConfirmation(undefined);
                    setSelected(null);
                    setResolving(false);
                    setChecked(false);
                  } catch (e) {
                    failure(e);
                  }
                }}
              />
              <Button label={t("common.cancel")} onPress={() => setResolving(false)} />
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}
