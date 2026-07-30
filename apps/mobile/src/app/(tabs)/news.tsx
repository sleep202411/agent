import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  ChipRail,
  EmptyState,
  ListFooter,
  PosterImage,
  ScreenHeader,
  Skeleton,
} from "@/components/ui";
import { webBaseUrl, type AppLocale } from "@/config";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { getNewsFeed, getNewsTags, NEWS_PAGE_SIZE } from "@/data/browse-service";
import type { NewsArticle, NewsTag } from "@/data/types";
import { useLocale, useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";

function openArticle(article: NewsArticle, locale: AppLocale) {
  // External items are bare links; internal articles render on the site's
  // /news/:id detail page (mobile has no native article body screen).
  const url =
    article.kind === "external" ? article.url : `${webBaseUrl}/${locale}/news/${article.id}`;
  if (url) void WebBrowser.openBrowserAsync(url);
}

/** Stop paging on an empty/short page so Web onEndReached can't spin forever. */
function pageHasMore(loadedCount: number, pageArticles: NewsArticle[], total: number): boolean {
  if (pageArticles.length === 0) return false;
  if (pageArticles.length < NEWS_PAGE_SIZE) return false;
  return loadedCount < total;
}

export default function NewsScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [tagOptions, setTagOptions] = useState<NewsTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState<string>();
  // null = frontend "All" chip — no server-side tag filter.
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const hasDataRef = useRef(false);
  const activeTagIdRef = useRef<string | null>(null);
  // Locale / tag switches take a sequence ticket so stale responses never win.
  const requestSeqRef = useRef(0);
  // Guards onEndReached from firing a second page fetch before the first resolves.
  const loadingMoreRef = useRef(false);

  activeTagIdRef.current = activeTagId;

  const loadFirstPage = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setLoading(hasDataRef.current === false);
    setError(undefined);
    try {
      const tag = activeTagIdRef.current;
      const [feed, tags] = await Promise.all([
        getNewsFeed(locale, {
          page: 1,
          pageSize: NEWS_PAGE_SIZE,
          ...(tag ? { tag } : {}),
        }),
        getNewsTags(locale),
      ]);
      if (seq !== requestSeqRef.current) return;
      hasDataRef.current = true;
      setTagOptions(tags);

      const kept = tag && tags.some((item) => item.id === tag) ? tag : null;
      if (kept !== tag) setActiveTagId(kept);

      // Tag was dropped from the rail — refetch unfiltered page 1.
      if (tag && !kept) {
        const allFeed = await getNewsFeed(locale, { page: 1, pageSize: NEWS_PAGE_SIZE });
        if (seq !== requestSeqRef.current) return;
        setArticles(allFeed.articles);
        setTotal(allFeed.total);
        setPage(1);
        setHasMore(pageHasMore(allFeed.articles.length, allFeed.articles, allFeed.total));
        return;
      }

      setArticles(feed.articles);
      setTotal(feed.total);
      setPage(1);
      setHasMore(pageHasMore(feed.articles.length, feed.articles, feed.total));
    } catch (loadError) {
      if (seq === requestSeqRef.current && !hasDataRef.current) {
        setError(loadError instanceof Error ? loadError.message : t("news.loadError"));
      }
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [locale, t]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const canLoadMore = hasMore && !filtering;

  const loadMore = useCallback(async () => {
    if (!canLoadMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = requestSeqRef.current;
    const tag = activeTagIdRef.current;
    const nextPage = page + 1;
    try {
      const feed = await getNewsFeed(locale, {
        page: nextPage,
        pageSize: NEWS_PAGE_SIZE,
        ...(tag ? { tag } : {}),
      });
      if (seq !== requestSeqRef.current) return;

      if (feed.articles.length === 0) {
        setHasMore(false);
        setTotal(feed.total);
        return;
      }

      let nextLength = 0;
      setArticles((current) => {
        const seen = new Set(current.map((article) => article.id));
        const merged = [...current, ...feed.articles.filter((article) => !seen.has(article.id))];
        nextLength = merged.length;
        return merged;
      });
      setTotal(feed.total);
      setPage(nextPage);
      setHasMore(pageHasMore(nextLength, feed.articles, feed.total));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [canLoadMore, locale, page]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFirstPage();
    } finally {
      setRefreshing(false);
    }
  }, [loadFirstPage]);

  const selectTag = useCallback(
    async (tagId: string | null) => {
      const previous = activeTagIdRef.current;
      if (tagId === previous) return;
      setActiveTagId(tagId);
      const seq = ++requestSeqRef.current;
      setFiltering(true);
      try {
        const feed = await getNewsFeed(locale, {
          page: 1,
          pageSize: NEWS_PAGE_SIZE,
          ...(tagId ? { tag: tagId } : {}),
        });
        if (seq !== requestSeqRef.current) return;
        setArticles(feed.articles);
        setTotal(feed.total);
        setPage(1);
        setHasMore(pageHasMore(feed.articles.length, feed.articles, feed.total));
      } catch {
        // Keep the current list on a failed filter fetch — revert the chip.
        if (seq === requestSeqRef.current) setActiveTagId(previous);
      } finally {
        if (seq === requestSeqRef.current) setFiltering(false);
      }
    },
    [locale]
  );

  // The native tab host does NOT inset content below the status bar (verified
  // on iOS 26.3) — pad by the safe-area inset ourselves, like the mine tab.
  const topInset = insets.top + (Platform.OS === "web" ? Spacing.four : Spacing.three);
  const bottomInset = insets.bottom + BottomTabInset + Spacing.four;
  const horizontalPadding = {
    paddingLeft: Math.max(insets.left, Spacing.four),
    paddingRight: Math.max(insets.right, Spacing.four),
  };

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <View style={[styles.stateContainer, { paddingTop: topInset }, horizontalPadding]}>
          <ScreenHeader eyebrow={t("news.eyebrow")} title={t("news.title")} />
          <View style={styles.skeletonList}>
            <Skeleton height={196} radius={10} />
            {[0, 1, 2].map((item) => (
              <View key={item} style={styles.skeletonRow}>
                <Skeleton width={128} height={72} radius={8} />
                <View style={styles.skeletonCopy}>
                  <Skeleton width="100%" height={16} />
                  <Skeleton width="40%" height={12} />
                </View>
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
        <View style={[styles.stateContainer, { paddingTop: topInset }, horizontalPadding]}>
          <ScreenHeader eyebrow={t("news.eyebrow")} title={t("news.title")} />
          <EmptyState
            title={t("news.errorTitle")}
            detail={error}
            symbol={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
          />
        </View>
      </View>
    );
  }

  const activeIndex = activeTagId
    ? Math.max(0, tagOptions.findIndex((tag) => tag.id === activeTagId) + 1)
    : 0;

  return (
    <FlatList
      style={[styles.screen, { backgroundColor: theme.background }, filtering && styles.dimmed]}
      data={articles}
      keyExtractor={(article) => article.id}
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[
        styles.listContent,
        { paddingTop: topInset, paddingBottom: bottomInset },
        horizontalPadding,
      ]}
      ListHeaderComponent={
        <View style={styles.header}>
          <ScreenHeader eyebrow={t("news.eyebrow")} title={t("news.title")} />
          {tagOptions.length ? (
            <ChipRail
              items={[t("news.tagAll"), ...tagOptions.map((tag) => tag.label)]}
              activeIndex={activeIndex}
              onChange={(index) => {
                void selectTag(index === 0 ? null : (tagOptions[index - 1]?.id ?? null));
              }}
            />
          ) : null}
        </View>
      }
      ListHeaderComponentStyle={styles.listHeader}
      ListEmptyComponent={
        <EmptyState
          title={t("news.emptyTitle")}
          detail={t("news.emptyDetail")}
          symbol={{ ios: "newspaper", android: "feed", web: "feed" }}
        />
      }
      ListFooterComponent={
        loadingMore ? (
          <ListFooter loading />
        ) : hasMore || articles.length === 0 ? null : (
          <View style={[styles.endOfList, { marginBottom: -(bottomInset - Spacing.three) }]}>
            <ThemedText type="code" themeColor="textSecondary">
              {t("news.endOfList")}
            </ThemedText>
          </View>
        )
      }
      ItemSeparatorComponent={ItemSeparator}
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={theme.textSecondary}
        />
      }
      renderItem={({ item, index }) =>
        index === 0 ? (
          <View style={styles.featuredWrap}>
            <FeaturedArticle article={item} locale={locale} />
          </View>
        ) : (
          <ArticleRow article={item} locale={locale} />
        )
      }
    />
  );
}

function ItemSeparator() {
  return <View style={styles.separator} />;
}

function ArticleMeta({ article }: { article: NewsArticle }) {
  if (!article.publishedLabel) return null;
  return (
    <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
      {article.publishedLabel}
    </ThemedText>
  );
}

function FeaturedArticle({ article, locale }: { article: NewsArticle; locale: AppLocale }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openArticle(article, locale)}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <ThemedView type="backgroundElement" style={styles.featuredCard}>
        <View style={styles.featuredCoverWrap}>
          <PosterImage
            uri={article.coverUrl}
            label={article.title}
            radius={0}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={styles.featuredBody}>
          <ThemedText type="smallBold" style={styles.featuredTitle} numberOfLines={2}>
            {article.title}
          </ThemedText>
          {article.excerpt ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {article.excerpt}
            </ThemedText>
          ) : null}
          <ArticleMeta article={article} />
        </View>
      </ThemedView>
    </Pressable>
  );
}

