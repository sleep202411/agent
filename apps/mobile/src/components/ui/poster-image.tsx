import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { hashString } from "@/lib/hash";

/** Subtle dark tints used for designed fallbacks when no cover art exists. */
const TINTS = ["#1C1622", "#141B22", "#1E1620", "#15191F", "#201619", "#161E1C"] as const;

export type PosterImageProps = {
  uri?: string;
  /** Used for the fallback initial + deterministic tint. */
  label?: string;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

export function PosterImage({ uri, label, radius = 8, style }: PosterImageProps) {
  const theme = useTheme();
  const seed = label ?? uri ?? "fizzdragon";
  const tint = TINTS[hashString(seed) % TINTS.length];
  const initial = label?.trim().slice(0, 1).toUpperCase();

  return (
    <View
      style={[
        styles.base,
        { borderRadius: radius, backgroundColor: theme.backgroundSelected },
        style,
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={220}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback, { backgroundColor: tint }]}>
          <View style={[styles.brandCorner, { backgroundColor: theme.brand }]} />
          {initial ? (
            <ThemedText type="title" style={styles.initial}>
              {initial}
            </ThemedText>
          ) : null}
          <SymbolView
            name={{ ios: "film.stack", android: "movie", web: "movie" }}
            size={20}
            tintColor={theme.textSecondary}
            style={styles.glyph}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: "hidden",
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  brandCorner: {
    position: "absolute",
    top: -36,
    right: -36,
    width: 96,
    height: 96,
    borderRadius: 48,
    opacity: 0.16,
  },
  initial: {
    fontSize: 34,
    lineHeight: 38,
    opacity: 0.5,
  },
  glyph: {
    position: "absolute",
    bottom: 8,
    left: 8,
    opacity: 0.85,
  },
});
