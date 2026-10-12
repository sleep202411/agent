import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useIsFocused, useRouter } from "expo-router";
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
  canRequestReview,
  fetchReview,
  missingReviewRequirements,
  reviewOutbox,
  reviewRequirements,
  submitReview,
  type ReviewSnapshot,
  type ReviewCommand,
} from "./review-api";
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
      onPress={onPress}
      disabled={disabled}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
export function IpReviewPanel(props: Props) {
  return useIsFocused() && getAuthGeneration() === props.generation ? (
    <Session key={`${props.ipId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
const statuses = [
  "draft",
  "submitted",
  "in_review",
  "changes_requested",
  "approved",
  "scheduled",
  "published",
  "suspended",
  "archived",
] as const;
function Session({ ipId, userId, generation }: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    router = useRouter(),
    op = useAuthFormOperation(ipId, true);
  const [box] = useState(() => reviewOutbox(ipId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: box.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [error, setError] = useState(initial.error),
    [snapshot, setSnapshot] = useState<ReviewSnapshot>(),
    [summary, setSummary] = useState(
      initial.pending?.changeSummary ?? t("ipReview.defaultSummary")
    ),
    [loading, setLoading] = useState(true),
    [saved, setSaved] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [confirm, setConfirm] = useState<"submit" | "clear" | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void fetchReview(ipId, generation, c.signal)
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
  const failure = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) {
      setSnapshot(undefined);
      setConfirm(null);
      setReviewed(false);
    }
  };
  const refresh = () => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setConfirm(null);
    setReviewed(false);
    setError(initial.error);
    void op.run(
      () => fetchReview(ipId, generation, signal),
      (value) => {
        setSnapshot(value);
        setReviewed(true);
        setSaved(false);
      },
      failure
    );
  };
  const submit = (command: ReviewCommand) => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setConfirm(null);
    setReviewed(false);
    setSaved(false);
    setError("");
    void op.run(
      async () => {
        box.save(command);
        setPending(command);
        return submitReview(ipId, userId, generation, command, signal);
      },
      (value) => {
        setSnapshot(value);
        setPending(null);
        setSaved(true);
        invalidateBrowse();
      },
      failure
    );
  };
  const busy = loading || op.busy,
    frozen = busy || !!pending || !!initial.error,
    missing = snapshot ? missingReviewRequirements(snapshot) : [],
    status = statuses.find((value) => value === snapshot?.status);
  if (!active) return null;
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText type="small" themeColor="textSecondary">
        {t("ipReview.hint")}
      </ThemedText>
      {busy && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("ipReview.saved")}</ThemedText>}
      <Button label={t("thread.refresh")} disabled={busy} onPress={refresh} />
      {snapshot && (
        <>
          <ThemedText type="smallBold">{snapshot.title}</ThemedText>
          <ThemedText>
            {t("ipReview.status")}: {status ? t(`ipReview.${status}`) : snapshot.status}
          </ThemedText>
          <ThemedText type="small">
            {t("ipReview.source")}: {snapshot.sourceLocale}
          </ThemedText>
          <View
            style={{
              padding: 12,
              gap: 8,
              borderRadius: 8,
              backgroundColor: theme.backgroundElement,
            }}
          >
            {reviewRequirements.map((key) => (
              <ThemedText key={key} type="small">
                {missing.includes(key) ? "○ " : "✓ "}
                {t(`ipReview.require_${key}`)}
              </ThemedText>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {(
              [
                { label: "ipReview.editProfile", path: "" },
                { label: "ipReview.editMedia", path: "/media" },
                { label: "ipReview.editRights", path: "/rights" },
              ] as const
            ).map((item) => (
              <Button
                key={item.path}
                label={t(item.label)}
                disabled={busy}
                onPress={() => router.push(`/ip-studio/${ipId}${item.path}` as never)}
              />
            ))}
          </View>
          {canRequestReview(snapshot.status) ? (
            <>
              <ThemedText>{t("ipReview.summary")}</ThemedText>
              <TextInput
                accessibilityLabel={t("ipReview.summary")}
                value={summary}
                onChangeText={setSummary}
                editable={!frozen}
                multiline
                maxLength={1000}
                style={{
                  padding: 12,
                  minHeight: 100,
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderRadius: 8,
                }}
              />
              <Button
                label={t("ipReview.submit")}
                disabled={frozen || !!missing.length || !summary.trim()}
                onPress={() => setConfirm("submit")}
              />
            </>
          ) : (
            <ThemedText type="small">{t("ipReview.unavailable")}</ThemedText>
          )}
        </>
      )}
      {pending && (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("ipReview.pending")}</ThemedText>
          <ThemedText type="small">{pending.changeSummary}</ThemedText>
          <Button
            label={t("common.retry")}
            disabled={busy || !!initial.error}
            onPress={() => submit(pending)}
          />
          {snapshot && reviewed && (
            <Button
              label={t("ipReview.checked")}
              disabled={busy}
              onPress={() => setConfirm("clear")}
            />
          )}
        </View>
      )}
      {confirm && snapshot && (
        <>
          <ThemedText>
            {t(confirm === "submit" ? "ipReview.confirmHint" : "ipReview.clearHint")}
          </ThemedText>
          <Button
            label={t(confirm === "submit" ? "ipReview.confirmSubmit" : "ipReview.confirmClear")}
            disabled={busy}
            onPress={() => {
              if (confirm === "submit")
                submit({
                  clientKey: uuid.v4(),
                  expectedVersion: snapshot.version,
                  sourceLocale: snapshot.sourceLocale,
                  changeSummary: summary.trim(),
                });
              else if (pending) {
                try {
                  box.clear(pending.clientKey);
                  setPending(null);
                  setConfirm(null);
                  setError("");
                } catch (e) {
                  failure(e);
                }
              }
            }}
          />
          <Button label={t("common.cancel")} disabled={busy} onPress={() => setConfirm(null)} />
        </>
      )}
    </ScrollView>
  );
}
