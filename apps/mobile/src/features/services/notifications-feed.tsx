import { useRouter } from "expo-router";
import { appEnv } from "@/config";
import { toHref } from "@/lib/navigation";
import { AuthedWebView } from "@/components/authed-web-view";
import { notificationDestination } from "./notification-destination";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, FlatList, Pressable, ScrollView, View } from "react-native";
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
  type NotificationItem,
} from "./notification-api";
import { useInboxRealtime } from "./use-inbox-realtime";
import { useNotifications } from "./use-notifications";
import { useUserDisplays } from "./user-displays";
import { notificationContent } from "./notification-content";
type Props = { generation: number; userId: string };
export function NotificationsFeed({ generation, userId }: Props) {
  const active = useScreenActive();
  if (!active || generation !== getAuthGeneration()) return null;
  return <Feed key={`${generation}:${userId}`} generation={generation} userId={userId} />;
}
function Feed({ generation, userId }: Props) {
  const router = useRouter();
  const [webPath, setWebPath] = useState<string>();
  const t = useTranslations(),
    theme = useTheme(),
    locale = useLocale();
  const label = (key: string) => t(`notifications.${key}` as MessageKey);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const list = useNotifications(webPath ? undefined : String(generation), filter);
  const actors = useUserDisplays(
    webPath ? undefined : `${generation}:${userId}`,
    list.items.flatMap((item) =>
      item.type.startsWith("crew.task.") && typeof item.meta.actorUserId === "string"
        ? [item.meta.actorUserId]
        : []
    )
  );
  const contentLabel = (key: string, values?: Record<string, string | number | Date>) =>
    label(key).replace(/\{(\w+)\}/g, (token, name: string) =>
      values?.[name] === undefined ? token : String(values[name])
    );
  const liveUnavailable = useInboxRealtime(userId, generation, !webPath, list.refresh);
  const operation = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const finishReadOnNavigation = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (!finishReadOnNavigation.current) operation.current?.abort();
    };
  }, []);
  async function mark(id?: string, navigating = false) {
    if (operation.current || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    operation.current = controller;
    finishReadOnNavigation.current = navigating;
    setBusy(true);
    setError(undefined);
    try {
      if (id) await readNotification(id, generation, controller.signal);
      else await readAllNotifications(generation, controller.signal);
    } catch (cause) {
      if (alive.current && !controller.signal.aborted && generation === getAuthGeneration()) {
        setError(cause instanceof Error ? cause.message : String(cause));
        // A failed receipt may still represent an applied write. Reconcile
        // without retrying the mutation; confirmed writes notify active lists.
        list.refresh();
      }
    } finally {
      if (alive.current && !controller.signal.aborted && generation === getAuthGeneration()) {
        setBusy(false);
      }
      if (operation.current === controller) operation.current = null;
    }
  }
  async function openNotification(item: NotificationItem) {
    if (operation.current || !alive.current || generation !== getAuthGeneration()) return;
    const destination = notificationDestination(item, appEnv.appRegion, locale);
    if (!destination) return;
    // Opening is itself the read intent, as on Web. Let this idempotent write
    // finish after navigation; a slow/failed receipt must not block the target.
    if (!item.readAt) void mark(item.id, true);
    if (!alive.current || generation !== getAuthGeneration()) return;
    try {
      if (destination.kind === "native") router.push(toHref(destination.path));
      else if (destination.kind === "web") setWebPath(destination.path);
      else await Linking.openURL(destination.url);
    } catch (cause) {
      if (alive.current && generation === getAuthGeneration())
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  if (webPath)
    return (
      <View style={{ flex: 1 }}>
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => setWebPath(undefined)}
        >
          <ThemedText>{t("common.back")}</ThemedText>
        </Pressable>
        <AuthedWebView path={webPath} title={label("title")} />
      </View>
    );
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
        renderItem={({ item }) => {
          const actorName =
            typeof item.meta.actorUserId === "string"
              ? actors?.get(item.meta.actorUserId)?.nickname.trim()
              : undefined;
          const content = notificationContent(item, locale, contentLabel, actorName);
          return (
            <View
              style={{
                padding: 12,
                marginBottom: 8,
                gap: 8,
                backgroundColor: theme.backgroundElement,
                borderRadius: 8,
              }}
            >
              <ThemedText type="smallBold">{content.title}</ThemedText>
              {actorName &&
                item.type.startsWith("crew.task.") &&
                item.type !== "crew.task.assigned" &&
                item.type !== "crew.task.updated" && (
                  <ThemedText type="small">
                    {contentLabel("performedBy", { name: actorName })}
                  </ThemedText>
                )}
              <ThemedText>{content.body}</ThemedText>
              <ThemedText type="small">
                {new Date(item.createdAt).toLocaleString(locale)}
              </ThemedText>
              {notificationDestination(item, appEnv.appRegion, locale) && (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || !!list.error}
                  style={{ padding: 10 }}
                  onPress={() => void openNotification(item)}
                >
                  <ThemedText>{label("view")}</ThemedText>
                </Pressable>
              )}
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
          );
        }}
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
