import { VideoChannelPicker } from "@/features/ip-community/video-channel-picker";
import { Stack, useLocalSearchParams, router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { toHref } from "@/lib/navigation";
import { IpGridCard } from "@/components/ip-grid";
import { ThemedView } from "@/components/themed-view";
import { ChipRail, EmptyState, ListFooter, ScreenHeader, Skeleton } from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useBrowseVersion } from "@/data/browse-refresh";
import { getIpCatalogPage } from "@/data/browse-service";
import type { Genre, IpSummary, Region, TaxonomyTerm } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

type Params = {
  genre?: string;
  region?: string;
  type?: string;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function mergeRegions(current: Region[], next: Region[]): Region[] {
  const map = new Map(current.map((region) => [region.code, region]));
  for (const region of next) map.set(region.code, region);
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

const PAGE_SIZE = 50;

export default function AllIpsScreen() {
  const params = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const t = useTranslations();
  const browseVersion = useBrowseVersion();
  const [ips, setIps] = useState<IpSummary[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [typeTags, setTypeTags] = useState<TaxonomyTerm[]>([]);
  const [selectedGenreCode, setSelectedGenreCode] = useState<string | undefined>(
    firstParam(params.genre)
  );
  const [selectedRegionCode, setSelectedRegionCode] = useState<string | undefined>(
    firstParam(params.region)
  );
  const [selectedTypeCode, setSelectedTypeCode] = useState<string | undefined>(
    firstParam(params.type)
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [refreshError, setRefreshError] = useState<string>();
  const [pageError, setPageError] = useState<string>();
  const hasDataRef = useRef(false);
  // Guards onEndReached from firing a second page-2 fetch before the first
  // resolves (FlatList can call onEndReached repeatedly during a fling).
  const loadingMoreRef = useRef<object | null>(null);
  const replacingRef = useRef(false);
  const sequenceRef = useRef(0);
  const filterKey = JSON.stringify([selectedGenreCode, selectedRegionCode, selectedTypeCode]);
  const loadedFilterRef = useRef<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    const seq = ++sequenceRef.current;
    replacingRef.current = true;
    loadingMoreRef.current = null;
    setLoadingMore(false);
    setPageError(undefined);
    setRefreshError(undefined);
    setRefreshing(false);
    if (loadedFilterRef.current !== filterKey) {
      // A new filter must never display results belonging to the previous one.
      hasDataRef.current = false;
      loadedFilterRef.current = null;
      setIps([]);
      setNextCursor(null);
    }
    setLoading(hasDataRef.current === false);
    setError(undefined);
    try {
      const page = await getIpCatalogPage({
        genreCode: selectedGenreCode,
        limit: PAGE_SIZE,
        regionCode: selectedRegionCode,
        typeCode: selectedTypeCode,
      });
      if (seq !== sequenceRef.current) return;
      loadedFilterRef.current = filterKey;
      hasDataRef.current = true;
      setIps(page.items);
      setNextCursor(page.nextCursor);
      setGenres(page.genres);
      setTypeTags(page.typeTags);
      setRegions((current) => mergeRegions(current, page.regions));
    } catch (loadError) {
      if (seq === sequenceRef.current) {
        const message =
          (loadError instanceof Error && loadError.message) || t("ips.loadErrorFallback");
        if (hasDataRef.current) setRefreshError(message);
        else setError(message);
      }
    } finally {
      if (seq === sequenceRef.current) {
        replacingRef.current = false;
        setLoading(false);
      }
    }
  }, [selectedGenreCode, selectedRegionCode, selectedTypeCode, t, filterKey]);

  useEffect(() => {
    // Synchronize the catalog read and its loading indicators with the selected filters.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFirstPage();
    return () => {
      sequenceRef.current += 1;
      loadingMoreRef.current = null;
      replacingRef.current = false;
    };
  }, [loadFirstPage, browseVersion]);

  const genreChips = useMemo(
    () => [t("home.genreAll"), ...genres.map((genre) => genre.label)],
    [genres, t]
  );
  const regionChips = useMemo(
    () => [t("home.regionAll"), ...regions.map((region) => region.label)],
    [regions, t]
  );
  const typeChips = useMemo(
    () => [t("home.typeAll"), ...typeTags.map((type) => type.label)],
    [typeTags, t]
  );
  const genreIndex = selectedGenreCode
    ? Math.max(0, genres.findIndex((genre) => genre.code === selectedGenreCode) + 1)
    : 0;
  const regionIndex = selectedRegionCode
    ? Math.max(0, regions.findIndex((region) => region.code === selectedRegionCode) + 1)
    : 0;
  const typeIndex = selectedTypeCode
    ? Math.max(0, typeTags.findIndex((type) => type.code === selectedTypeCode) + 1)
    : 0;
  const hasActiveFilters = Boolean(selectedGenreCode || selectedRegionCode || selectedTypeCode);

  const loadMore = useCallback(
    async (retry = false) => {
      if (
        !nextCursor ||
        (pageError && !retry) ||
        replacingRef.current ||
        loadingMoreRef.current ||
        loadedFilterRef.current !== filterKey
      )
        return;
      const seq = sequenceRef.current;
      const operation = {};
      loadingMoreRef.current = operation;
      setLoadingMore(true);
      setPageError(undefined);
      try {
        const page = await getIpCatalogPage({
          cursor: nextCursor,
          genreCode: selectedGenreCode,
          limit: PAGE_SIZE,
          regionCode: selectedRegionCode,
          typeCode: selectedTypeCode,
        });
        if (seq !== sequenceRef.current) return;
        setIps((current) => {
          const seen = new Set(current.map((ip) => ip.id));
          return [
            ...current,
            ...page.items.filter((ip) => {
              if (seen.has(ip.id)) return false;
              seen.add(ip.id);
              return true;
            }),
          ];
        });
        setNextCursor(page.nextCursor);
        setGenres(page.genres);
        setTypeTags(page.typeTags);
        setRegions((current) => mergeRegions(current, page.regions));
      } catch (loadError) {
        if (seq === sequenceRef.current) {
          setPageError(
            (loadError instanceof Error && loadError.message) || t("ips.loadErrorFallback")
          );
        }
      } finally {
        if (loadingMoreRef.current === operation) {
          loadingMoreRef.current = null;
          setLoadingMore(false);
        }
      }
    },
    [nextCursor, selectedGenreCode, selectedRegionCode, selectedTypeCode, filterKey, pageError, t]
  );

  const onRefresh = useCallback(async () => {
    const pending = loadFirstPage();
    const seq = sequenceRef.current;
    setRefreshing(true);
    try {
      await pending;
    } finally {
      if (seq === sequenceRef.current) setRefreshing(false);
    }
  }, [loadFirstPage]);

  const header = (
    <View style={styles.headerStack}>
      <ScreenHeader title={t("ips.title")} />
      <VideoChannelPicker />
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(toHref("/content-gps"))}
        style={{ minHeight: 44, paddingVertical: 12 }}
      >
        <ThemedText>{t("contentGpsDiscovery.title")}</ThemedText>
      </Pressable>
      {refreshError ? (
        <EmptyState
          title={t("ips.loadErrorTitle")}
          detail={refreshError}
          action={{ label: t("common.retry"), onPress: () => void loadFirstPage() }}
        />
      ) : null}
      <View style={styles.filterStack}>
        {genreChips.length > 1 ? (
          <ChipRail
            items={genreChips}
            activeIndex={genreIndex}
            onChange={(index) =>
              setSelectedGenreCode(index > 0 ? genres[index - 1]?.code : undefined)
            }
          />
        ) : null}
        {regionChips.length > 1 ? (
          <ChipRail
            items={regionChips}
            activeIndex={regionIndex}
            onChange={(index) =>
              setSelectedRegionCode(index > 0 ? regions[index - 1]?.code : undefined)
            }
          />
        ) : null}
        {typeChips.length > 1 ? (
          <ChipRail
            items={typeChips}
            activeIndex={typeIndex}
            onChange={(index) =>
              setSelectedTypeCode(index > 0 ? typeTags[index - 1]?.code : undefined)
            }
          />
        ) : null}
      </View>
    </View>
  );

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerTitle: "",
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: theme.text,
        }}
      />
      {loading ? (
        <View
          style={[
            styles.stateContainer,
            { paddingTop: insets.top + Spacing.seven, paddingHorizontal: Spacing.four },
          ]}
        >
          {header}
          <CatalogSkeleton />
        </View>
      ) : error ? (
        <View
          style={[
            styles.stateContainer,
            { paddingTop: insets.top + Spacing.seven, paddingHorizontal: Spacing.four },
          ]}
        >
          {header}
          <EmptyState
            title={t("ips.loadErrorTitle")}
            detail={error}
            action={{ label: t("common.retry"), onPress: () => void loadFirstPage() }}
            symbol={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
          />
        </View>
      ) : (
        <FlatList
          data={ips}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.column}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="never"
          style={{ backgroundColor: theme.background }}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingTop: insets.top + Spacing.seven,
              paddingBottom: insets.bottom + Spacing.seven,
              paddingLeft: Math.max(insets.left, Spacing.four),
              paddingRight: Math.max(insets.right, Spacing.four),
            },
          ]}
          ListHeaderComponent={header}
          ListHeaderComponentStyle={styles.listHeader}
          ListEmptyComponent={
            <EmptyState
              title={t("home.emptyTitle")}
              detail={hasActiveFilters ? t("home.emptyFilteredDetail") : t("ips.emptyDetail")}
            />
          }
          ListFooterComponent={
            pageError ? (
              <EmptyState
                title={t("ips.loadErrorTitle")}
                detail={pageError}
                action={{ label: t("common.retry"), onPress: () => void loadMore(true) }}
              />
            ) : (
              <ListFooter loading={loadingMore} />
            )
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
            <View style={styles.cardCell}>
              <IpGridCard ip={item} />
            </View>
          )}
        />
      )}
    </ThemedView>
  );
}

function CatalogSkeleton() {
  return (
    <View style={styles.skeletonGrid}>
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.skeletonRow}>
          {[0, 1].map((col) => (
            <View key={col} style={styles.skeletonCard}>
              <Skeleton width="100%" height={120} radius={12} />
              <Skeleton width="72%" height={14} />
              <Skeleton width="90%" height={12} />
            </View>
          ))}
        </View>
      ))}
    </View>
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
    marginBottom: Spacing.four,
    gap: Spacing.five,
  },
  headerStack: {
    gap: Spacing.five,
  },
  column: {
    gap: Spacing.three,
  },
  cardCell: {
    flex: 1,
    minWidth: 0,
    marginBottom: Spacing.four,
  },
  filterStack: {
    gap: Spacing.two,
  },
  skeletonGrid: {
    gap: Spacing.four,
  },
  skeletonRow: {
    flexDirection: "row",
    gap: Spacing.three,
  },
  skeletonCard: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.one + 2,
  },
});
