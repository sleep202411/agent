import { router } from "expo-router";
import { useAuthGate } from "@/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTabScreenInsets } from "@/components/tab-screen";
import { EmptyState, ListFooter, PosterImage, ScreenHeader, Skeleton, Tag } from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
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
  const { topInset, contentPadding } = useTabScreenInsets();
  const [crews, setCrews] = useState<CrewSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  // Bumped when a mutation elsewhere (e.g. blocking a crew) invalidates lists.
  const browseVersion = useBrowseVersion();
  const hasDataRef = useRef(false);
  const loadingMoreRef = useRef<object | null>(null);
  const replacingRef = useRef(false);
  const sequenceRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++sequenceRef.current;
    replacingRef.current = true;
    loadingMoreRef.current = null;
    setLoadingMore(false);
    setRefreshing(false);
    // Skeleton only when there is nothing to show yet — refetches swap in place.
    setLoading(hasDataRef.current === false);
    setError(undefined);
    try {
      const page = await getCrewFeedPage({ limit: PAGE_SIZE });
      if (seq !== sequenceRef.current) return;
      hasDataRef.current = true;
      setCrews(page.items);
      setNextCursor(page.nextCursor);
    } catch (loadError) {
      // A failed background refetch keeps the list we already have.
      if (seq === sequenceRef.current && !hasDataRef.current) {
        setError(loadError instanceof Error ? loadError.message : t("crews.loadErrorFallback"));
      }
    } finally {
      if (seq === sequenceRef.current) {
        replacingRef.current = false;
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    // Synchronize the directory and its request indicators with the current browse scope.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      sequenceRef.current += 1;
      loadingMoreRef.current = null;
      replacingRef.current = false;
    };
  }, [load, browseVersion]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || replacingRef.current || loadingMoreRef.current) return;
    const operation = {};
    const seq = sequenceRef.current;
    loadingMoreRef.current = operation;
    setLoadingMore(true);
    try {
      const page = await getCrewFeedPage({ cursor: nextCursor, limit: PAGE_SIZE });
      if (seq !== sequenceRef.current) return;
      setCrews((current) => {
        const seen = new Set(current.map((crew) => crew.id));
        return [
          ...current,
          ...page.items.filter((crew) => {
            if (seen.has(crew.id)) return false;
            seen.add(crew.id);
            return true;
          }),
        ];
      });
      setNextCursor(page.nextCursor);
    } catch {
      // Retain the loaded directory and position for the next pagination retry.
    } finally {
      if (loadingMoreRef.current === operation) {
        loadingMoreRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [nextCursor]);

  const onRefresh = useCallback(async () => {
    const pending = load();
    const seq = sequenceRef.current;
    setRefreshing(true);
    try {
      await pending;
    } finally {
      if (seq === sequenceRef.current) setRefreshing(false);
    }
  }, [load]);

  const headerPadding = {
    paddingTop: topInset,
    paddingLeft: contentPadding.paddingLeft,
    paddingRight: contentPadding.paddingRight,
  };

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <View style={[styles.stateContainer, headerPadding]}>
          <CrewHeader />
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
        <View style={[styles.stateContainer, headerPadding]}>
          <CrewHeader />
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
        contentContainerStyle={[styles.listContent, contentPadding]}
        ListHeaderComponent={<CrewHeader />}
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

function CrewHeader() {
  const t = useTranslations(),
    gate = useAuthGate();
  const open = () => router.push(toHref("/crew-create"));
  return (
    <View style={{ gap: 8 }}>
      <ScreenHeader title={t("crews.title")} />
      <Pressable
        accessibilityRole="button"
        style={{ minHeight: 44, paddingVertical: 12 }}
        onPress={() => router.push(toHref("/openings"))}
      >
        <ThemedText type="small">{t("openings.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ minHeight: 44, paddingVertical: 12 }}
        onPress={() => {
          const openSaved = () => router.push(toHref("/saved-openings"));
          if (gate.requireAuth({ onAuthenticated: openSaved })) openSaved();
        }}
      >
        <ThemedText type="small">{t("savedOpenings.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ paddingVertical: 8 }}
        onPress={() => {
          if (gate.requireAuth({ onAuthenticated: open })) open();
        }}
      >
        <ThemedText type="smallBold">{t("crewCreate.createDialogTitle")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ paddingVertical: 8 }}
        onPress={() => router.push(toHref("/crew-invite"))}
      >
        <ThemedText type="small">{t("crewJoin.title")}</ThemedText>
      </Pressable>
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
