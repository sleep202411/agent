import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import { NOTIFICATION_FILTERS } from "@repo/shared/notifications";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";
import {
  readNotification,
  readAllNotifications,
  type NotificationFilter,
} from "./notification-api";
import { useInboxRealtime } from "./use-inbox-realtime";
import { useNotifications } from "./use-notifications";
type Props = { generation: number; userId: string };
export function NotificationsFeed({ generation, userId }: Props) {
  const active = useScreenActive();
  if (!active || generation !== getAuthGeneration()) return null;
  return <Feed key={`${generation}:${userId}`} generation={generation} userId={userId} />;
}
function Feed({ generation, userId }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    locale = useLocale();
  const label = (key: string) => t(`notifications.${key}` as MessageKey);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const list = useNotifications(String(generation), filter);
  const liveUnavailable = useInboxRealtime(userId, generation, true, list.refresh);
  const operation = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useEffect(
    () => () => {
      operation.current?.abort();
    },
    []
  );
  async function mark(id?: string) {
    if (operation.current || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      if (id) await readNotification(id, generation, controller.signal);
      else await readAllNotifications(generation, controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted && generation === getAuthGeneration())
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted && generation === getAuthGeneration()) {
        setBusy(false);
        list.refresh();
      }
      if (operation.current === controller) operation.current = null;
    }
  }
  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      {liveUnavailable && <ThemedText>{t("inbox.liveUnavailable")}</ThemedText>}
      <ScrollView horizontal style={{ flexGrow: 0 }}>
        {NOTIFICATION_FILTERS.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: filter === value, disabled: busy }}
            disabled={busy}
            onPress={() => setFilter(value)}
            style={{
              padding: 10,
              backgroundColor:
                filter === value ? theme.backgroundSelected : theme.backgroundElement,
            }}
          >
            <ThemedText>{label(`filters.${value}`)}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        disabled={busy || list.loading || !!list.error}
        onPress={() => void mark()}
        style={{ padding: 12 }}
      >
        <ThemedText>{label("markAllRead")}</ThemedText>
      </Pressable>
      {busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <FlatList
        data={list.items}
        keyExtractor={(item) => item.id}
        refreshing={list.loading}
        onRefresh={list.refresh}
        onEndReached={list.loadMore}
        renderItem={({ item }) => (
          <View
            style={{
              padding: 12,
              marginBottom: 8,
              gap: 8,
              backgroundColor: theme.backgroundElement,
              borderRadius: 8,
            }}
          >
            <ThemedText type="smallBold">{item.title}</ThemedText>
            <ThemedText>{item.body}</ThemedText>
            <ThemedText type="small">{new Date(item.createdAt).toLocaleString(locale)}</ThemedText>
            {!item.readAt && (
              <Pressable
                accessibilityRole="button"
                disabled={busy || !!list.error}
                onPress={() => void mark(item.id)}
                style={{ padding: 10 }}
              >
                <ThemedText>{label("markRead")}</ThemedText>
              </Pressable>
            )}
          </View>
        )}
        ListEmptyComponent={
          !list.loading && !list.error ? <ThemedText>{label("empty")}</ThemedText> : null
        }
        ListFooterComponent={
          <View>
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
                <ThemedText>{label("loadMore")}</ThemedText>
              </Pressable>
            )}
          </View>
        }
      />
    </View>
  );
}
