import type { ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { MaxContentWidth } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export function MobileAppFrame({ children }: { children: ReactNode }) {
  const theme = useTheme();

  if (Platform.OS !== "web") {
    return <>{children}</>;
  }

  return (
    <View style={[styles.viewport, { backgroundColor: theme.background }]}>
      <View style={styles.app}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    width: "100%",
    alignItems: "center",
  },
  app: {
    flex: 1,
    width: "100%",
    maxWidth: MaxContentWidth,
  },
});
