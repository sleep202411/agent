import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { ThemedText } from "@/components/themed-text";
import themeTokens from "@/config/theme-tokens.json";
import { useTheme } from "@/hooks/use-theme";

export type TagTone = "neutral" | "brand" | "success" | "warning" | "info";

const SEMANTIC = themeTokens.colors.semantic;

export function Tag({
  label,
  labelStyle,
  numberOfLines = 1,
  style,
  tone = "neutral",
}: {
  label: string;
  labelStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
  tone?: TagTone;
}) {
  const theme = useTheme();

  const color =
    tone === "brand"
      ? theme.brand
      : tone === "success"
        ? SEMANTIC.success
        : tone === "warning"
          ? SEMANTIC.warning
          : tone === "info"
            ? SEMANTIC.info
            : theme.textSecondary;

  const backgroundColor = tone === "neutral" ? "rgba(255,255,255,0.08)" : `${color}24`;

  return (
    <View style={[styles.tag, { backgroundColor }, style]}>
      <ThemedText
        ellipsizeMode="tail"
        numberOfLines={numberOfLines}
        type="code"
        style={[styles.label, { color }, labelStyle]}
      >
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    height: 22,
    maxWidth: "100%",
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    maxWidth: "100%",
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
