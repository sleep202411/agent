import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { getPublicProjectFeed, getRecommendedFeed, type FeedItem } from "@/services/mobile-content";

const filters = ["Recommended", "Projects", "Videos", "Crews"] as const;

export default function HomeScreen() {
  const theme = useTheme();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [projects, setProjects] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError(undefined);

      try {
        const [recommended, publicProjects] = await Promise.all([
          getRecommendedFeed(10),
          getPublicProjectFeed(6),
        ]);
        if (!alive) return;
        setFeed(recommended);
        setProjects(publicProjects);
      } catch (loadError) {
        if (!alive) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load story square.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, []);

  function handlePress() {
    // TODO: connect to detail routes once the mobile detail screens land.
  }

  return (
    <TabScreen gap={Spacing.four}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <ThemedText type="small" themeColor="textSecondary">
            FizzDragon
          </ThemedText>
          <ThemedText type="title" style={styles.title}>
            Home
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={handlePress}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <ThemedView type="backgroundElement" style={styles.iconButton}>
            <SymbolView
              name={{ ios: "magnifyingglass", android: "search", web: "search" }}
              size={18}
              tintColor={theme.text}
            />
          </ThemedView>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {filters.map((filter, index) => (
          <ThemedView
            key={filter}
            type={index === 0 ? "backgroundSelected" : "backgroundElement"}
            style={styles.filterChip}
          >
            <ThemedText type="smallBold" themeColor={index === 0 ? "text" : "textSecondary"}>
              {filter}
            </ThemedText>
          </ThemedView>
        ))}
      </ScrollView>

      {error ? <StatePanel title="Story Square failed" detail={error} /> : null}

      <View style={styles.sectionHeader}>
        <ThemedText type="smallBold">Story Square</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {loading ? "Loading" : `${feed.length} items`}
        </ThemedText>
      </View>

      {loading ? (
        <LoadingList />
      ) : feed.length ? (
        <View style={styles.feedList}>
          {feed.map((item) => (
            <FeedRow key={item.id} item={item} onPress={handlePress} />
          ))}
        </View>
      ) : (
        <StatePanel title="No public videos" detail="The story square has no visible items yet." />
      )}

      <View style={styles.sectionHeader}>
        <ThemedText type="smallBold">Project Center</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Public
        </ThemedText>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.projectStrip}
      >
        {projects.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={handlePress}
            style={({ pressed }) => [styles.projectCardPressable, pressed && styles.pressed]}
          >
            <ThemedView type="backgroundElement" style={styles.projectCard}>
              {item.coverUrl ? (
                <Image
                  source={{ uri: item.coverUrl }}
                  style={styles.projectCover}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.projectCover, styles.coverFallback]}>
                  <SymbolView
                    name={{ ios: "film.stack", android: "movie", web: "movie" }}
                    size={22}
                    tintColor={theme.textSecondary}
                  />
                </View>
              )}
              <View style={styles.projectCopy}>
                <ThemedText type="smallBold" numberOfLines={2}>
                  {item.title}
                </ThemedText>
                <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
                  {item.creator ?? "Creator"}
                </ThemedText>
              </View>
            </ThemedView>
          </Pressable>
        ))}
      </ScrollView>
    </TabScreen>
  );
}

function FeedRow({ item, onPress }: { item: FeedItem; onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <ThemedView type="backgroundElement" style={styles.feedRow}>
        {item.coverUrl ? (
          <Image source={{ uri: item.coverUrl }} style={styles.feedCover} contentFit="cover" />
        ) : (
          <View style={[styles.feedCover, styles.coverFallback]}>
            <SymbolView
              name={{ ios: "film.stack", android: "movie", web: "movie" }}
              size={22}
              tintColor={theme.textSecondary}
            />
          </View>
        )}
        <View style={styles.feedCopy}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {item.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {item.description ?? "No introduction"}
          </ThemedText>
          <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
            {item.creator ?? "Creator"}
          </ThemedText>
        </View>
      </ThemedView>
    </Pressable>
  );
}

function LoadingList() {
  return (
    <View style={styles.feedList}>
      {[0, 1, 2].map((item) => (
        <ThemedView key={item} type="backgroundElement" style={styles.loadingRow}>
          <ThemedView type="backgroundSelected" style={styles.loadingCover} />
          <View style={styles.feedCopy}>
            <ThemedView type="backgroundSelected" style={styles.loadingTitle} />
            <ThemedView type="backgroundSelected" style={styles.loadingLine} />
            <ThemedView type="backgroundSelected" style={styles.loadingMeta} />
          </View>
        </ThemedView>
      ))}
    </View>
  );
}

function StatePanel({ detail, title }: { detail: string; title: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.statePanel}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {detail}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    marginTop: Spacing.half,
    fontSize: 28,
    lineHeight: 32,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filterRow: {
    gap: Spacing.two,
    paddingRight: Spacing.four,
  },
  filterChip: {
    minHeight: 34,
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    justifyContent: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  feedList: {
    gap: Spacing.two,
  },
  feedRow: {
    minHeight: 108,
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  feedCover: {
    width: 70,
    height: 92,
    borderRadius: 8,
    overflow: "hidden",
  },
  coverFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  feedCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  projectStrip: {
    gap: Spacing.two,
    paddingRight: Spacing.four,
  },
  projectCardPressable: {
    width: 140,
  },
  projectCard: {
    borderRadius: 8,
    overflow: "hidden",
  },
  projectCover: {
    width: "100%",
    height: 168,
  },
  projectCopy: {
    minHeight: 74,
    padding: Spacing.two,
    gap: Spacing.half,
  },
  statePanel: {
    borderRadius: 8,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  loadingRow: {
    minHeight: 108,
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    gap: Spacing.three,
  },
  loadingCover: {
    width: 70,
    height: 92,
    borderRadius: 8,
  },
  loadingTitle: {
    width: "68%",
    height: 18,
    borderRadius: 4,
  },
  loadingLine: {
    width: "100%",
    height: 36,
    borderRadius: 4,
  },
  loadingMeta: {
    width: "36%",
    height: 12,
    borderRadius: 4,
  },
  pressed: {
    opacity: 0.72,
  },
});
