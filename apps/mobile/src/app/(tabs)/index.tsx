import { SymbolView } from "expo-symbols";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Carousel from "react-native-reanimated-carousel";

import { ThemedText } from "@/components/themed-text";
import {
  ChipRail,
  EmptyState,
  ListFooter,
  PosterImage,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  Tag,
} from "@/components/ui";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useBrowseVersion } from "@/data/browse-refresh";
import { getIpCatalogPage, getIpDiscovery, type IpDiscovery } from "@/data/browse-service";
import {
  listPublishedInteractiveFilms,
  type ExperienceGameSummary,
} from "@/data/interactive-film-api";
import type { Genre, IpSummary } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

// Featured banner height — single source for the carousel slot, the card style,
// and the loading skeleton (so they can never drift apart).
const FEATURED_HEIGHT = 200;
const PAGE_SIZE = 30;
const GAMES_RAIL_SIZE = 10;

function openIp(id: string) {
  router.push(toHref(`/ip/${id}`));
}

function openGame(gameId: string) {
  router.push(toHref(`/play/${gameId}`));
}

export default function IpDiscoveryScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const featuredWidth = Math.min(width, MaxContentWidth) - Spacing.four * 2;
  const cardWidth = Math.floor((featuredWidth - Spacing.three) / 2);

  // Featured carousel + trending rail come from the discovery placements.
  const [discovery, setDiscovery] = useState<IpDiscovery>();
  // Published interactive films (影游) for the home rail — failures stay quiet.
  const [games, setGames] = useState<ExperienceGameSummary[]>([]);
  // The "All IPs" grid is its own cursor-paginated catalog (infinite scroll).
  const [gridIps, setGridIps] = useState<IpSummary[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [genreIndex, setGenreIndex] = useState(0);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  // Bumped when a mutation elsewhere (e.g. blocking an IP) invalidates lists.
  const browseVersion = useBrowseVersion();
  const hasDataRef = useRef(false);
  // Stops a fling from queuing a second page-2 fetch before the first resolves.
  const loadingMoreRef = useRef(false);

  const selectedGenreCode = genreIndex > 0 ? genres[genreIndex - 1]?.code : undefined;
  const activeGenreLabel =
    genreIndex > 0 ? (genres[genreIndex - 1]?.label ?? t("home.genreThis")) : t("home.genreAll");
  const genreChips = useMemo(
    () => [t("home.genreAll"), ...genres.map((genre) => genre.label)],
    [genres, t]
  );

  // First page of the grid for the active genre. Featured/trending come from
  // discovery and are only refreshed on a full (re)load, not on genre switch.
  const loadGridFirstPage = useCallback(async (genreCode: string | undefined) => {
    const page = await getIpCatalogPage({ genreCode, limit: PAGE_SIZE });
    setGridIps(page.items);
    setNextCursor(page.nextCursor);
    // The taxonomy list rides along with each catalog page.
    if (page.genres.length) setGenres(page.genres);
    return page;
  }, []);

  const load = useCallback(async () => {
    // Skeleton only when there is nothing to show yet — refetches (locale
    // switch, browse invalidation) swap the lists in place.
    setLoading(hasDataRef.current === false);
    setError(undefined);
    try {
      const [data, , gameList] = await Promise.all([
        getIpDiscovery(),
        loadGridFirstPage(selectedGenreCode),
        listPublishedInteractiveFilms({ page: 1, pageSize: GAMES_RAIL_SIZE }).catch(
          () => [] as ExperienceGameSummary[]
        ),
      ]);
      hasDataRef.current = true;
      setDiscovery(data);
      setGames(gameList);
      // Prefer the discovery taxonomy (full list) once it lands.
      if (data.genres.length) setGenres(data.genres);
    } catch (loadError) {
      // A failed background refetch keeps the list we already have; the
      // full-screen error is reserved for an empty first load.
      if (!hasDataRef.current) {
        setError(loadError instanceof Error ? loadError.message : t("home.loadError"));
      }
    } finally {
      setLoading(false);
    }
  }, [loadGridFirstPage, selectedGenreCode, t]);

  useEffect(() => {
    void load();
    // `load` intentionally excluded: it closes over selectedGenreCode, but the
    // genre switch is handled by its own effect below to avoid refetching the
    // carousel + rail on every chip tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseVersion, t]);

  // Genre switch → reload just the grid (keep the carousel + rail in place).
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    let alive = true;
    async function swapGrid() {
      try {
        const page = await getIpCatalogPage({ genreCode: selectedGenreCode, limit: PAGE_SIZE });
        if (!alive) return;
        setGridIps(page.items);
        setNextCursor(page.nextCursor);
      } catch {
        // Keep the current grid on a failed genre switch.
      }
    }
    void swapGrid();
    return () => {
      alive = false;
    };
  }, [selectedGenreCode]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await getIpCatalogPage({
        cursor: nextCursor,
        genreCode: selectedGenreCode,
        limit: PAGE_SIZE,
      });
      setGridIps((current) => {
        const seen = new Set(current.map((ip) => ip.id));
        return [...current, ...page.items.filter((ip) => !seen.has(ip.id))];
      });
      setNextCursor(page.nextCursor);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor, selectedGenreCode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const featured = discovery?.featured ?? [];
  const trending = discovery?.trending ?? [];

  const header = (
    <View style={styles.headerStack}>
      <ScreenHeader title={t("home.title")} />

      {featured.length ? (
        <View>
          <Carousel
            width={featuredWidth}
            height={FEATURED_HEIGHT}
            data={featured}
            loop={featured.length > 1}
            autoPlay={featured.length > 1}
            autoPlayInterval={4500}
            scrollAnimationDuration={600}
            mode="parallax"
            modeConfig={{
              parallaxScrollingScale: 0.9,
              parallaxScrollingOffset: 50,
            }}
            onSnapToItem={setFeaturedIndex}
            renderItem={({ item }) => <FeaturedCard ip={item} width={featuredWidth} />}
          />
          {featured.length > 1 ? (
            <View style={styles.dotsRow}>
              {featured.map((ip, index) => (
                <View
                  key={ip.id}
                  style={[
                    styles.dot,
                    { backgroundColor: theme.border },
                    index === featuredIndex && [styles.dotActive, { backgroundColor: theme.brand }],
                  ]}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {trending.length ? (
        <View style={styles.section}>
          <SectionHeader title={t("home.trendingTitle")} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {trending.map((ip) => (
              <TrendingCard key={ip.id} ip={ip} width={cardWidth} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {games.length ? (
        <View style={styles.section}>
          <SectionHeader
            title={t("home.gamesTitle")}
            trailing={t("home.seeAll")}
            onPressTrailing={() => router.push(toHref("/games"))}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
          >
            {games.map((game) => (
              <GameRailCard key={game.gameId} game={game} width={cardWidth} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.allHeader}>
        <SectionHeader
          title={t("home.allIpsTitle")}
          trailing={t("home.seeAll")}
          onPressTrailing={() => router.push("/ips")}
        />
        {genreChips.length > 1 ? (
          <ChipRail items={genreChips} activeIndex={genreIndex} onChange={setGenreIndex} />
        ) : null}
      </View>
    </View>
  );

  const topInset = insets.top + (Platform.OS === "web" ? Spacing.four : Spacing.three);
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
          <ScreenHeader title={t("home.title")} />
          <DiscoverySkeleton width={featuredWidth} />
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
          <ScreenHeader title={t("home.title")} />
          <EmptyState
            title={t("home.errorTitle")}
            detail={error}
            symbol={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
            action={{ label: t("common.retry"), onPress: () => void load() }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <FlatList
        data={gridIps}
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
        ListHeaderComponent={header}
        ListHeaderComponentStyle={styles.listHeader}
        ListEmptyComponent={
          <EmptyState
            title={t("home.emptyTitle")}
            detail={`${t("home.emptyDetailPrefix")}${activeGenreLabel}${t("home.emptyDetailSuffix")}`}
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
          <View style={styles.cardCell}>
            <GridCard ip={item} />
          </View>
        )}
      />
    </View>
  );
}

function RatingRow({ rating }: { rating?: number }) {
  const theme = useTheme();
  if (rating == null) return null;
  return (
    <View style={styles.ratingRow}>
      <SymbolView
        name={{ ios: "star.fill", android: "star", web: "star" }}
        size={11}
        tintColor={theme.brand}
      />
      <ThemedText type="code" style={{ color: theme.brand }}>
        {rating.toFixed(1)}
      </ThemedText>
    </View>
  );
}

function FeaturedCard({ ip, width }: { ip: IpSummary; width: number }) {
  const t = useTranslations();
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openIp(ip.id)}
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
    >
      <View style={styles.featuredCard}>
        <PosterImage
          uri={ip.backdropUrl ?? ip.coverUrl}
          label={ip.title}
          radius={12}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.featuredScrim} />
        <View style={styles.featuredTopRow}>
          <View style={[styles.featuredBadge, { backgroundColor: theme.brand }]}>
            <ThemedText type="code" style={styles.featuredBadgeText}>
              {t("home.featuredBadge")}
            </ThemedText>
          </View>
          <RatingRow rating={ip.rating} />
        </View>
        <View style={styles.featuredCopy}>
          <ThemedText type="subtitle" style={styles.featuredTitle} numberOfLines={1}>
            {ip.title}
          </ThemedText>
          {ip.tagline ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {ip.tagline}
            </ThemedText>
          ) : null}
          <View style={styles.tagRow}>
            {ip.genres.slice(0, 3).map((genre) => (
              <Tag key={genre} label={genre} />
            ))}
            <View style={[styles.watchPill, { backgroundColor: theme.brand }]}>
              <SymbolView
                name={{ ios: "play.fill", android: "play_arrow", web: "play_arrow" }}
                size={12}
                tintColor="#FFFFFF"
              />
              <ThemedText type="code" style={styles.watchText}>
                {t("home.watch")}
              </ThemedText>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/** Fixed-width poster for the horizontal "For you" rail. */
function TrendingCard({ ip, width }: { ip: IpSummary; width: number }) {
  const type = ip.genres[0] ?? ip.typeTags[0];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openIp(ip.id)}
      style={({ pressed }) => [{ width, maxWidth: width }, pressed && styles.pressed]}
    >
      <PosterImage
        uri={ip.backdropUrl ?? ip.coverUrl}
        label={ip.title}
        radius={10}
        style={{ width, height: width * (9 / 16) }}
      />
      <ThemedText
        type="smallBold"
        numberOfLines={2}
        style={[styles.gridTitle, { maxWidth: width }]}
      >
        {ip.title}
      </ThemedText>
      <View style={styles.gridMeta}>
        {ip.regionLabel ? <Tag label={ip.regionLabel} /> : null}
        {type ? <Tag label={type} /> : null}
      </View>
    </Pressable>
  );
}

/** Fixed-width poster for the home interactive-film (影游) rail. */
function GameRailCard({ game, width }: { game: ExperienceGameSummary; width: number }) {
  const t = useTranslations();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openGame(game.gameId)}
      style={({ pressed }) => [{ width, maxWidth: width }, pressed && styles.pressed]}
    >
      <PosterImage
        uri={game.coverUrl}
        label={game.title}
        radius={10}
        style={{ width, height: width * (9 / 16) }}
      />
      <ThemedText
        type="smallBold"
        numberOfLines={2}
        style={[styles.gridTitle, { maxWidth: width }]}
      >
        {game.title}
      </ThemedText>
      <View style={styles.gridMeta}>
        <Tag label={t("home.gamesBadge")} />
      </View>
    </Pressable>
  );
}

/** Flex poster card for a 2-column FlatList grid cell. */
function GridCard({ ip }: { ip: IpSummary }) {
  const type = ip.genres[0] ?? ip.typeTags[0];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openIp(ip.id)}
      style={({ pressed }) => [styles.gridCard, pressed && styles.pressed]}
    >
      <PosterImage
        uri={ip.backdropUrl ?? ip.coverUrl}
        label={ip.title}
        radius={10}
        style={styles.gridCover}
      />
      <ThemedText type="smallBold" numberOfLines={2} style={styles.gridTitle}>
        {ip.title}
      </ThemedText>
      <View style={styles.gridMeta}>
        {ip.regionLabel ? <Tag label={ip.regionLabel} /> : null}
        {type ? <Tag label={type} /> : null}
      </View>
    </Pressable>
  );
}

function DiscoverySkeleton({ width }: { width: number }) {
  const cardWidth = Math.floor((width - Spacing.three) / 2);
  return (
    <>
      <Skeleton width={width} height={FEATURED_HEIGHT} radius={12} />
      <View style={styles.grid}>
        {[0, 1, 2, 3].map((item) => (
          <View key={item} style={{ width: cardWidth, gap: Spacing.two }}>
            <Skeleton width={cardWidth} height={cardWidth * (9 / 16)} radius={10} />
            <Skeleton width="80%" height={14} />
            <Skeleton width="50%" height={10} />
          </View>
        ))}
      </View>
    </>
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
  },
  headerStack: {
    gap: Spacing.five,
  },
  allHeader: {
    gap: Spacing.three,
  },
  column: {
    gap: Spacing.three,
  },
  cardCell: {
    flex: 1,
    minWidth: 0,
    marginBottom: Spacing.four,
  },
  gridCard: {
    minWidth: 0,
  },
  gridCover: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  featuredCard: {
    height: FEATURED_HEIGHT,
    borderRadius: 12,
    overflow: "hidden",
    justifyContent: "space-between",
    padding: Spacing.three,
  },
  featuredScrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(7,8,12,0.34)",
  },
  featuredTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  featuredBadge: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  featuredBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    letterSpacing: 0.4,
  },
  featuredCopy: {
    gap: Spacing.one,
  },
  featuredTitle: {
    fontSize: 26,
    lineHeight: 30,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    marginTop: Spacing.half,
  },
  watchPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 22,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginLeft: "auto",
  },
  watchText: {
    color: "#FFFFFF",
    fontSize: 11,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  section: {
    gap: Spacing.three,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.three,
  },
  rail: {
    gap: Spacing.three,
    paddingRight: Spacing.four,
  },
  gridTitle: {
    marginTop: Spacing.two,
  },
  gridMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.two,
  },
  pressed: {
    opacity: 0.82,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 16,
  },
});
