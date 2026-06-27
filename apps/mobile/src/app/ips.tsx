import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IpGrid } from "@/components/ip-grid";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ChipRail, EmptyState, ScreenHeader, Skeleton } from "@/components/ui";
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
  const [error, setError] = useState<string>();
  const hasDataRef = useRef(false);

  const loadFirstPage = useCallback(async () => {
    setLoading(hasDataRef.current === false);
    setError(undefined);
    try {
      const page = await getIpCatalogPage({
        genreCode: selectedGenreCode,
        limit: 50,
        regionCode: selectedRegionCode,
        typeCode: selectedTypeCode,
      });
      hasDataRef.current = true;
      setIps(page.items);
      setNextCursor(page.nextCursor);
      setGenres(page.genres);
      setTypeTags(page.typeTags);
      setRegions((current) => mergeRegions(current, page.regions));
    } catch (loadError) {
      if (!hasDataRef.current) {
        setError(loadError instanceof Error ? loadError.message : t("ips.loadErrorFallback"));
      }
    } finally {
      setLoading(false);
    }
  }, [selectedGenreCode, selectedRegionCode, selectedTypeCode, t]);

  useEffect(() => {
    void loadFirstPage();
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

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getIpCatalogPage({
        cursor: nextCursor,
        genreCode: selectedGenreCode,
        limit: 50,
        regionCode: selectedRegionCode,
        typeCode: selectedTypeCode,
      });
      setIps((current) => {
        const seen = new Set(current.map((ip) => ip.id));
        return [...current, ...page.items.filter((ip) => !seen.has(ip.id))];
      });
      setNextCursor(page.nextCursor);
      setGenres(page.genres);
      setTypeTags(page.typeTags);
      setRegions((current) => mergeRegions(current, page.regions));
    } finally {
      setLoadingMore(false);
    }
  }

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
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        style={[styles.scroll, { backgroundColor: theme.background }]}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.seven,
            paddingBottom: insets.bottom + Spacing.seven,
            paddingLeft: Math.max(insets.left, Spacing.four),
            paddingRight: Math.max(insets.right, Spacing.four),
          },
        ]}
      >
        <View style={styles.page}>
          <ScreenHeader title={t("ips.title")} />

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

          {loading ? (
            <CatalogSkeleton />
          ) : error ? (
            <EmptyState
              title={t("ips.loadErrorTitle")}
              detail={error}
              symbol={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
            />
          ) : ips.length ? (
            <>
              <IpGrid ips={ips} />
              {nextCursor ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={loadingMore}
                  onPress={loadMore}
                  style={({ pressed }) => [
                    styles.moreButton,
                    { backgroundColor: theme.backgroundElement },
                    pressed && styles.pressed,
                  ]}
                >
                  <ThemedText type="smallBold">
                    {loadingMore ? t("ips.loadingMore") : t("ips.loadMore")}
                  </ThemedText>
                </Pressable>
              ) : null}
            </>
          ) : (
            <EmptyState
              title={t("home.emptyTitle")}
              detail={hasActiveFilters ? t("home.emptyFilteredDetail") : t("ips.emptyDetail")}
            />
          )}
        </View>
      </ScrollView>
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
  scroll: {
    flex: 1,
  },
  content: {
    alignItems: "center",
  },
  page: {
    width: "100%",
    maxWidth: MaxContentWidth,
    gap: Spacing.five,
  },
  filterStack: {
    gap: Spacing.two,
  },
  moreButton: {
    minHeight: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
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
  pressed: {
    opacity: 0.72,
  },
});
