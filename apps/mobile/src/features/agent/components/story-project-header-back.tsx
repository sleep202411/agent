import IconChevronLeft from "@tabler/icons-react-native/icons/IconChevronLeft";
import { useRouter } from "expo-router";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useStoryChapterContext } from "@/features/agent/context/story-chapter-context";

/** Back + project title. */
export function StoryProjectHeaderBack({ tintColor }: { tintColor: string }) {
  const router = useRouter();
  const { projectTitle } = useStoryChapterContext();
  const canGoBack = router.canGoBack();

  return (
    <View style={styles.row}>
      {canGoBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.back}
        >
          <IconChevronLeft color={tintColor} size={24} strokeWidth={2} />
        </Pressable>
      ) : null}
      {projectTitle ? (
        <Text style={[styles.title, { color: tintColor }]} numberOfLines={1}>
          {projectTitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    maxWidth: 220,
    marginLeft: Platform.OS === "ios" ? 0 : 4,
  },
  back: {
    padding: 4,
    marginRight: -2,
  },
  title: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.15,
  },
});
