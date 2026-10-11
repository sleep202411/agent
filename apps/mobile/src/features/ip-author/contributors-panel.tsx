import { IpUserLookup } from "./user-lookup";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useIsFocused } from "expo-router";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ApiRequestError } from "@/lib/api-client";
import { invalidateBrowse } from "@/data/browse-refresh";
import {
  contributorRoles,
  contributorFields,
  contributorOutbox,
  contributorShare,
  fetchContributors,
  submitContributor,
  withinContributorPool,
  type Contributor,
  type ContributorCommand,
  type ContributorFields,
  type ContributorSnapshot,
} from "./contributors-api";
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
export function IpContributorsPanel(props: Props) {
  return useIsFocused() && getAuthGeneration() === props.generation ? (
    <Session key={`${props.ipId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
type Draft = ContributorFields & { before?: Contributor; shareText: string };
function Session({ ipId, userId, generation }: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(ipId, true);
  const [outbox] = useState(() => contributorOutbox(ipId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [error, setError] = useState(initial.error);
  const [snapshot, setSnapshot] = useState<ContributorSnapshot>(),
    [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(),
    [removing, setRemoving] = useState<Contributor>();
  const [checked, setChecked] = useState(false),
    [resolving, setResolving] = useState(false),
    [saved, setSaved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void fetchContributors(ipId, generation, c.signal)
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
  }, [ipId, generation]);
  const frozen = op.busy || loading || !!pending || !!initial.error;
  const failure = (e: unknown) => {
    setError(String(e instanceof Error ? e.message : e));
    if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) {
      setSnapshot(undefined);
      setDraft(undefined);
      setRemoving(undefined);
      setChecked(false);
    }
  };
  const refresh = () => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    void op.run(
      () => fetchContributors(ipId, generation, signal),
      (value) => {
        setSnapshot(value);
        setError(initial.error);
        setChecked(!!pending);
        setSaved(false);
      },
      failure
    );
  };
  const submit = (command: ContributorCommand) => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setError("");
    setSaved(false);
    setChecked(false);
    setResolving(false);
    void op.run(
      async () => {
        try {
          await submitContributor(ipId, userId, generation, command, signal);
        } finally {
          if (!signal.aborted && getAuthGeneration() === generation) setPending(outbox.read());
        }
      },
      () => {
        setDraft(undefined);
        setRemoving(undefined);
        setPending(null);
        setSaved(true);
        setLoading(true);
        invalidateBrowse();
        // Receipt already succeeded; a failed refresh must not offer to replay the write.
        void fetchContributors(ipId, generation, signal)
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
  const share = draft ? contributorShare(draft.shareText) : undefined;
  const parsed = draft
    ? contributorFields.safeParse({
        ...draft,
        customRole: draft.customRole?.trim() || null,
        revenueShareBps: draft.revenueEligible ? share : null,
      })
    : null;
  const valid =
    parsed?.success &&
    (!draft?.revenueEligible || share !== undefined) &&
    snapshot &&
    withinContributorPool(snapshot.contributors, parsed.data, draft?.before?.id);
  const card = {
    gap: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.backgroundElement,
  } as const;
  if (!active) return null;
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      {(loading || op.busy) && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("ipContributors.saved")}</ThemedText>}
      <Button
        label={t("thread.refresh")}
        onPress={refresh}
        disabled={loading || op.busy || (!!draft && !pending)}
      />
      {snapshot && (
        <>
          <ThemedText type="smallBold">{snapshot.ip.title}</ThemedText>
          <ThemedText type="small">
            {t("ipContributors.pool")
              .replace("{share}", String(snapshot.creatorShareBps / 100))
              .replace("{allocated}", String(snapshot.poolAllocatedBps / 100))}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t("ipContributors.creditHint")}
          </ThemedText>
          {!snapshot.contributors.length && <ThemedText>{t("ipContributors.empty")}</ThemedText>}
          {snapshot.contributors.map((item) => (
            <View key={item.id} style={card}>
              <ThemedText type="smallBold">{item.displayName}</ThemedText>
              <ThemedText type="small">
                {item.customRole || t(`ipContributors.role.${item.role}`)}
              </ThemedText>
              <ThemedText type="small">
                {item.revenueEligible
                  ? `${t("ipContributors.share")}: ${(item.revenueShareBps ?? 0) / 100}%`
                  : t("ipContributors.creditOnly")}
              </ThemedText>
              {item.userId && (
                <ThemedText type="small">
                  {t("ipContributors.account")}: {item.userId}
                </ThemedText>
              )}
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <Button
                  label={t("ipContributors.edit")}
                  disabled={frozen || !!draft}
                  onPress={() => {
                    setRemoving(undefined);
                    setSaved(false);
                    setDraft({
                      ...item,
                      before: item,
                      shareText:
                        item.revenueShareBps === null ? "" : String(item.revenueShareBps / 100),
                    });
                  }}
                />
                <Button
                  label={t("ipContributors.remove")}
                  disabled={frozen || !!draft}
                  onPress={() => setRemoving(item)}
                />
              </View>
              {removing?.id === item.id && (
                <View>
                  <ThemedText>{t("ipContributors.removeConfirm")}</ThemedText>
                  <Button
                    label={t("ipContributors.confirmRemove")}
                    disabled={frozen}
                    onPress={() =>
                      submit({ clientKey: uuid.v4(), action: "remove", before: removing })
                    }
                  />
                  <Button
                    label={t("common.cancel")}
                    disabled={frozen}
                    onPress={() => setRemoving(undefined)}
                  />
                </View>
              )}
            </View>
          ))}
          {!draft && (
            <Button
              label={t("ipContributors.add")}
              disabled={frozen}
              onPress={() => {
                setRemoving(undefined);
                setSaved(false);
                setDraft({
                  displayName: "",
                  userId: null,
                  role: "writer",
                  customRole: null,
                  revenueEligible: false,
                  revenueShareBps: null,
                  shareText: "",
                });
              }}
            />
          )}
          {draft && !pending && (
            <View style={card}>
              {(["displayName", "customRole"] as const).map((field) => (
                <View key={field}>
                  <ThemedText>{t(`ipContributors.${field}`)}</ThemedText>
                  <TextInput
                    accessibilityLabel={t(`ipContributors.${field}`)}
                    value={draft[field] ?? ""}
                    editable={!frozen}
                    maxLength={field === "displayName" ? 120 : 80}
                    onChangeText={(value) => setDraft({ ...draft, [field]: value })}
                    style={{ color: theme.text, padding: 12, backgroundColor: theme.background }}
                  />
                </View>
              ))}
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {contributorRoles.map((role) => (
                  <Pressable
                    key={role}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: draft.role === role, disabled: frozen }}
                    disabled={frozen}
                    style={{ padding: 12 }}
                    onPress={() => setDraft({ ...draft, role })}
                  >
                    <ThemedText type="small">
                      {draft.role === role ? "● " : "○ "}
                      {t(`ipContributors.role.${role}`)}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              {draft.userId ? (
                <View>
                  <ThemedText>
                    {t("ipContributors.account")}: {draft.userId}
                  </ThemedText>
                  <Button
                    label={t("ipContributors.unlink")}
                    disabled={frozen}
                    onPress={() =>
                      setDraft({ ...draft, userId: null, revenueEligible: false, shareText: "" })
                    }
                  />
                </View>
              ) : (
                <IpUserLookup
                  generation={generation}
                  disabled={frozen}
                  onSelect={(user) =>
                    setDraft({
                      ...draft,
                      userId: user.userId,
                      displayName: draft.displayName.trim() || user.nickname || user.userId,
                    })
                  }
                />
              )}
              <Pressable
                accessibilityRole="checkbox"
                disabled={frozen || !draft.userId}
                accessibilityState={{
                  checked: draft.revenueEligible,
                  disabled: frozen || !draft.userId,
                }}
                style={{ padding: 12, opacity: draft.userId ? 1 : 0.5 }}
                onPress={() => setDraft({ ...draft, revenueEligible: !draft.revenueEligible })}
              >
                <ThemedText>
                  {draft.revenueEligible ? "☑ " : "☐ "}
                  {t("ipContributors.eligible")}
                </ThemedText>
              </Pressable>
              {draft.revenueEligible && (
                <View>
                  <ThemedText>{t("ipContributors.share")}</ThemedText>
                  <TextInput
                    accessibilityLabel={t("ipContributors.share")}
                    value={draft.shareText}
                    editable={!frozen}
                    keyboardType="decimal-pad"
                    maxLength={6}
                    onChangeText={(shareText) => setDraft({ ...draft, shareText })}
                    style={{ color: theme.text, padding: 12, backgroundColor: theme.background }}
                  />
                  {(share === undefined || (parsed?.success && !valid)) && (
                    <ThemedText accessibilityRole="alert">
                      {t("ipContributors.invalidShare")}
                    </ThemedText>
                  )}
                </View>
              )}
              <Button
                label={t("ipContributors.save")}
                disabled={frozen || !valid}
                onPress={() => {
                  if (!parsed?.success || !valid) return;
                  submit(
                    draft.before
                      ? {
                          clientKey: uuid.v4(),
                          action: "edit",
                          before: draft.before,
                          data: parsed.data,
                        }
                      : { clientKey: uuid.v4(), action: "create", data: parsed.data }
                  );
                }}
              />
              <Button
                label={t("common.cancel")}
                disabled={frozen}
                onPress={() => setDraft(undefined)}
              />
            </View>
          )}
          {pending && (
            <View style={card}>
              <ThemedText>{t("ipContributors.pending")}</ThemedText>
              <ThemedText>
                {pending.action === "remove"
                  ? pending.before.displayName
                  : pending.data.displayName}
              </ThemedText>
              <Button
                label={t("ipContributors.reviewed")}
                disabled={!checked || op.busy || !!initial.error}
                onPress={() => setResolving(true)}
              />
              {resolving && (
                <View>
                  <ThemedText>{t("ipContributors.resolveHint")}</ThemedText>
                  <Button
                    label={t("ipContributors.confirmResolve")}
                    disabled={op.busy}
                    onPress={() => {
                      try {
                        outbox.clear(pending.clientKey);
                        setPending(null);
                        setDraft(undefined);
                        setRemoving(undefined);
                        setResolving(false);
                        setChecked(false);
                        setError("");
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
        </>
      )}
    </ScrollView>
  );
}
