import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ChipRail, EmptyState, PosterImage, ScreenHeader, Skeleton } from "@/components/ui";
import { webBaseUrl, type AppLocale } from "@/config";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { getNewsFeed } from "@/data/browse-service";
import type { NewsArticle, NewsTag } from "@/data/types";
import { useLocale, useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";

/**
 * The admin default "全部" tag is attached to everything — it duplicates the
 * synthetic All chip, so it never appears as a chip of its own.
 */
const ALL_TAG_ID = "all";

function openArticle(article: NewsArticle, locale: AppLocale) {
  // External items are bare links; internal articles render on the site's
  // /news/:id detail page (mobile has no native article body screen).
  const url =
    article.kind === "external" ? article.url : `${webBaseUrl}/${locale}/news/${article.id}`;
  if (url) void WebBrowser.openBrowserAsync(url);
}

export default function NewsScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const hasDataRef = useRef(false);
  // The payload is locale-dependent (titles/tag labels resolve server-side), so
  // a straggling response from a superseded request must never win over the
  // current locale's — each load takes a sequence ticket and stale ones bail.
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    // Skeleton only when there is nothing to show yet — refetches swap in place.
    setLoading(hasDataRef.current === false);
    setError(undefined);
    try {
      const data = await getNewsFeed(locale);
      if (seq !== requestSeqRef.current) return;
      hasDataRef.current = true;
      setArticles(data);
    } catch (loadError) {
      // A failed background refetch keeps the list we already have.
      if (seq === requestSeqRef.current && !hasDataRef.current) {
        setError(loadError instanceof Error ? loadError.message : t("news.loadError"));
      }
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [locale, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // No public tag-list endpoint — the rail derives from the tags actually
  // present on published items, so it grows as the admin tags content.
  const tagOptions = useMemo<NewsTag[]>(() => {
    const seen = new Map<string, string>();
    for (const article of articles) {
      for (const tag of article.tags) {
        if (tag.id !== ALL_TAG_ID && !seen.has(tag.id)) seen.set(tag.id, tag.label);
      }
    }
    return [...seen].map(([id, label]) => ({ id, label }));
  }, [articles]);

  // A selected tag can disappear after a refetch (item unpublished/retagged).
  const effectiveTagId = tagOptions.some((tag) => tag.id === activeTagId) ? activeTagId : null;
  const filtered = effectiveTagId
    ? articles.filter((article) => article.tags.some((tag) => tag.id === effectiveTagId))
    : articles;

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

  return (
    <FlatList
      style={[styles.screen, { backgroundColor: theme.background }]}
      data={filtered}
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
              activeIndex={
                effectiveTagId ? tagOptions.findIndex((tag) => tag.id === effectiveTagId) + 1 : 0
              }
              onChange={(index) => setActiveTagId(index === 0 ? null : tagOptions[index - 1].id)}
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
      ItemSeparatorComponent={ItemSeparator}
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
