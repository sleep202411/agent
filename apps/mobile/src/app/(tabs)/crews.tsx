import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { EmptyState, ListFooter, PosterImage, ScreenHeader, Skeleton, Tag } from "@/components/ui";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useBrowseVersion } from "@/data/browse-refresh";
import { getCrewFeedPage } from "@/data/browse-service";
import type { CrewStatus, CrewSummary } from "@/data/types";
import { type MessageKey, useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { toHref } from "@/lib/navigation";

const PAGE_SIZE = 30;

export function crewStatusTag(status: CrewStatus): {
  labelKey: MessageKey;
  tone: "success" | "info" | "neutral";
} {
  if (status === "recruiting") return { labelKey: "crews.statusRecruiting", tone: "success" };
  if (status === "in-production") return { labelKey: "crews.statusInProduction", tone: "info" };
  return { labelKey: "crews.statusClosed", tone: "neutral" };
}

export default function CrewsScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [crews, setCrews] = useState<CrewSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  // Bumped when a mutation elsewhere (e.g. blocking a crew) invalidates lists.
  const browseVersion = useBrowseVersion();
  const hasDataRef = useRef(false);
  const loadingMoreRef = useRef(false);

  const load = useCallback(async () => {
    // Skeleton only when there is nothing to show yet — refetches swap in place.
    setLoading(hasDataRef.current === false);
    setError(undefined);
    try {
      const page = await getCrewFeedPage({ limit: PAGE_SIZE });
      hasDataRef.current = true;
      setCrews(page.items);
      setNextCursor(page.nextCursor);
    } catch (loadError) {
      // A failed background refetch keeps the list we already have.
      if (!hasDataRef.current) {
        setError(loadError instanceof Error ? loadError.message : t("crews.loadErrorFallback"));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, browseVersion]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await getCrewFeedPage({ cursor: nextCursor, limit: PAGE_SIZE });
      setCrews((current) => {
        const seen = new Set(current.map((crew) => crew.id));
        return [...current, ...page.items.filter((crew) => !seen.has(crew.id))];
      });
      setNextCursor(page.nextCursor);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const topInset = Platform.OS === "web" ? insets.top + Spacing.four : Spacing.three;
  const bottomInset = insets.bottom + BottomTabInset + Spacing.four;

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <View
          style={[
            styles.stateContainer,
            { paddingTop: topInset, paddingHorizontal: Math.max(insets.left, Spacing.four) },
          ]}
        >
          <ScreenHeader title={t("crews.title")} />
          <View style={styles.grid}>
            {[0, 1].map((rowIndex) => (
              <View key={rowIndex} style={styles.gridRow}>
                {[0, 1].map((col) => (
                  <View key={col} style={styles.cardItem}>
                    <View style={styles.card}>
                      <Skeleton height={100} radius={12} />
                      <Skeleton width="70%" height={14} />
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <View
          style={[
            styles.stateContainer,
            { paddingTop: topInset, paddingHorizontal: Math.max(insets.left, Spacing.four) },
          ]}
        >
          <ScreenHeader title={t("crews.title")} />
          <EmptyState
            title={t("crews.loadErrorTitle")}
            detail={error}
            symbol={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <FlatList
        data={crews}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.column}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: topInset,
            paddingBottom: bottomInset,
            paddingLeft: Math.max(insets.left, Spacing.four),
            paddingRight: Math.max(insets.right, Spacing.four),
          },
        ]}
        ListHeaderComponent={<ScreenHeader title={t("crews.title")} />}
        ListHeaderComponentStyle={styles.listHeader}
        ListEmptyComponent={
          <EmptyState
            title={t("crews.emptyTitle")}
            detail={t("crews.emptyDetail")}
            symbol={{ ios: "person.2", android: "group", web: "group" }}
          />
        }
        ListFooterComponent={<ListFooter loading={loadingMore} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={theme.textSecondary}
          />
        }
        renderItem={({ item }) => (
          <View style={styles.cardItem}>
            <CrewCard crew={item} />
          </View>
        )}
      />
    </View>
  );
}

function CrewCard({ crew }: { crew: CrewSummary }) {
  const t = useTranslations();
  const tag = crewStatusTag(crew.status);
  const metaLabel =
    crew.status === "recruiting" && crew.openRoles > 0
      ? `${crew.openRoles} ${t("crews.rolesOpen")}`
      : crew.memberCount
        ? `${crew.memberCount} ${t("crews.members")}`
        : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(toHref(`/crew/${crew.id}`))}
      style={styles.cardPressable}
    >
      {({ pressed }) => (
        <View style={[styles.card, pressed && styles.pressed]}>
          <PosterImage uri={crew.coverUrl} label={crew.name} radius={12} style={styles.cover} />
          <ThemedText type="smallBold" numberOfLines={2}>
            {crew.name}
          </ThemedText>
          <View style={styles.metaRow}>
            <Tag label={t(tag.labelKey)} tone={tag.tone} />
            {metaLabel ? <Tag label={metaLabel} /> : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  stateContainer: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    gap: Spacing.five,
  },
  listContent: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  listHeader: {
    marginBottom: Spacing.five,
  },
  grid: {
    gap: Spacing.four,
  },
  gridRow: {
    flexDirection: "row",
    gap: Spacing.three,
  },
  column: {
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  cardItem: {
    flex: 1,
    minWidth: 0,
  },
  cardPressable: {
    flex: 1,
  },
  card: {
    gap: Spacing.one + 2,
  },
  cover: {
    aspectRatio: 16 / 9,
    width: "100%",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
    minHeight: 22,
  },
  pressed: {
    opacity: 0.82,
  },
});