function ArticleRow({ article, locale }: { article: NewsArticle; locale: AppLocale }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openArticle(article, locale)}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <ThemedView type="backgroundElement" style={styles.row}>
        <PosterImage uri={article.coverUrl} label={article.title} style={styles.rowCover} />
        <View style={styles.rowCopy}>
          <ThemedText type="smallBold" numberOfLines={2}>
            {article.title}
          </ThemedText>
          <ArticleMeta article={article} />
        </View>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  dimmed: {
    opacity: 0.55,
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
  header: {
    gap: Spacing.four,
  },
  listHeader: {
    marginBottom: Spacing.five,
  },
  endOfList: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  separator: {
    height: Spacing.two,
  },
  featuredWrap: {
    marginBottom: Spacing.three,
  },
  skeletonList: {
    gap: Spacing.two,
  },
  skeletonRow: {
    flexDirection: "row",
    gap: Spacing.three,
  },
  skeletonCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  featuredCard: {
    borderRadius: 10,
    overflow: "hidden",
  },
  featuredCoverWrap: {
    aspectRatio: 16 / 9,
    width: "100%",
  },
  featuredBody: {
    padding: Spacing.three,
    gap: Spacing.one,
  },
  featuredTitle: {
    fontSize: 17,
    lineHeight: 22,
  },
  row: {
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    gap: Spacing.three,
    alignItems: "center",
  },
  rowCover: {
    width: 128,
    height: 72,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.one,
    alignItems: "flex-start",
  },
  pressed: {
    opacity: 0.82,
  },
});
