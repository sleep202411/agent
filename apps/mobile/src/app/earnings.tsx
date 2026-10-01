import { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";
import { useEarnings } from "@/features/earnings/use-earnings";
import { formatEarnings, type EarningsPeriod } from "@/features/earnings/api";

export default function EarningsScreen() {
  const auth = useAuth(),
    gate = useAuthGate(),
    theme = useTheme(),
    t = useTranslations();
  const locale = useLocale();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("creatorEarnings.title"),
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
        <Earnings key={JSON.stringify([auth.generation, locale])} owner={String(auth.generation)} />
      )}
    </View>
  );
}
function Earnings({ owner }: { owner: string }) {
  const router = useRouter();
  const theme = useTheme(),
    t = useTranslations(),
    locale = useLocale(),
    active = useScreenActive();
  const label = (key: string) => t(`creatorEarnings.${key}` as MessageKey);
  const [work, setWork] = useState("all"),
    [days, setDays] = useState<EarningsPeriod>("all");
  const [selected, setSelected] = useState<string>();
  const list = useEarnings(active ? owner : undefined, locale, work, days);
  const points = (value: string) => formatEarnings(value, locale);
  const buttonStyle = { padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement };
  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
      data={list.items}
      keyExtractor={(item) => item.id}
      onEndReached={list.loadMore}
      refreshing={list.loading}
      onRefresh={list.refresh}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <ThemedText type="small">{label("subtitle")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={() => router.push("/crew-income")}>
            <ThemedText type="small">{label("crewIncome")}</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push("/referrals")}>
            <ThemedText type="small">{label("referralIncome")}</ThemedText>
          </Pressable>
          <ThemedText type="small">{label("incomeSourcesHint")}</ThemedText>
          <ThemedText type="small">{label("unit")}</ThemedText>
          {(
            [
              ["lifetime", list.summary?.lifetimeEarned],
              ["balance", list.summary?.withdrawableBalance],
            ] as const
          ).map(([key, value]) => (
            <View key={key} style={buttonStyle}>
              <ThemedText type="small">{label(key)}</ThemedText>
              <ThemedText type="subtitle">{value === undefined ? "—" : points(value)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {label(`${key}Hint`)}
              </ThemedText>
            </View>
          ))}
          <ThemedText type="smallBold">{label("workFilter")}</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {[
              { key: "all", title: label("allWorks") },
              ...(list.summary?.works ?? []),
              ...(work !== "all" && !list.summary?.works.some((item) => item.key === work)
                ? [{ key: work, title: label("selectedWork") }]
                : []),
            ].map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="radio"
                accessibilityState={{ selected: work === item.key }}
                style={{
                  ...buttonStyle,
                  backgroundColor:
                    work === item.key ? theme.backgroundSelected : theme.backgroundElement,
                }}
                onPress={() => {
                  setWork(item.key);
                  setSelected(undefined);
                }}
              >
                <ThemedText type="small">{item.title || label("unknownWork")}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
          <ThemedText type="smallBold">{label("timeFilter")}</ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(["all", "30", "90"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected: days === value }}
                style={{
                  ...buttonStyle,
                  backgroundColor:
                    days === value ? theme.backgroundSelected : theme.backgroundElement,
                }}
                onPress={() => {
                  setDays(value);
                  setSelected(undefined);
                }}
              >
                <ThemedText type="small">{label(`period.${value}`)}</ThemedText>
              </Pressable>
            ))}
          </View>
          {(work !== "all" || days !== "all") && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setWork("all");
                setDays("all");
                setSelected(undefined);
              }}
            >
              <ThemedText type="small">{label("clearFilters")}</ThemedText>
            </Pressable>
          )}
          <ThemedText type="smallBold">{label("transactions")}</ThemedText>
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ ...buttonStyle, gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: selected === item.id }}
            onPress={() => setSelected(selected === item.id ? undefined : item.id)}
          >
            <ThemedText type="smallBold">{item.workTitle || label("unknownWork")}</ThemedText>
            <ThemedText type="small">{item.contentTitle || "—"}</ThemedText>
            <ThemedText type="smallBold">
              +{points(item.amount)} {label("unit")}
            </ThemedText>
            <ThemedText type="small">
              {new Date(item.createdAt).toLocaleString(locale)} · {label("posted")}
            </ThemedText>
          </Pressable>
          {selected === item.id && (
            <View style={{ gap: 8 }}>
              <ThemedText type="smallBold">{label("detail")}</ThemedText>
              <ThemedText type="small">
                {label("incomeType")}:{" "}
                {label(
                  `incomeTypes.${item.kind === "story" ? "story" : item.episodeId ? "ipEpisode" : "ip"}`
                )}
              </ThemedText>
              <ThemedText type="small">
                {label("sale")}: {item.sourceAmount === null ? "—" : points(item.sourceAmount)}
              </ThemedText>
              <ThemedText type="small">
                {label("order")}: {item.orderNo || "—"}
              </ThemedText>
              <ThemedText type="small">
                {label("transaction")}: {item.transactionId}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {label(item.kind === "story" ? "storyRevenueNote" : "splitNote")}
              </ThemedText>
            </View>
          )}
        </View>
      )}
      ListEmptyComponent={
        !list.loading && !list.error ? (
          <View style={{ gap: 8 }}>
            <ThemedText>
              {label(work === "all" && days === "all" ? "emptyTitle" : "noMatches")}
            </ThemedText>
            <ThemedText type="small">
              {label(work === "all" && days === "all" ? "emptyHint" : "noMatchesHint")}
            </ThemedText>
          </View>
        ) : null
      }
      ListFooterComponent={
        <View style={{ gap: 12 }}>
          {list.loading && <ActivityIndicator />}
          {list.hasMore && !list.loading && !list.error && (
            <Pressable accessibilityRole="button" onPress={list.loadMore} style={buttonStyle}>
              <ThemedText>{label("pagination.next")}</ThemedText>
            </Pressable>
          )}
          {list.error && (
            <>
              <ThemedText accessibilityRole="alert">{list.error}</ThemedText>
              <Pressable accessibilityRole="button" onPress={list.retry}>
                <ThemedText>{label("retry")}</ThemedText>
              </Pressable>
            </>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            {label("ledgerNote")}
          </ThemedText>
        </View>
      }
    />
  );
}
