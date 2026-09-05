import { StyleSheet, Text, View } from "react-native";

import { Spacing } from "@/constants/theme";

import type { StoryScreenplayDocumentBlock } from "../lib/story-screenplay-document";

/**
 * Creator-visible screenplay — same heading ladder and body scale as PC
 * `StoryScreenplayDocumentView` (15px, h1/h2/h3, pre-wrapped paragraphs).
 */
export function StoryScreenplayDocumentView({
  blocks,
}: {
  blocks: readonly StoryScreenplayDocumentBlock[];
}) {
  return (
    <View style={styles.article}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const headingStyle =
            block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3;
          return (
            <Text key={`${index}:${block.level}:${block.text}`} style={headingStyle}>
              {block.text}
            </Text>
          );
        }
        return (
          <Text key={`${index}:p:${block.text}`} style={styles.paragraph}>
            {block.text}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  article: {
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: Spacing.six,
  },
  h1: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: -0.48,
    lineHeight: 32,
    marginTop: 4,
    marginBottom: 16,
  },
  h2: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: -0.3,
    lineHeight: 28,
    marginTop: 28,
    marginBottom: 8,
  },
  h3: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 26,
    marginTop: 20,
    marginBottom: 8,
  },
  paragraph: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    lineHeight: 24,
    marginVertical: 6,
  },
});
