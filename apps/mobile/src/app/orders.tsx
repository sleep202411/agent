import { useUserDisplays } from "@/features/services/user-displays";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import { ORDER_STATUSES } from "@repo/shared/order";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";
import { formatServicePrice } from "@/lib/creator-service-format";
import { useOrders } from "@/features/services/use-orders";
import type { OrderRole, OrderFilter } from "@/features/services/order-list-api";
export default function OrdersScreen() {
  const auth = useAuth(),
    gate = useAuthGate(),
    focused = useScreenActive();
  const theme = useTheme(),
    t = useTranslations(),
    locale = useLocale(),
    router = useRouter();
  const [role, setRole] = useState<OrderRole>("both"),
    [status, setStatus] = useState<OrderFilter>("");
  const owner = auth.status === "authenticated" && focused ? String(auth.generation) : undefined;
  const orders = useOrders(owner, role, status);
  const displays = useUserDisplays(
    owner,
    orders.items.map((item) => item.counterpartyId)
  );
  return (
    <View style={{ flex: 1, backgroundColor: theme.background, padding: 16, gap: 12 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("orders.title"),
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable accessibilityRole="button" onPress={() => gate.requireAuth()}>
          <ThemedText>{t("orders.signIn")}</ThemedText>
        </Pressable>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 12 }}>
            {(["both", "buyer", "creator"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected: role === value }}
                onPress={() => setRole(value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor:
                    role === value ? theme.backgroundSelected : theme.backgroundElement,
                }}
              >
                <ThemedText>{t(`orders.role.${value}`)}</ThemedText>
              </Pressable>
            ))}
          </View>
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {(["", ...ORDER_STATUSES] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: status === value }}
                  onPress={() => setStatus(value)}
                  style={{
                    padding: 10,
                    backgroundColor:
                      status === value ? theme.backgroundSelected : theme.backgroundElement,
                  }}
                >
                  <ThemedText>{t(value ? `orders.status.${value}` : "orders.all")}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <FlatList
            data={orders.items}
            keyExtractor={(item) => item.id}
            onEndReached={orders.loadMore}
            onRefresh={orders.refresh}
            refreshing={orders.loading}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(toHref(`/order/${encodeURIComponent(item.id)}`))}
                style={{
                  padding: 14,
                  marginBottom: 8,
                  borderRadius: 8,
                  backgroundColor: theme.backgroundElement,
                }}
              >
                <ThemedText type="smallBold">{item.serviceTitle}</ThemedText>
                <ThemedText>{t(`orders.status.${item.status}`)}</ThemedText>
                <ThemedText>
                  {displays?.get(item.counterpartyId)?.nickname?.trim() ||
                    `${t("inbox.person")} ${item.counterpartyId}`}
                </ThemedText>
                <ThemedText>
                  {formatServicePrice(
                    { startingPrice: item.totalPrice, currency: item.currency },
                    locale
                  )}
                </ThemedText>
                {item.unreadCount > 0 && (
                  <ThemedText>
                    {t("orders.unread")} {item.unreadCount}
                  </ThemedText>
                )}
              </Pressable>
            )}
            ListEmptyComponent={
              !orders.loading && !orders.error ? <ThemedText>{t("orders.empty")}</ThemedText> : null
            }
            ListFooterComponent={
              <View>
                {orders.loading && <ActivityIndicator />}
                {orders.error && (
                  <>
                    <ThemedText accessibilityRole="alert">{orders.error}</ThemedText>
                    <Pressable accessibilityRole="button" onPress={orders.retry}>
                      <ThemedText>{t("orders.retry")}</ThemedText>
                    </Pressable>
                  </>
                )}
              </View>
            }
          />
        </>
      )}
    </View>
  );
}
