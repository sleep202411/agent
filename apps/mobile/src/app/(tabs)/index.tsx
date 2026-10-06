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
import type { AppLocale } from "@/config";
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
import { useStoryTopUpRecovery } from "@/features/experience-player/hooks/use-story-top-up-recovery";
import { navigateToPlay } from "@/features/experience-player";
import { useAgentHeaderAction } from "@/hooks/use-agent-header-action";
import { useTheme } from "@/hooks/use-theme";
import { getLocale, useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

// Featured banner height — single source for the carousel slot, the card style,
// and the loading skeleton (so they can never drift apart).
const FEATURED_HEIGHT = 200;
const PAGE_SIZE = 30;
const GAMES_RAIL_SIZE = 10;

/**
 * Last successful all-genres load, kept outside the tree so the tab remount
 * after a landscape play session restores the page instead of re-skeletoning.
 * A background refetch still runs on every mount and swaps the lists in place.
 */
type HomeSnapshot = {
  locale: AppLocale;
  discovery: IpDiscovery;
  games: ExperienceGameSummary[];
  gridIps: IpSummary[];
  genres: Genre[];
  nextCursor: string | null;
};

let homeSnapshot: HomeSnapshot | undefined;
let homeScrollY = 0;

function readHomeSnapshot(): HomeSnapshot | undefined {
  // Copy stays locale-bound; a stale-language restore is worse than a skeleton.
  if (homeSnapshot && homeSnapshot.locale !== getLocale()) {
    homeSnapshot = undefined;
    homeScrollY = 0;
  }
  return homeSnapshot;
}

function openIp(id: string) {
  router.push(toHref(`/ip/${id}`));
}

function openGame(game: ExperienceGameSummary) {
  navigateToPlay(router, game);
}

export default function IpDiscoveryScreen() {
  const topUpRecovery = useStoryTopUpRecovery();
  const t = useTranslations();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const agentAction = useAgentHeaderAction();
  const { width } = useWindowDimensions();
  const featuredWidth = Math.min(width, MaxContentWidth) - Spacing.four * 2;
  const cardWidth = Math.floor((featuredWidth - Spacing.three) / 2);

  const [restored] = useState(readHomeSnapshot);
  // Only meaningful alongside a restore — a cold mount always starts at the top.
  const [initialScrollY] = useState(() => (restored ? homeScrollY : 0));

  // Featured carousel + trending rail come from the discovery placements.
  const [discovery, setDiscovery] = useState<IpDiscovery | undefined>(restored?.discovery);
  // Published interactive films (影游) for the home rail — failures stay quiet.
  const [games, setGames] = useState<ExperienceGameSummary[]>(restored?.games ?? []);
  // The "All IPs" grid is its own cursor-paginated catalog (infinite scroll).
  const [gridIps, setGridIps] = useState<IpSummary[]>(restored?.gridIps ?? []);
  const [genres, setGenres] = useState<Genre[]>(restored?.genres ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(restored?.nextCursor ?? null);

  const [loading, setLoading] = useState(restored === undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [pageError, setPageError] = useState<string>();
  const [genreIndex, setGenreIndex] = useState(0);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  // Bumped when a mutation elsewhere (e.g. blocking an IP) invalidates lists.
  const browseVersion = useBrowseVersion();
  const hasDataRef = useRef(restored !== undefined);
  // Stops a fling from queuing a second page-2 fetch before the first resolves.
  const loadingMoreRef = useRef<object | null>(null);
  const loadSequenceRef = useRef(0);
  const gridSequenceRef = useRef(0);
  const replacingGridRef = useRef(false);
  const loadedGenreRef = useRef<string | undefined>(undefined);

  const selectedGenreCode = genreIndex > 0 ? genres[genreIndex - 1]?.code : undefined;
  const activeGenreLabel =
    genreIndex > 0 ? (genres[genreIndex - 1]?.label ?? t("home.genreThis")) : t("home.genreAll");
  const genreChips = useMemo(
    () => [t("home.genreAll"), ...genres.map((genre) => genre.label)],
    [genres, t]
  );

  const load = useCallback(async () => {
    const seq = ++loadSequenceRef.current;
    const gridSeq = ++gridSequenceRef.current;
    const locale = getLocale();
    replacingGridRef.current = true;
    loadingMoreRef.current = null;
    setLoadingMore(false);
    setRefreshing(false);
    setLoading(hasDataRef.current === false);
    setError(undefined);
    setPageError(undefined);
    try {
      const [data, page, gameList] = await Promise.all([
        getIpDiscovery(),
        getIpCatalogPage({ genreCode: selectedGenreCode, limit: PAGE_SIZE }),
        listPublishedInteractiveFilms({ page: 1, pageSize: GAMES_RAIL_SIZE }).catch(
          () => [] as ExperienceGameSummary[]
        ),
      ]);
      if (seq !== loadSequenceRef.current) return;
      hasDataRef.current = true;
      setDiscovery(data);
      setGames(gameList);
      // A genre selection made during this full read owns the grid independently.
      if (gridSeq === gridSequenceRef.current) {
        loadedGenreRef.current = selectedGenreCode;
        setGridIps(page.items);
        setNextCursor(page.nextCursor);
        const taxonomy = data.genres.length ? data.genres : page.genres;
        if (taxonomy.length) setGenres(taxonomy);
        if (!selectedGenreCode) {
          homeSnapshot = {
            locale,
            discovery: data,
            games: gameList,
            gridIps: page.items,
            genres: taxonomy,
            nextCursor: page.nextCursor,
          };
        }
      }
    } catch (loadError) {
      if (seq === loadSequenceRef.current && gridSeq === gridSequenceRef.current) {
        setError(loadError instanceof Error ? loadError.message : t("home.loadError"));
      }
    } finally {
      if (seq === loadSequenceRef.current) setLoading(false);
      if (gridSeq === gridSequenceRef.current) replacingGridRef.current = false;
    }
  }, [selectedGenreCode, t]);

  useEffect(() => {
    // Starts the locale/version-bound network read and resets its loading indicators.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      loadSequenceRef.current += 1;
      gridSequenceRef.current += 1;
      loadingMoreRef.current = null;
      replacingGridRef.current = false;
    };
    // Genre changes reload only the grid in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseVersion, t]);

  const previousGenreRef = useRef(selectedGenreCode);
  useEffect(() => {
    if (previousGenreRef.current === selectedGenreCode) return;
    previousGenreRef.current = selectedGenreCode;
    const seq = ++gridSequenceRef.current;
    replacingGridRef.current = true;
    loadingMoreRef.current = null;
    // Discard the abandoned page indicator while this filter read replaces its list.
    setLoadingMore(false);
    setError(undefined);
    setPageError(undefined);
    async function swapGrid() {
      try {
        const page = await getIpCatalogPage({ genreCode: selectedGenreCode, limit: PAGE_SIZE });
        if (seq !== gridSequenceRef.current) return;
        loadedGenreRef.current = selectedGenreCode;
        setGridIps(page.items);
        setNextCursor(page.nextCursor);
      } catch (loadError) {
        if (seq === gridSequenceRef.current)
          setError(loadError instanceof Error ? loadError.message : t("home.loadError"));
        // Keep the current grid; its old cursor cannot be used with the new genre.
      } finally {
        if (seq === gridSequenceRef.current) replacingGridRef.current = false;
      }
    }
    void swapGrid();
    return () => {
      if (seq === gridSequenceRef.current) gridSequenceRef.current += 1;
    };
  }, [selectedGenreCode, t]);

  const loadMore = useCallback(
    async (retry = false) => {
      if (
        !nextCursor ||
        (pageError && !retry) ||
        replacingGridRef.current ||
        loadingMoreRef.current ||
        loadedGenreRef.current !== selectedGenreCode
      )
        return;
      const seq = gridSequenceRef.current;
      const operation = {};
      loadingMoreRef.current = operation;
      setLoadingMore(true);
      setPageError(undefined);
      try {
        const page = await getIpCatalogPage({
          cursor: nextCursor,
          genreCode: selectedGenreCode,
          limit: PAGE_SIZE,
        });
        if (seq !== gridSequenceRef.current) return;
        setGridIps((current) => {
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
      } catch (loadError) {
        if (seq === gridSequenceRef.current)
          setPageError(loadError instanceof Error ? loadError.message : t("home.loadError"));
        // Keep the grid and cursor for the explicit pagination retry.
      } finally {
        if (loadingMoreRef.current === operation) {
          loadingMoreRef.current = null;
          setLoadingMore(false);
        }
      }
    },
    [nextCursor, selectedGenreCode, pageError, t]
  );

  const onRefresh = useCallback(async () => {
    const pending = load();
    const seq = loadSequenceRef.current;
    setRefreshing(true);
    try {
      await pending;
    } finally {
      if (seq === loadSequenceRef.current) setRefreshing(false);
    }
  }, [load]);

  const featured = discovery?.featured ?? [];
  const trending = discovery?.trending ?? [];

  const header = (
    <View style={styles.headerStack}>
      <ScreenHeader title={t("home.title")} action={agentAction} />
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(toHref("/discovery"))}
        style={{ paddingVertical: 12 }}
      >
        <ThemedText>{t("discovery.entry")}</ThemedText>
      </Pressable>
      {topUpRecovery}

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

      <View style={styles.section}>
        <SectionHeader
          title={t("textGames.title")}
          trailing={t("home.seeAll")}
          onPressTrailing={() => router.push(toHref("/text-games"))}
        />
      </View>

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
        {error ? (
          <EmptyState
            title={t("home.errorTitle")}
            detail={error}
            action={{ label: t("common.retry"), onPress: () => void load() }}
          />
        ) : null}
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
          <ScreenHeader title={t("home.title")} action={agentAction} />
          {topUpRecovery}
          <DiscoverySkeleton width={featuredWidth} />
        </View>
      </View>
    );
  }

  if (error && !discovery) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <View
          style={[
            styles.stateContainer,
            { paddingTop: topInset, paddingHorizontal: Math.max(insets.left, Spacing.four) },
          ]}
        >
          <ScreenHeader title={t("home.title")} action={agentAction} />
          {topUpRecovery}
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
        contentOffset={{ x: 0, y: initialScrollY }}
        onScroll={(event) => {
          // Only the unfiltered grid is restorable, so only its offset is kept.
          homeScrollY = selectedGenreCode ? 0 : event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={100}
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
        ListFooterComponent={
          pageError ? (
            <EmptyState
              title={t("home.errorTitle")}
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
      onPress={() => openGame(game)}
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
