import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type AppSymbol = SymbolViewProps["name"];

export type ScreenHeaderAction = {
  symbol: AppSymbol;
  onPress: () => void;
  accessibilityLabel: string;
  /** Defaults to primary text. */
  tintColor?: string;
  /** Defaults to the muted surface token. */
  buttonBackgroundColor?: string;
  /** `rounded` = 8px square (default); `circle` = pill/circle brand CTA. */
  buttonShape?: "rounded" | "circle";
  /** When true, show a spinner and ignore presses. */
  busy?: boolean;
};

export function ScreenHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ScreenHeaderAction;
}) {
  const theme = useTheme();
  const shape = action?.buttonShape ?? "rounded";
  const busy = Boolean(action?.busy);

  return (
    <View style={styles.header}>
      <View style={styles.copy}>
        {eyebrow ? (
          <ThemedText type="small" themeColor="textSecondary">
            {eyebrow}
          </ThemedText>
        ) : null}
        <ThemedText type="title" style={styles.title}>
          {title}
        </ThemedText>
      </View>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel}
          disabled={busy}
          onPress={action.onPress}
          style={({ pressed }) => pressed && !busy && styles.pressed}
        >
          <View
            style={[
              styles.iconButton,
              shape === "circle" && styles.iconButtonCircle,
              {
                backgroundColor: action.buttonBackgroundColor ?? theme.backgroundElement,
              },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={action.tintColor ?? theme.text} size="small" />
            ) : (
              <SymbolView
                name={action.symbol}
                size={shape === "circle" ? 20 : 18}
                tintColor={action.tintColor ?? theme.text}
              />
            )}
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  title: {
    fontSize: 28,
    lineHeight: 32,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonCircle: {
    borderRadius: 20,
  },
  pressed: {
    opacity: 0.72,
  },
});
