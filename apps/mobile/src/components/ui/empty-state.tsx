import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type AppSymbol = SymbolViewProps["name"];

export function EmptyState({
  title,
  detail,
  symbol,
}: {
  title: string;
  detail: string;
  symbol?: AppSymbol;
}) {
  const theme = useTheme();

  return (
    <ThemedView type="backgroundElement" style={styles.panel}>
      {symbol ? (
        <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]}>
          <SymbolView name={symbol} size={20} tintColor={theme.textSecondary} />
        </View>
      ) : null}
      <View style={styles.copy}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
});
