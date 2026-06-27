import { SymbolView } from "expo-symbols";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Carousel from "react-native-reanimated-carousel";

import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import {
  ChipRail,
  EmptyState,
  PosterImage,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  Tag,
} from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useBrowseVersion } from "@/data/browse-refresh";
import { getIpDiscovery, type IpDiscovery } from "@/data/browse-service";
import type { IpSummary } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

// Featured banner height — single source for the carousel slot, the card style,
// and the loading skeleton (so they can never drift apart).
const FEATURED_HEIGHT = 200;

function openIp(id: string) {
  router.push(toHref(`/ip/${id}`));
}

export default function IpDiscoveryScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const featuredWidth = Math.min(width, MaxContentWidth) - Spacing.four * 2;
  const cardWidth = Math.floor((featuredWidth - Spacing.three) / 2);
  const [discovery, setDiscovery] = useState<IpDiscovery>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [genreIndex, setGenreIndex] = useState(0);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  // Bumped when a mutation elsewhere (e.g. blocking an IP) invalidates lists.
  const browseVersion = useBrowseVersion();
  const hasDataRef = useRef(false);
  // Genres come from the Nest taxonomy endpoint (not scraped from IP records).
  const genreList = discovery?.genres ?? [];
  const genreChips = [t("home.genreAll"), ...genreList.map((genre) => genre.label)];
  const selectedGenreCode = genreIndex > 0 ? genreList[genreIndex - 1]?.code : undefined;
  const activeGenreLabel =
    genreIndex > 0 ? (genreList[genreIndex - 1]?.label ?? t("home.genreThis")) : t("home.genreAll");

  useEffect(() => {
    let alive = true;
    async function load() {
      // Skeleton only when there is nothing to show yet — refetches (locale
      // switch, browse invalidation) swap the list in place.
      setLoading(hasDataRef.current === false);
      setError(undefined);
      try {
        const data = await getIpDiscovery();
        if (alive) {
          hasDataRef.current = true;
          setDiscovery(data);
        }
      } catch (loadError) {
        // A failed background refetch keeps the list we already have; the
        // full-screen error is reserved for an empty first load.
        if (alive && !hasDataRef.current) {
          setError(loadError instanceof Error ? loadError.message : t("home.loadError"));
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [t, browseVersion]);

  const featured = discovery?.featured ?? [];
  const trending = discovery?.trending ?? [];
  const allIps = useMemo(
    () =>
      (discovery?.updating ?? []).filter(
        (ip) => !selectedGenreCode || ip.genreCodes.includes(selectedGenreCode)
      ),
    [discovery, selectedGenreCode]
  );

  return (
    <TabScreen gap={Spacing.five}>
      <ScreenHeader title={t("home.title")} />

      {loading ? (
        <DiscoverySkeleton width={featuredWidth} />
      ) : error ? (
        <EmptyState
          title={t("home.errorTitle")}
          detail={error}
          symbol={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
        />
      ) : (
        <>
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
                        index === featuredIndex && [
                          styles.dotActive,
                          { backgroundColor: theme.brand },
                        ],
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
                  <IpGridCard key={ip.id} ip={ip} width={cardWidth} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.section}>
            <SectionHeader title={t("home.allIpsTitle")} />
            {genreChips.length > 1 ? (
              <ChipRail items={genreChips} activeIndex={genreIndex} onChange={setGenreIndex} />
            ) : null}
            {allIps.length ? (
              <View style={styles.grid}>
                {allIps.map((ip) => (
                  <IpGridCard key={ip.id} ip={ip} width={cardWidth} />
                ))}
              </View>
            ) : (
              <EmptyState
                title={t("home.emptyTitle")}
                detail={`${t("home.emptyDetailPrefix")}${activeGenreLabel}${t("home.emptyDetailSuffix")}`}
              />
            )}
          </View>
        </>
      )}
    </TabScreen>
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

function IpGridCard({ ip, width }: { ip: IpSummary; width: number }) {
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
      {/* Hard-cap the title at the card width (a number, not "100%") so a long
          title wraps instead of reporting its single-line width to the flex row
          and stretching the card past `width` — which collapses the 2-up grid. */}
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
