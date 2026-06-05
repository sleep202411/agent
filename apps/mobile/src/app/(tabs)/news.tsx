import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, PosterImage, ScreenHeader, Skeleton } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { getNewsFeed } from "@/data/browse-service";
import type { NewsArticle } from "@/data/types";

function openArticle(article: NewsArticle) {
  if (article.url) void WebBrowser.openBrowserAsync(article.url);
}

export default function NewsScreen() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(undefined);
      try {
        const data = await getNewsFeed();
        if (alive) setArticles(data);
      } catch (loadError) {
        if (alive)
          setError(loadError instanceof Error ? loadError.message : "Failed to load news.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const featured = articles[0];
  const rest = articles.slice(1);

  return (
    <TabScreen gap={Spacing.five}>
      <ScreenHeader eyebrow="Newsroom" title="News" />

      {loading ? (
        <View style={styles.list}>
          <Skeleton height={196} radius={10} />
          {[0, 1, 2].map((item) => (
            <View key={item} style={styles.skeletonRow}>
              <Skeleton width={72} height={72} radius={8} />
              <View style={styles.skeletonCopy}>
                <Skeleton width="100%" height={16} />
                <Skeleton width="40%" height={12} />
              </View>
            </View>
          ))}
        </View>
      ) : error ? (
        <EmptyState
          title="Couldn't load news"
          detail={error}
          symbol={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
        />
      ) : featured ? (
        <>
          <FeaturedArticle article={featured} />
          {rest.length ? (
            <View style={styles.list}>
              {rest.map((article) => (
                <ArticleRow key={article.id} article={article} />
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="No stories yet"
          detail="No news is published right now."
          symbol={{ ios: "newspaper", android: "feed", web: "feed" }}
        />
      )}
    </TabScreen>
  );
}

function ArticleMeta({ article }: { article: NewsArticle }) {
  const parts = [article.source, article.publishedLabel].filter(Boolean);
  return (
    <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
      {parts.join("  ·  ")}
    </ThemedText>
  );
}

function FeaturedArticle({ article }: { article: NewsArticle }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openArticle(article)}
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

function ArticleRow({ article }: { article: NewsArticle }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openArticle(article)}
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
  list: {
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
    height: 180,
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
    width: 72,
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
