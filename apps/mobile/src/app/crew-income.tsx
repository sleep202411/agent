import { IncomeFilterFields } from "@/features/earnings/income-filters";
import { CreatorWithdrawals } from "@/features/earnings/creator-withdrawals";
import { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";
import { isChinaRegion } from "@/config";
import { useCrewIncome } from "@/features/earnings/use-crew-income";
import type { IncomeView, IncomeFilters } from "@/features/earnings/crew-income-api";
import { formatFinanceMoney } from "@/features/services/crew-finance-api";
import { CrewFinanceTrend } from "@/features/services/crew-finance-trend";
export default function CrewIncomeScreen() {
  const auth = useAuth(),
    gate = useAuthGate(),
    theme = useTheme(),
    t = useTranslations();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("crewPersonalIncome.title"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 16 }}
          onPress={() => gate.requireAuth()}
        >
          <ThemedText>{t("login.signIn")}</ThemedText>
        </Pressable>
      ) : (
        <Income
          key={`${auth.generation}:${userId}`}
          userId={userId}
          owner={String(auth.generation)}
        />
      )}
    </View>
  );
}
function Income({ userId, owner }: { userId: string; owner: string }) {
  const t = useTranslations(),
    theme = useTheme(),
    locale = useLocale(),
    active = useScreenActive(),
    router = useRouter();
  const [view, setView] = useState<IncomeView>("earnings"),
    [crewId, setCrewId] = useState(""),
    [filters, setFilters] = useState<IncomeFilters>({});
  const currency = isChinaRegion ? "CNY" : "USD";
  const list = useCrewIncome(active ? owner : undefined, userId, currency, view, crewId, filters);
  const prefix = view === "earnings" ? "crewPersonalIncome" : "crewPersonalPayouts";
  const label = (key: string) => t(`${prefix}.${key}` as MessageKey);
  const money = (amount: string) => formatFinanceMoney(amount, currency);
  const box = { padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement };
  return (
    <FlatList
      data={list.items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
      refreshing={list.loading}
      onRefresh={list.refresh}
      onEndReached={list.loadMore}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <ThemedText type="small">{t("crewPersonalIncome.description")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={() => router.push("/earnings")}>
            <ThemedText type="small">{t("creatorEarnings.workIncome")}</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push("/referrals")}>
            <ThemedText type="small">{t("creatorEarnings.referralIncome")}</ThemedText>
          </Pressable>
          <ThemedText type="small">{t("creatorEarnings.incomeSourcesHint")}</ThemedText>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {(["earnings", "payouts"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: view === value }}
                style={box}
                onPress={() => setView(value)}
              >
                <ThemedText>
                  {t(
                    value === "earnings" ? "crewPersonalIncome.title" : "crewPersonalPayouts.title"
                  )}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText type="small">
            {crewId || t("crewPersonalIncome.allCrews")} · {currency}
          </ThemedText>
          {crewId && (
            <Pressable accessibilityRole="button" onPress={() => setCrewId("")}>
              <ThemedText>{t("crewPersonalIncome.allCrews")}</ThemedText>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" disabled={list.loading} onPress={list.refresh}>
            <ThemedText>{label("refresh")}</ThemedText>
          </Pressable>
          {!list.error &&
            list.summary?.summary.map((metric, i) => (
              <View key={`${metric.key}:${i}`} style={box}>
                <ThemedText type="small">{t(metric.key as MessageKey)}</ThemedText>
                <ThemedText type="smallBold">{money(metric.amount)}</ThemedText>
              </View>
            ))}
          {view === "earnings" ? (
            <>
              <CrewFinanceTrend
                value={list.summary?.postedDaily}
                currency={currency}
                failed={!!list.error}
              />
              <ThemedText type="small">{t("crewPersonalIncome.settlementNote")}</ThemedText>
            </>
          ) : (
            <ThemedText type="small">{t("crewPersonalPayouts.balanceDescription")}</ThemedText>
          )}
          {view === "earnings" && (
            <>
              {!list.error && list.summary?.postedBySource && (
                <Pressable
                  accessibilityRole="button"
                  style={box}
                  onPress={() =>
                    setFilters((value) => ({
                      ...value,
                      sourceType: "task_reward",
                    }))
                  }
                >
                  <ThemedText type="smallBold">
                    {t("crewPersonalIncome.productionOrders")}
                  </ThemedText>
                  <ThemedText>
                    {money(
                      list.summary.postedBySource.find(
                        (value) => value.sourceType === "task_reward"
                      )?.amountMinor ?? "0"
                    )}
                  </ThemedText>
                </Pressable>
              )}
              <IncomeFilterFields value={filters} onApply={setFilters} />
            </>
          )}
          <CreatorWithdrawals
            userId={userId}
            generation={Number(owner)}
            onSubmitted={list.refresh}
          />
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ ...box, gap: 8 }}>
          {"title" in item && (
            <>
              <ThemedText type="smallBold">{item.title}</ThemedText>
              <ThemedText type="small">{item.description}</ThemedText>
              {item.crew && <ThemedText type="small">{item.crew.name}</ThemedText>}
              <ThemedText type="small">
                {t("crewPersonalIncome.incomeType")}: {t(`crewIncome.sources.${item.sourceType}`)}
              </ThemedText>
              {item.revenueDistribution && (
                <View style={{ gap: 4 }}>
                  <ThemedText type="small">
                    {t("crewPersonalIncome.confirmedRevenue")}
                    {item.revenueDistribution.shareBps !== null
                      ? ` · ${t("crewPersonalIncome.revenueShare").replace("{percentage}", String(item.revenueDistribution.shareBps / 100))}`
                      : ""}
                  </ThemedText>
                  <ThemedText type="small">
                    {t("crewPersonalIncome.revenueReference")}:{" "}
                    {item.revenueDistribution.revenueReference}
                  </ThemedText>
                  <ThemedText type="small">
                    {t("crewPersonalIncome.distributionContract")}:{" "}
                    {item.revenueDistribution.contract.filename}
                  </ThemedText>
                  <ThemedText type="small">
                    {t("crewPersonalIncome.distributionReceipt")}: {item.revenueDistribution.id}
                  </ThemedText>
                </View>
              )}
              {item.task && (
                <ThemedText type="small">
                  #{item.task.number} {item.task.title}
                </ThemedText>
              )}
            </>
          )}
          <ThemedText type="small">
            {label(item.status)} ·{" "}
            {money("netAmountMinor" in item ? item.netAmountMinor : item.amountMinor)}
          </ThemedText>
          <ThemedText type="small">
            {new Date(item.createdAt).toLocaleString(
              locale,
              "postedAt" in item ? { timeZone: "UTC" } : undefined
            )}
          </ThemedText>
          <ThemedText type="small">
            {label("crew")}: {item.crewId}
          </ThemedText>
          <ThemedText type="small">
            {view === "earnings" ? t("crewPersonalIncome.incomeCode") : label("record")}: {item.id}
          </ThemedText>
          {"netAmountMinor" in item && (
            <>
              <ThemedText type="small">
                {label("gross")}: {money(item.amountMinor)} · {label("withholding")}:{" "}
                {money(item.withholdingAmountMinor)}
              </ThemedText>
              {item.paidAt && (
                <ThemedText type="small">
                  {label("paidAt")}: {new Date(item.paidAt).toLocaleString(locale)}
                </ThemedText>
              )}
              {item.paymentReference && (
                <ThemedText type="small">
                  {label("reference")}: {item.paymentReference}
                </ThemedText>
              )}
              {item.voidReason && <ThemedText type="small">{item.voidReason}</ThemedText>}
              <ThemedText type="smallBold">{label("sources")}</ThemedText>
              {item.allocations.map((allocation) => (
                <ThemedText key={allocation.id} type="small">
                  {allocation.earning.title} · {money(allocation.amountMinor)}
                </ThemedText>
              ))}
            </>
          )}
          {!crewId && (
            <Pressable
              accessibilityRole="button"
              disabled={!!list.error}
              onPress={() => setCrewId(item.crewId)}
            >
              <ThemedText>{label("showCrew")}</ThemedText>
            </Pressable>
          )}
        </View>
      )}
      ListEmptyComponent={
        !list.loading && !list.error ? <ThemedText>{label("empty")}</ThemedText> : null
      }
      ListFooterComponent={
        <View style={{ gap: 12 }}>
          {list.loading && <ActivityIndicator />}
          {list.error && (
            <>
              <ThemedText accessibilityRole="alert">{list.error}</ThemedText>
              <Pressable accessibilityRole="button" onPress={list.retry}>
                <ThemedText>{label("retry")}</ThemedText>
              </Pressable>
            </>
          )}
          {list.hasMore && !list.loading && !list.error && (
            <Pressable accessibilityRole="button" onPress={list.loadMore}>
              <ThemedText>{label("more")}</ThemedText>
            </Pressable>
          )}
        </View>
      }
    />
  );
}
