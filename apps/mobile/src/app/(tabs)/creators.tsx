import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from "react-native";

import { useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTabScreenInsets } from "@/components/tab-screen";
import { EmptyState, ListFooter, ScreenHeader, Skeleton, Tag } from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useBrowseVersion } from "@/data/browse-refresh";
import { getCreators } from "@/data/browse-service";
import type { CreatorSummary } from "@/data/types";
import { dicebearAvatarUrl } from "@/lib/avatar";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

const PAGE_SIZE = 50;

export default function CreatorsScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const { topInset, contentPadding } = useTabScreenInsets();
  const { isAuthenticated, openLogin } = useAuthGate();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [creators, setCreators] = useState<CreatorSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
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
    // Public directory (our Nest endpoint reads client_user directly), so this
    // loads for guests too; re-fetch on sign-in to lift the 50-row guest cap.
    setLoading(hasDataRef.current === false);
    setError(undefined);
    try {
      const page = await getCreators(PAGE_SIZE, 0, query);
      if (seq !== sequenceRef.current) return;
      hasDataRef.current = true;
      setCreators(page.creators);
      offsetRef.current = page.nextOffset ?? page.creators.length;
      setHasMore(
        (page.nextOffset !== undefined ? page.nextOffset > 0 : page.creators.length > 0) &&
          offsetRef.current < page.total
      );
      setRequiresLogin(page.requiresLogin);
    } catch (loadError) {
      if (seq === sequenceRef.current && !hasDataRef.current) {
        setError(loadError instanceof Error ? loadError.message : t("creators.loadErrorFallback"));
      }
    } finally {
      if (seq === sequenceRef.current) {
        replacingRef.current = false;
        setLoading(false);
      }
    }
  }, [t, query]);

  useEffect(() => {
    // Synchronize the directory and its request indicators with the current browse scope.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      sequenceRef.current += 1;
      loadingMoreRef.current = null;
      replacingRef.current = false;
    };
  }, [isAuthenticated, browseVersion, load]);

  // Authed users keep loading by offset until `total` is reached. Guests stop
  // at the public cap and get the "Sign in to see more" button instead.
  const canLoadMore = (isAuthenticated || !!query) && !requiresLogin && hasMore;

  const loadMore = useCallback(async () => {
    if (!canLoadMore || replacingRef.current || loadingMoreRef.current) return;
    const operation = {};
    const seq = sequenceRef.current;
    loadingMoreRef.current = operation;
    setLoadingMore(true);
    try {
      const page = await getCreators(PAGE_SIZE, offsetRef.current, query);
      if (seq !== sequenceRef.current) return;
      setCreators((current) => {
        const seen = new Set(current.map((creator) => creator.id));
        return [
          ...current,
          ...page.creators.filter((creator) => {
            if (seen.has(creator.id)) return false;
            seen.add(creator.id);
            return true;
          }),
        ];
      });
      const previousOffset = offsetRef.current;
      offsetRef.current = page.nextOffset ?? previousOffset + page.creators.length;
      setHasMore(offsetRef.current > previousOffset && offsetRef.current < page.total);
      setRequiresLogin(page.requiresLogin);
    } catch {
      // Retain the loaded directory and position for the next pagination retry.
    } finally {
      if (loadingMoreRef.current === operation) {
        loadingMoreRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [canLoadMore, query]);

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

  const submitSearch = () => {
    const next = search.trim();
    if (next === query) {
      void load();
      return;
    }
    // Invalidate the old query before its next page can arrive.
    sequenceRef.current += 1;
    replacingRef.current = true;
    hasDataRef.current = false;
    setCreators([]);
    setError(undefined);
    setHasMore(false);
    setRequiresLogin(false);
    setQuery(next);
  };
  const header = (
    <View style={{ gap: Spacing.three }}>
      <ScreenHeader title={t("creators.title")} />
      <Pressable accessibilityRole="button" onPress={() => router.push(toHref("/studios"))}>
        <ThemedText>{t("studioDiscovery.title")}</ThemedText>
      </Pressable>
      <TextInput
        accessibilityLabel={t("creators.search")}
        placeholder={t("creators.search")}
        placeholderTextColor={theme.textSecondary}
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={submitSearch}
        returnKeyType="search"
        autoCorrect={false}
        style={{
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          borderRadius: 8,
          padding: 12,
        }}
      />
      <Pressable accessibilityRole="button" onPress={submitSearch}>
        <ThemedText>{t("creators.searchAction")}</ThemedText>
      </Pressable>
    </View>
  );
  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <View style={[styles.stateContainer, headerPadding]}>
          {header}
          <View style={styles.grid}>
            {[0, 1].map((rowIndex) => (
              <View key={rowIndex} style={styles.gridRow}>
                {[0, 1].map((col) => (
                  <View key={col} style={styles.cardItem}>
                    <ThemedView type="backgroundElement" style={styles.card}>
                      <Skeleton width={72} height={72} radius={36} />
                      <Skeleton width="60%" height={14} />
                      <Skeleton width="42%" height={20} radius={6} />
                    </ThemedView>
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
          {header}
          <EmptyState
            title={t("creators.loadErrorTitle")}
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
        data={creators}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.column}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.listContent, contentPadding]}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={styles.listHeader}
        ListEmptyComponent={
          <EmptyState
            title={t("creators.emptyTitle")}
            detail={t("creators.emptyDetail")}
            symbol={{ ios: "person.crop.circle", android: "person", web: "person" }}
          />
        }
        ListFooterComponent={
          <>
            <ListFooter loading={loadingMore} />
            {requiresLogin ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => openLogin()}
                style={({ pressed }) => [styles.seeMore, pressed && styles.pressed]}
              >
                <ThemedText type="smallBold">{t("creators.seeMore")}</ThemedText>
              </Pressable>
            ) : null}
          </>
        }
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
            <CreatorCard creator={item} />
          </View>
        )}
      />
    </View>
  );
}

function CreatorCard({ creator }: { creator: CreatorSummary }) {
  const t = useTranslations();
  const theme = useTheme();
  // Uploaded avatar first; else a deterministic DiceBear face by id.
  const avatarUrl = creator.avatarUrl ?? dicebearAvatarUrl(`creator:${creator.id}`);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(toHref(`/creator/${creator.id}`))}
      style={styles.cardPressable}
    >
      {({ pressed }) => (
        <ThemedView type="backgroundElement" style={[styles.card, pressed && styles.pressed]}>
          <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
            <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          </View>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
            {creator.name}
          </ThemedText>
          <View style={styles.tags}>
            {creator.openToWork ? (
              <Tag label={t("creatorDetail.openToWork")} tone="success" />
            ) : creator.primaryLevel ? (
              <Tag label={creator.primaryLevel} tone="warning" />
            ) : null}
          </View>
        </ThemedView>
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
    alignItems: "center",
    borderRadius: 12,
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
  },
  avatar: {
    alignItems: "center",
    borderRadius: 36,
    height: 72,
    justifyContent: "center",
    overflow: "hidden",
    width: 72,
  },
  name: {
    maxWidth: "100%",
    textAlign: "center",
  },
  tags: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
    justifyContent: "center",
    minHeight: 22,
  },
  pressed: {
    opacity: 0.82,
  },
  seeMore: {
    alignSelf: "center",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
  },
});
