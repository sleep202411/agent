import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

export function SectionHeader({
  title,
  trailing,
  onPressTrailing,
}: {
  title: string;
  trailing?: string;
  onPressTrailing?: () => void;
}) {
  const trailingNode = trailing ? (
    <ThemedText type="small" themeColor={onPressTrailing ? "text" : "textSecondary"}>
      {trailing}
    </ThemedText>
  ) : null;

  return (
    <View style={styles.row}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {trailing && onPressTrailing ? (
        <Pressable
          accessibilityRole="button"
          onPress={onPressTrailing}
          style={({ pressed }) => pressed && styles.pressed}
        >
          {trailingNode}
        </Pressable>
      ) : (
        trailingNode
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});
