import { Pressable, ScrollView, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

export function ChipRail({
  items,
  activeIndex,
  onChange,
}: {
  items: readonly string[];
  activeIndex: number;
  onChange: (index: number) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {items.map((item, index) => {
        const selected = index === activeIndex;

        return (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(index)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <ThemedView
              type={selected ? "backgroundSelected" : "backgroundElement"}
              style={styles.chip}
            >
              <ThemedText type="smallBold" themeColor={selected ? "text" : "textSecondary"}>
                {item}
              </ThemedText>
            </ThemedView>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Spacing.two,
    paddingRight: Spacing.four,
  },
  chip: {
    minHeight: 34,
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.72,
  },
});
