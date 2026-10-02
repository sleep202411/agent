import { inboxPreview } from "@/features/services/inbox-preview";
import { useScreenActive } from "@/hooks/use-app-active";
import { useInboxRealtime } from "@/features/services/use-inbox-realtime";
import { useUserDisplays } from "@/features/services/user-displays";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import { CONVERSATION_CONTEXT_TYPES } from "@repo/shared/conversation";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

import { useInbox } from "@/features/services/use-inbox";
import type { InboxFilter } from "@/features/services/inbox-api";
export default function InboxScreen() {
  const auth = useAuth(),
    gate = useAuthGate(),
    focused = useScreenActive();
  const theme = useTheme(),
    t = useTranslations(),
    router = useRouter();
  const [contextType, setContextType] = useState<InboxFilter>("");
  const owner = auth.status === "authenticated" && focused ? String(auth.generation) : undefined;
  const inbox = useInbox(owner, contextType);
  const liveUnavailable = useInboxRealtime(
    auth.status === "authenticated" ? String(auth.user?.userId ?? auth.user?.id ?? "") : undefined,
    auth.generation,
    focused,
    inbox.refresh
  );
  const displays = useUserDisplays(
    owner,
    inbox.items.filter((item) => item.contextType !== "crew").map((item) => item.counterpartyId)
  );
  return (
    <View style={{ flex: 1, backgroundColor: theme.background, padding: 16, gap: 12 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("inbox.title"),
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable accessibilityRole="button" onPress={() => gate.requireAuth()}>
          <ThemedText>{t("inbox.signIn")}</ThemedText>
        </Pressable>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(toHref("/notifications"))}
            style={{ padding: 10 }}
          >
            <ThemedText>{t("notifications.title")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(toHref("/crew-applications"))}
            style={{ minHeight: 44, padding: 10 }}
          >
            <ThemedText>{t("crewTerms.myApplications")}</ThemedText>
          </Pressable>
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {(["", ...CONVERSATION_CONTEXT_TYPES] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: contextType === value }}
                  onPress={() => setContextType(value)}
                  style={{
                    padding: 10,
                    backgroundColor:
                      contextType === value ? theme.backgroundSelected : theme.backgroundElement,
                  }}
                >
                  <ThemedText>{t(value ? `inbox.filter.${value}` : "inbox.all")}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          {liveUnavailable && <ThemedText>{t("inbox.liveUnavailable")}</ThemedText>}
          <FlatList
            data={inbox.items}
            keyExtractor={(item) => item.id}
            onEndReached={inbox.loadMoreOnScroll}
            onRefresh={inbox.refresh}
            refreshing={inbox.loading}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(toHref(`/conversation/${encodeURIComponent(item.id)}`))}
                style={{
                  padding: 14,
                  marginBottom: 8,
                  borderRadius: 8,
                  backgroundColor: theme.backgroundElement,
                }}
              >
                <ThemedText type="smallBold">
                  {item.contextType === "crew"
                    ? item.crewName || item.contextId
                    : displays?.get(item.counterpartyId)?.nickname?.trim() ||
                      `${t("inbox.person")} ${item.counterpartyId}`}
                </ThemedText>
                <ThemedText>
                  {t(`inbox.filter.${item.contextType}`)}
                  {item.contextType === "crew"
                    ? ` · ${t(item.crewChannel === "community" ? "inbox.community" : "inbox.team")}`
                    : ""}
                </ThemedText>
                <ThemedText numberOfLines={2}>{inboxPreview(item, t)}</ThemedText>
                {item.unreadCount > 0 && (
                  <ThemedText>
                    {t("inbox.unread")} {item.unreadCount}
                  </ThemedText>
                )}
              </Pressable>
            )}
            ListEmptyComponent={
              !inbox.loading && !inbox.error ? (
                <ThemedText>{t(inbox.hasMore ? "inbox.searchingMore" : "inbox.empty")}</ThemedText>
              ) : null
            }
            ListFooterComponent={
              <View>
                {inbox.loading && <ActivityIndicator />}
                {inbox.error && (
                  <>
                    <ThemedText accessibilityRole="alert">{inbox.error}</ThemedText>
                    <Pressable accessibilityRole="button" onPress={inbox.retry}>
                      <ThemedText>{t("inbox.retry")}</ThemedText>
                    </Pressable>
                  </>
                )}
                {inbox.hasMore && !inbox.loading && !inbox.error && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={inbox.loadMore}
                    style={{ padding: 12 }}
                  >
                    <ThemedText>{t("inbox.loadMore")}</ThemedText>
                  </Pressable>
                )}
              </View>
            }
          />
        </>
      )}
    </View>
  );
}
