import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import {
  cancelMobileSubscription,
  canCancelMobileSubscription,
  getMobilePlan,
  subscriptionAmount,
  type MobilePlan,
  type SubscriptionScope,
} from "../lib/subscription-api";
type Props = SubscriptionScope & { canManage: boolean };
export function SubscriptionPanel(props: Props) {
  const active = useScreenActive();
  if (!active) return null;
  return (
    <AccountPlan
      key={`${props.generation}:${props.workspaceId ?? "personal"}:${props.canManage}`}
      {...props}
    />
  );
}
function AccountPlan(scope: Props) {
  const { generation, workspaceId } = scope;
  const theme = useTheme(),
    t = useTranslations(),
    locale = useLocale();
  const [revision, setRevision] = useState(0),
    [result, setResult] = useState<{ revision: number; plan?: MobilePlan; error?: string }>();
  const [confirming, setConfirming] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [message, setMessage] = useState<string>();
  const owner = useRef<AbortController | null>(null),
    lock = useRef(false);
  useLayoutEffect(() => {
    const controller = new AbortController();
    owner.current = controller;
    return () => controller.abort();
  }, []);
  const snapshot = result?.revision === revision ? result : undefined,
    plan = snapshot?.plan,
    sub = plan?.subscription;
  useEffect(() => {
    const controller = new AbortController();
    void getMobilePlan({ generation, workspaceId }, controller.signal).then(
      (plan) => {
        if (!controller.signal.aborted) setResult({ revision, plan });
      },
      (cause) => {
        if (!controller.signal.aborted)
          setResult({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [generation, workspaceId, revision]);
  const reload = () => {
    if (lock.current) return;
    setConfirming(false);
    setError(undefined);
    setRevision((value) => value + 1);
  };
  async function cancel() {
    const controller = owner.current;
    const current = () =>
      !!controller && !controller.signal.aborted && scope.generation === getAuthGeneration();
    if (
      !current() ||
      lock.current ||
      !confirming ||
      !scope.canManage ||
      !plan ||
      !canCancelMobileSubscription(plan)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const cancelled = await cancelMobileSubscription(
        plan.subscription!.id,
        scope,
        controller!.signal
      );
      if (!current()) return;
      setResult({ revision, plan: { ...plan, subscription: cancelled } });
      setConfirming(false);
      setMessage(t("subscription.cancelled"));
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  const ending = !!sub && (sub.cancelAtPeriodEnd || ["canceled", "expired"].includes(sub.status));
  const date = sub?.currentPeriodEnd ?? plan?.entitlement.expiresAt;
  const dateText = date
    ? Number.isNaN(Date.parse(date))
      ? date
      : new Date(date).toLocaleDateString(locale)
    : null;
  return (
    <View style={{ gap: 10 }}>
      <ThemedText type="small" style={{ fontSize: 16, fontWeight: "600" }}>
        {t("subscription.title")}
      </ThemedText>
      {!snapshot ? (
        <ActivityIndicator color={theme.textSecondary} />
      ) : snapshot.error ? (
        <>
          <ThemedText type="small" accessibilityRole="alert">
            {snapshot.error}
          </ThemedText>
          <Action label={t("common.retry")} onPress={reload} />
        </>
      ) : (
        plan && (
          <>
            <ThemedText>
              {plan.entitlement.planKey === "free"
                ? t("subscription.free")
                : plan.entitlement.planKey
                    .replace(/[_-]+/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase())}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {plan.entitlement.status === "active"
                ? t("subscription.active")
                : plan.entitlement.status === "expired"
                  ? t("subscription.expired")
                  : plan.entitlement.status}
            </ThemedText>
            {sub ? (
              <ThemedText type="small">
                {subscriptionAmount(sub.amountMinor, sub.currency, locale)} ·{" "}
                {sub.interval === "month"
                  ? t("subscription.month")
                  : sub.interval === "year"
                    ? t("subscription.year")
                    : sub.interval === "one_time"
                      ? t("subscription.once")
                      : sub.interval}
              </ThemedText>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {t("subscription.noRecurring")}
              </ThemedText>
            )}
            {dateText && (
              <ThemedText type="small">
                {t(
                  ending || !sub || sub.interval === "one_time"
                    ? "subscription.accessUntil"
                    : "subscription.renews"
                ).replace("{date}", dateText)}
              </ThemedText>
            )}
            {ending && <ThemedText type="small">{t("subscription.cancelled")}</ThemedText>}
            {scope.canManage && canCancelMobileSubscription(plan) && (
              <>
                {confirming ? (
                  <>
                    <ThemedText type="small">{t("subscription.confirm")}</ThemedText>
                    <Action
                      label={t("subscription.confirmCancel")}
                      disabled={busy}
                      onPress={() => void cancel()}
                    />
                    <Action
                      label={t("subscription.keep")}
                      disabled={busy}
                      onPress={() => setConfirming(false)}
                    />
                  </>
                ) : (
                  <Action label={t("subscription.cancel")} onPress={() => setConfirming(true)} />
                )}
              </>
            )}
            <Action label={t("subscription.refresh")} disabled={busy} onPress={reload} />
          </>
        )
      )}
      {error && (
        <ThemedText type="small" accessibilityRole="alert">
          {error}
        </ThemedText>
      )}
      {message && !ending && (
        <ThemedText type="small" accessibilityLiveRegion="polite">
          {message}
        </ThemedText>
      )}
    </View>
  );
}
function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={{ paddingVertical: 10, opacity: disabled ? 0.45 : 1 }}
    >
      <ThemedText type="small" style={{ color: theme.brand }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}
