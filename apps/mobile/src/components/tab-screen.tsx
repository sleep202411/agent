import type { ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type TabScreenProps = {
  children: ReactNode;
  gap?: number;
};

export function TabScreen({ children, gap = Spacing.four }: TabScreenProps) {
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();
  // Native tab navigators already inset content below the status bar; adding the
  // safe-area inset again double-counts it. Only web (custom tab bar, no native
  // inset) needs the manual top inset.
  const topInset = Platform.OS === "web" ? safeAreaInsets.top + Spacing.four : Spacing.three;
  const bottomInset = safeAreaInsets.bottom + BottomTabInset + Spacing.four;

  return (
    <ScrollView
      // We apply the top safe-area inset manually via paddingTop; disable the
      // native auto content-inset so the status-bar inset isn't counted twice.
      contentInsetAdjustmentBehavior="never"
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
      <View style={[styles.page, { gap }]}>{children}</View>
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
  },
});
