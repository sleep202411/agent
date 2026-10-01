import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations, useLocale } from "@/i18n";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchCommerce, formatCommercePoints, type CommerceOverview } from "./commerce-api";
type Props = { ipId: string; userId: string; generation: number };
export function IpCommercePanel(props: Props) {
  return useScreenActive() && getAuthGeneration() === props.generation ? (
    <Session key={`${props.ipId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
const statuses = [
  "pending",
  "paid",
  "fulfilled",
  "canceled",
  "failed",
  "refunded",
  "partially_refunded",
] as const;
const warnings = [
  "not_public",
  "no_episodes",
  "no_published_episodes",
  "no_active_price",
  "missing_bundle_price",
  "all_free_preview",
] as const;
function Session({ ipId, generation }: Props) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ revision: number; data?: CommerceOverview; error?: string }>(
    { revision: -1 }
  );
  const loading = state.revision !== revision;
  useEffect(() => {
    const c = new AbortController();
    void fetchCommerce(ipId, generation, locale, c.signal)
      .then((data) => {
        if (!c.signal.aborted) setState({ revision, data });
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setState({ revision, error: e instanceof Error ? e.message : String(e) });
      });
    return () => c.abort();
  }, [ipId, generation, locale, revision]);
  const data = !loading ? state.data : undefined;
  const amount = (value: string) =>
    `${formatCommercePoints(value, locale)} ${t("ipCommerce.points")}`;
  const card = { padding: 12, borderRadius: 8, gap: 8, backgroundColor: theme.backgroundElement };
  const metric = (label: string, value: string | number, detail: string) => (
    <View key={label} style={card}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {detail}
      </ThemedText>
    </View>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="small" themeColor="textSecondary">
        {t("ipCommerce.hint")}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        disabled={loading}
        onPress={() => setRevision((value) => value + 1)}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      {loading && <ActivityIndicator />}
      {!loading && !!state.error && (
        <ThemedText accessibilityRole="alert">{state.error}</ThemedText>
      )}
      {data && (
        <>
          <ThemedText type="smallBold">{data.ip.title}</ThemedText>
          {metric(
            t("ipCommerce.recognizedOrders"),
            data.metrics.recognizedOrders,
            `${t("ipCommerce.orders7")}: ${data.metrics.ordersLast7Days}`
          )}
          {metric(
            t("ipCommerce.gross"),
            amount(data.metrics.grossCommunityPoints),
            `${t("ipCommerce.gross7")}: ${amount(data.metrics.grossCommunityPointsLast7Days)}`
          )}
          {metric(
            t("ipCommerce.buyers"),
            data.metrics.uniqueBuyers,
            `${t("ipCommerce.totalOrders")}: ${data.metrics.totalOrders}`
          )}
          {metric(
            t("ipCommerce.entitlements"),
            data.metrics.activeEntitlements,
            `${t("ipCommerce.pendingUnlocks")}: ${data.metrics.pendingUnlocks}`
          )}
          <View style={card}>
            <ThemedText type="smallBold">
              {t("ipCommerce.health")}: {t(`ipCommerce.${data.pricingHealth.status}`)}
            </ThemedText>
            <ThemedText type="small">
              {t("ipCommerce.bundle")}:{" "}
              {t(data.pricingHealth.bundlePriceActive ? "ipCommerce.yes" : "ipCommerce.no")}
            </ThemedText>
            <ThemedText type="small">
              {t("ipCommerce.activePrices")}: {data.pricingHealth.activeEpisodePriceCount}
            </ThemedText>
            <ThemedText type="small">
              {t("ipCommerce.pricedEpisodes")}: {data.pricingHealth.pricedEpisodeCount}
            </ThemedText>
            <ThemedText type="small">
              {t("ipCommerce.publishedEpisodes")}: {data.pricingHealth.publishedEpisodeCount}
            </ThemedText>
            <ThemedText type="small">
              {t("ipCommerce.freePreviews")}: {data.pricingHealth.freePreviewEpisodeCount}
            </ThemedText>
            {data.pricingHealth.warnings.map((item, index) => {
              const known = warnings.find((value) => value === item.code);
              return (
                <ThemedText key={`${item.code}:${index}`} type="small">
                  {t(`ipCommerce.${item.severity}`)}:{" "}
                  {known ? t(`ipCommerce.${known}`) : item.message}
                </ThemedText>
              );
            })}
          </View>
          <View style={card}>
            <ThemedText type="smallBold">
              {t("ipCommerce.settlement")}: {t(`ipCommerce.${data.settlement.status}`)}
            </ThemedText>
            <ThemedText>
              {t("ipCommerce.ownerBalance")}: {amount(data.settlement.withdrawableBalance)}
            </ThemedText>
            <ThemedText>
              {t("ipCommerce.ipEarnings")}: {amount(data.settlement.ipLifetimeEarnings)}
            </ThemedText>
            <ThemedText type="small">
              {t("ipCommerce.poolShare")}:{" "}
              {new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
                data.settlement.saleShareBps / 100
              )}
              %
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t("ipCommerce.cashOut")}
            </ThemedText>
          </View>
          <ThemedText type="smallBold">{t("ipCommerce.recentOrders")}</ThemedText>
          {!data.recentOrders.length && <ThemedText>{t("ipCommerce.noOrders")}</ThemedText>}
          {data.recentOrders.map((item) => {
            const status = statuses.find((value) => value === item.status);
            return (
              <View key={item.id} style={card}>
                <ThemedText>{item.episode?.title ?? t(`ipCommerce.${item.targetType}`)}</ThemedText>
                <ThemedText type="small">{item.orderNo}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(item.createdAt))}
                </ThemedText>
                <ThemedText type="small">
                  {status ? t(`ipCommerce.${status}`) : item.status}
                </ThemedText>
                <ThemedText>{amount(item.totalAmount)}</ThemedText>
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}
