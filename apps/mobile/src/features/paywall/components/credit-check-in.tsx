import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import {
  claimCreditCheckIn,
  getCreditCheckIn,
  type CreditCheckInStatus,
} from "../lib/credit-rewards-api";

export function CreditCheckIn({
  generation,
  onClaim,
}: {
  generation: number;
  onClaim: () => void;
}) {
  const active = useScreenActive(),
    theme = useTheme(),
    t = useTranslations(),
    locale = useLocale();
  const scope = useMemo(() => ({ active, generation }), [active, generation]);
  const owner = useRef<{ scope: typeof scope; controller: AbortController } | null>(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    owner.current = { scope, controller };
    return () => controller.abort();
  }, [scope]);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    scope: typeof scope;
    revision: number;
    data?: CreditCheckInStatus;
    error?: string;
  }>();
  const lock = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<typeof scope>();
  const [notice, setNotice] = useState<{ scope: typeof scope; message?: string; error?: string }>();
  const snapshot = result?.scope === scope && result.revision === revision ? result : undefined;
  const busy = pending === scope;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void getCreditCheckIn(generation, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ scope, revision, data });
      },
      (cause) => {
        if (!controller.signal.aborted)
          setResult({
            scope,
            revision,
            error: cause instanceof Error ? cause.message : String(cause),
          });
      }
    );
    return () => controller.abort();
  }, [active, generation, scope, revision]);
  async function claim() {
    const controller = owner.current?.scope === scope ? owner.current.controller : null;
    const current = () =>
      active && !!controller && !controller.signal.aborted && generation === getAuthGeneration();
    if (
      !current() ||
      lock.current === controller ||
      !snapshot?.data?.enabled ||
      snapshot.data.checkedInToday
    )
      return;
    lock.current = controller;
    setPending(scope);
    setNotice(undefined);
    try {
      const receipt = await claimCreditCheckIn(generation, controller!.signal);
      if (!current()) return;
      setNotice({
        scope,
        message: receipt.alreadyCheckedIn
          ? t("creditCheckIn.done")
          : t("creditRewards.success").replace(
              "{amount}",
              BigInt(receipt.granted.amount).toLocaleString(locale)
            ),
      });
      setRevision((value) => value + 1);
      onClaim();
    } catch (cause) {
      if (current())
        setNotice({ scope, error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      if (lock.current === controller) lock.current = null;
      if (current()) setPending(undefined);
    }
  }
  if (snapshot?.data && !snapshot.data.enabled) return null;
  const data = snapshot?.data;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="small" style={{ fontSize: 16, fontWeight: "600" }}>
        {t("creditCheckIn.title")}
      </ThemedText>
      {!snapshot ? (
        <ActivityIndicator color={theme.textSecondary} />
      ) : snapshot.error ? (
        <>
          <ThemedText type="small" accessibilityRole="alert">
            {snapshot.error}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRevision((value) => value + 1)}
            style={{ paddingVertical: 12 }}
          >
            <ThemedText type="small">{t("common.retry")}</ThemedText>
          </Pressable>
        </>
      ) : (
        data && (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              {t("creditCheckIn.streak").replace("{days}", data.streak.toLocaleString(locale))}
            </ThemedText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {data.rewards.map((reward, index) => (
                <View
                  key={index}
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    backgroundColor: theme.backgroundElement,
                    borderWidth: 1,
                    borderColor:
                      !data.checkedInToday &&
                      index === (data.nextStreakDay - 1) % data.rewards.length
                        ? theme.textSecondary
                        : "transparent",
                  }}
                >
                  <ThemedText type="small" themeColor="textSecondary">
                    {t("creditCheckIn.day").replace("{day}", String(index + 1))}
                  </ThemedText>
                  <ThemedText type="small">{reward.toLocaleString(locale)}</ThemedText>
                </View>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={!active || busy || data.checkedInToday}
              accessibilityState={{ disabled: !active || busy || data.checkedInToday }}
              onPress={() => void claim()}
              style={{ paddingVertical: 12, opacity: busy || data.checkedInToday ? 0.45 : 1 }}
            >
              <ThemedText type="small" style={{ color: theme.brand }}>
                {data.checkedInToday
                  ? t("creditCheckIn.done")
                  : t("creditCheckIn.claim").replace(
                      "{amount}",
                      data.todayReward.toLocaleString(locale)
                    )}
              </ThemedText>
            </Pressable>
          </>
        )
      )}
      {notice?.scope === scope && notice.error && (
        <ThemedText type="small" accessibilityRole="alert">
          {notice.error}
        </ThemedText>
      )}
      {notice?.scope === scope && notice.message && (
        <ThemedText type="small" accessibilityLiveRegion="polite">
          {notice.message}
        </ThemedText>
      )}
    </View>
  );
}
