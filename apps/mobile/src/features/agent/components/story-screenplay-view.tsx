import { Platform, StyleSheet, View } from "react-native";
import Markdown, { MarkdownIt } from "react-native-markdown-display";

import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const markdownIt = MarkdownIt({ typographer: false, linkify: true, html: false });

/**
 * Read-only TipTap/Yjs script renderer — same visual scale as H5 ScriptEditor
 * (15px body, heading ladder). PC edits; mobile only displays.
 */
export function StoryScreenplayView({ markdown }: { markdown: string }) {
  const theme = useTheme();
  const styles = createStyles(theme.text);

  return (
    <View style={layout.article}>
      <Markdown markdownit={markdownIt} style={styles}>
        {markdown}
      </Markdown>
    </View>
  );
}

function createStyles(textColor: string) {
  const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });
  return StyleSheet.create({
    body: {
      color: "rgba(255,255,255,0.9)",
      fontSize: 15,
      lineHeight: 24,
    },
    text: {
      color: "rgba(255,255,255,0.9)",
      fontSize: 15,
      lineHeight: 24,
    },
    heading1: {
      color: textColor,
      flexDirection: "column",
      fontSize: 24,
      fontWeight: "600",
      letterSpacing: -0.48,
      marginTop: 8,
      marginBottom: 12,
    },
    heading2: {
      color: textColor,
      flexDirection: "column",
      fontSize: 20,
      fontWeight: "600",
      letterSpacing: -0.3,
      marginTop: 28,
      marginBottom: 8,
    },
    heading3: {
      color: textColor,
      flexDirection: "column",
      fontSize: 18,
      fontWeight: "600",
      marginTop: 20,
      marginBottom: 8,
    },
    paragraph: {
      color: "rgba(255,255,255,0.9)",
      fontSize: 15,
      lineHeight: 24,
      marginTop: 6,
      marginBottom: 6,
    },
    bullet_list: {
      marginVertical: 6,
    },
    ordered_list: {
      marginVertical: 6,
    },
    list_item: {
      marginVertical: 2,
      color: "rgba(255,255,255,0.9)",
    },
    bullet_list_icon: {
      color: "rgba(255,255,255,0.9)",
      marginTop: 10,
    },
    ordered_list_icon: {
      color: "rgba(255,255,255,0.9)",
    },
    blockquote: {
      borderLeftWidth: 2,
      borderLeftColor: "rgba(255,255,255,0.2)",
      paddingLeft: 16,
      marginVertical: 8,
    },
    code_inline: {
      backgroundColor: "rgba(255,255,255,0.08)",
      borderRadius: 4,
      color: "rgba(255,255,255,0.9)",
      fontFamily: mono,
      fontSize: 13,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    fence: {
      backgroundColor: "rgba(255,255,255,0.06)",
      borderRadius: 8,
      color: "rgba(255,255,255,0.9)",
      fontFamily: mono,
      fontSize: 13,
      marginVertical: 10,
      padding: 12,
    },
    hr: {
      backgroundColor: "rgba(255,255,255,0.1)",
      height: StyleSheet.hairlineWidth,
      marginVertical: 24,
    },
    strong: {
      fontWeight: "700",
      color: "rgba(255,255,255,0.95)",
    },
    em: {
      fontStyle: "italic",
    },
    link: {
      color: textColor,
      textDecorationLine: "underline",
    },
  });
}

const layout = StyleSheet.create({
  article: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.six,
  },
});
