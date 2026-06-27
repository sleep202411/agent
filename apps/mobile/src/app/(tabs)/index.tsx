import { SymbolView } from "expo-symbols";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Carousel from "react-native-reanimated-carousel";

import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
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
import type { IpStatus, IpSummary } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { type MessageKey, useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

// Featured banner height — single source for the carousel slot, the card style,
// and the loading skeleton (so they can never drift apart).
const FEATURED_HEIGHT = 200;

function statusTagKey(status: IpStatus): {
  labelKey: MessageKey;
  tone: "info" | "neutral" | "warning";
} {
  if (status === "updating") return { labelKey: "home.statusUpdating", tone: "info" };
  if (status === "upcoming") return { labelKey: "home.statusUpcoming", tone: "warning" };
  return { labelKey: "home.statusCompleted", tone: "neutral" };
}

function openIp(id: string) {
  router.push(toHref(`/ip/${id}`));
}

export default function IpDiscoveryScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const featuredWidth = Math.min(width, MaxContentWidth) - Spacing.four * 2;
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
              <SectionHeader title={t("home.trendingTitle")} trailing={`${trending.length}`} />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rankRow}
              >
                {trending.map((ip) => (
                  <TrendingCard key={ip.id} ip={ip} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.section}>
            <SectionHeader title={t("home.allIpsTitle")} trailing={`${allIps.length}`} />
            {genreChips.length > 1 ? (
              <ChipRail items={genreChips} activeIndex={genreIndex} onChange={setGenreIndex} />
            ) : null}
            {allIps.length ? (
              <View style={styles.list}>
                {allIps.map((ip) => (
                  <IpRow key={ip.id} ip={ip} />
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

function TrendingCard({ ip }: { ip: IpSummary }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => openIp(ip.id)} style={styles.rankCard}>
      <PosterImage uri={ip.coverUrl} label={ip.title} style={styles.rankPoster} />
      <ThemedText type="smallBold" numberOfLines={2}>
        {ip.title}
      </ThemedText>
      <RatingRow rating={ip.rating} />
    </Pressable>
  );
}

function IpRow({ ip }: { ip: IpSummary }) {
  const t = useTranslations();
  const tag = statusTagKey(ip.status);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openIp(ip.id)}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <ThemedView type="backgroundElement" style={styles.ipRow}>
        <PosterImage uri={ip.coverUrl} label={ip.title} style={styles.rowPoster} />
        <View style={styles.rowCopy}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {ip.title}
          </ThemedText>
          <View style={styles.rowMeta}>
            {ip.year ? (
              <ThemedText type="code" themeColor="textSecondary">
                {ip.year}
              </ThemedText>
            ) : null}
            {ip.episodeCount ? (
              <ThemedText type="code" themeColor="textSecondary">
                · {ip.episodeCount} {t("home.episodesSuffix")}
              </ThemedText>
            ) : null}
            <Tag label={t(tag.labelKey)} tone={tag.tone} />
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {ip.synopsis}
          </ThemedText>
        </View>
      </ThemedView>
    </Pressable>
  );
}

function DiscoverySkeleton({ width }: { width: number }) {
  return (
    <>
      <Skeleton width={width} height={FEATURED_HEIGHT} radius={12} />
      <View style={styles.rankRow}>
        {[0, 1, 2].map((item) => (
          <View key={item} style={styles.rankCard}>
            <Skeleton height={168} radius={8} />
            <Skeleton width="80%" height={14} />
          </View>
        ))}
      </View>
      <View style={styles.list}>
        {[0, 1, 2].map((item) => (
          <ThemedView key={item} type="backgroundElement" style={styles.ipRow}>
            <Skeleton width={64} height={92} radius={8} />
            <View style={styles.rowCopy}>
              <Skeleton width="70%" height={16} />
              <Skeleton width="40%" height={12} />
              <Skeleton width="100%" height={32} />
            </View>
          </ThemedView>
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
  rankRow: {
    gap: Spacing.three,
    paddingRight: Spacing.four,
  },
  rankCard: {
    width: 116,
    gap: Spacing.one,
  },
  rankPoster: {
    width: 116,
    height: 164,
  },
  list: {
    gap: Spacing.two,
  },
  ipRow: {
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    gap: Spacing.three,
  },
  rowPoster: {
    width: 64,
    height: 92,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.one,
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
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
