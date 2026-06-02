import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const filters = ["Trending", "Animation", "Short drama", "Open roles"];

const featuredItems = [
  {
    title: "Dragon Alley",
    meta: "Animated series · recruiting",
    accent: "#E52227",
  },
  {
    title: "Sky Lantern Bureau",
    meta: "Storyboard · draft",
    accent: "#2563EB",
  },
  {
    title: "Moon Circuit",
    meta: "Sci-fi short · public",
    accent: "#16A34A",
  },
];

export default function SquareScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();
  const topInset =
    safeAreaInsets.top + (Platform.OS === "web" ? Spacing.eight + Spacing.three : Spacing.four);
  const bottomInset = safeAreaInsets.bottom + BottomTabInset + Spacing.four;

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: topInset,
          paddingBottom: bottomInset,
          paddingLeft: Math.max(safeAreaInsets.left, Spacing.four),
          paddingRight: Math.max(safeAreaInsets.right, Spacing.four),
        },
      ]}
    >
      <View style={styles.page}>
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>
            Square
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            Discover public IPs, creator teams, and active production openings.
          </ThemedText>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {filters.map((filter, index) => (
            <Pressable key={filter} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView
                type={index === 0 ? "backgroundSelected" : "backgroundElement"}
                style={styles.filterChip}
              >
                <ThemedText type="smallBold" themeColor={index === 0 ? "text" : "textSecondary"}>
                  {filter}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.feed}>
          {featuredItems.map((item) => (
            <Pressable key={item.title} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundElement" style={styles.feedCard}>
                <View style={[styles.cover, { backgroundColor: item.accent }]}>
                  <View style={styles.coverInner} />
                </View>
                <View style={styles.feedText}>
                  <ThemedText type="smallBold">{item.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.meta}
                  </ThemedText>
                </View>
              </ThemedView>
            </Pressable>
          ))}
        </View>

        <ThemedView type="backgroundElement" style={styles.notePanel}>
          <View style={[styles.noteMark, { backgroundColor: theme.brand }]} />
          <View style={styles.noteCopy}>
            <ThemedText type="smallBold">Open collaboration</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Browse productions looking for writers, directors, storyboard artists, and video
              collaborators.
            </ThemedText>
          </View>
        </ThemedView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    alignItems: "center",
  },
  page: {
    width: "100%",
    maxWidth: MaxContentWidth,
    gap: Spacing.four,
  },
  header: {
    gap: Spacing.two,
  },
  title: {
    maxWidth: 520,
    fontSize: 34,
    lineHeight: 40,
  },
  subtitle: {
    maxWidth: 540,
  },
  filters: {
    gap: Spacing.two,
    paddingRight: Spacing.four,
  },
  filterChip: {
    minHeight: 38,
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    justifyContent: "center",
  },
  feed: {
    gap: Spacing.three,
  },
  feedCard: {
    borderRadius: 8,
    overflow: "hidden",
  },
  cover: {
    height: 168,
    justifyContent: "flex-end",
    padding: Spacing.three,
  },
  coverInner: {
    width: 76,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.84)",
  },
  feedText: {
    padding: Spacing.three,
    gap: Spacing.one,
  },
  notePanel: {
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    gap: Spacing.three,
  },
  noteMark: {
    width: 4,
    borderRadius: 2,
  },
  noteCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  pressed: {
    opacity: 0.72,
  },
});
