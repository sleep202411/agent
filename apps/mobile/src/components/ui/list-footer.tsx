import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Subtle footer spinner for infinite-scroll lists. Renders nothing unless
 * `loading` is true, so it can be passed straight to a FlatList's
 * `ListFooterComponent` without reserving space at the end of a finished list.
 */
export function ListFooter({ loading }: { loading: boolean }) {
  const theme = useTheme();
  if (!loading) return null;
  return (
    <View style={styles.footer}>
      <ActivityIndicator color={theme.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.five,
  },
});
