import { useEffect, useState } from "react";
import {
  Animated,
  type DimensionValue,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useTheme } from "@/hooks/use-theme";

export function Skeleton({
  width = "100%",
  height,
  radius = 6,
  style,
}: {
  width?: DimensionValue;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [opacity] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 720, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 720, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.base,
        { width, height, borderRadius: radius, backgroundColor: theme.backgroundSelected, opacity },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: "hidden",
  },
});
