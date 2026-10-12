import type { ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type TabScreenProps = {
  children: ReactNode;
  gap?: number;
};

/**
 * Safe-area + tab-bar insets for primary bottom-tab screens.
 * The native tab host does NOT inset content below the status bar (verified
 * on iOS) — apply these paddings on every tab, including FlatList screens.
 */
export function useTabScreenInsets(): {
  topInset: number;
  bottomInset: number;
  contentPadding: ViewStyle;
} {
  const insets = useSafeAreaInsets();
  const topInset = insets.top + (Platform.OS === "web" ? Spacing.four : Spacing.three);
  const bottomInset = insets.bottom + BottomTabInset + Spacing.four;
  return {
    topInset,
    bottomInset,
    contentPadding: {
      paddingTop: topInset,
      paddingBottom: bottomInset,
      paddingLeft: Math.max(insets.left, Spacing.four),
      paddingRight: Math.max(insets.right, Spacing.four),
    },
  };
}

/** Scrollable tab page shell. Prefer this; for FlatList use `useTabScreenInsets`. */
export function TabScreen({ children, gap = Spacing.four }: TabScreenProps) {
  const { contentPadding } = useTabScreenInsets();
  const theme = useTheme();

  return (
    <ScrollView
      // We apply the top safe-area inset manually via paddingTop; disable the
      // native auto content-inset so the status-bar inset isn't counted twice.
      contentInsetAdjustmentBehavior="never"
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, contentPadding]}
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
