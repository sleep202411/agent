import { memo, useMemo } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import Markdown, { MarkdownIt, type RenderRules } from "react-native-markdown-display";

import { Fonts } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** Light normalize for model quirks (mirrors PC Story Studio). */
export function prepareAgentOsMarkdown(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&lt;br\s*\/?&gt;/gi, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trimEnd();
}

function isSafeLink(href: string): boolean {
  return (
    (href.startsWith("/") && !href.startsWith("//")) ||
    href.startsWith("#") ||
    /^https?:\/\//i.test(href)
  );
}

const markdownIt = MarkdownIt({ typographer: false, linkify: true, html: false });

const RULES: RenderRules = {
  image: () => null,
  // Avoid inheriting View layout props (e.g. heading flexDirection) onto Text.
  text: (node, _children, _parent, styles) => (
    <Text key={node.key} style={styles.text}>
      {node.content}
    </Text>
  ),
};

type ThemeShape = ReturnType<typeof useTheme>;

function createMarkdownStyles(theme: ThemeShape) {
  const mono = Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: Fonts.mono,
  });

  return StyleSheet.create({
    body: {
      color: theme.text,
      fontSize: 15,
      lineHeight: 22,
    },
    text: {
      color: theme.text,
      fontSize: 15,
      lineHeight: 22,
    },
    heading1: {
      color: theme.text,
      flexDirection: "column",
      fontSize: 16,
      fontWeight: "600",
      marginTop: 20,
      marginBottom: 8,
    },
    heading2: {
      color: theme.text,
      flexDirection: "column",
      fontSize: 15,
      fontWeight: "600",
      marginTop: 20,
      marginBottom: 8,
    },
    heading3: {
      color: theme.text,
      flexDirection: "column",
      fontSize: 14,
      fontWeight: "600",
      marginTop: 16,
      marginBottom: 6,
    },
    heading4: {
      color: theme.text,
      flexDirection: "column",
      fontSize: 14,
      fontWeight: "500",
      marginTop: 12,
      marginBottom: 6,
    },
    heading5: {
      color: theme.text,
      flexDirection: "column",
      fontSize: 13,
      fontWeight: "500",
      marginTop: 10,
      marginBottom: 4,
    },
    heading6: {
      color: theme.text,
      flexDirection: "column",
      fontSize: 12,
      fontWeight: "500",
      marginTop: 8,
      marginBottom: 4,
    },
    hr: {
      backgroundColor: theme.border,
      height: StyleSheet.hairlineWidth,
      marginVertical: 16,
    },
    strong: {
      fontWeight: "700",
      color: theme.text,
    },
    em: {
      fontStyle: "italic",
    },
    s: {
      textDecorationLine: "line-through",
    },
    blockquote: {
      backgroundColor: "rgba(255,255,255,0.045)",
      borderLeftWidth: 0,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginVertical: 12,
    },
    bullet_list: { marginVertical: 8 },
    ordered_list: { marginVertical: 8 },
    list_item: { marginVertical: 2 },
    code_inline: {
      backgroundColor: "rgba(255,255,255,0.07)",
      borderWidth: 0,
      borderRadius: 6,
      color: theme.text,
      fontFamily: mono,
      fontSize: 13,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    code_block: {
      backgroundColor: "rgba(0,0,0,0.3)",
      borderWidth: 0,
      borderRadius: 12,
      color: theme.text,
      fontFamily: mono,
      fontSize: 12,
      lineHeight: 20,
      marginVertical: 12,
      padding: 12,
    },
    fence: {
      backgroundColor: "rgba(0,0,0,0.3)",
      borderWidth: 0,
      borderRadius: 12,
      color: theme.text,
      fontFamily: mono,
      fontSize: 12,
      lineHeight: 20,
      marginVertical: 12,
      padding: 12,
    },
    table: {
      borderColor: theme.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      marginVertical: 12,
      overflow: "hidden",
    },
    thead: { backgroundColor: "rgba(255,255,255,0.055)" },
    th: { color: theme.text, fontWeight: "600", padding: 10 },
    tr: { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
    td: { color: theme.textSecondary, padding: 10 },
    link: { color: theme.text, textDecorationLine: "underline" },
    paragraph: { marginTop: 0, marginBottom: 8 },
  });
}

/** Assistant body — GFM-ish Markdown (PC uses the same contract). */
export const AgentOsMarkdown = memo(function AgentOsMarkdown({ children }: { children: string }) {
  const theme = useTheme();
  const styles = useMemo(() => createMarkdownStyles(theme), [theme]);

  return (
    <View style={rootStyles.root}>
      <Markdown
        markdownit={markdownIt}
        mergeStyle
        onLinkPress={(url) => {
          if (!isSafeLink(url)) return false;
          void Linking.openURL(url);
          return false;
        }}
        rules={RULES}
        style={styles}
      >
        {prepareAgentOsMarkdown(children)}
      </Markdown>
    </View>
  );
});

const rootStyles = StyleSheet.create({
  root: {
    alignSelf: "stretch",
    maxWidth: "100%",
    minWidth: 0,
  },
});
