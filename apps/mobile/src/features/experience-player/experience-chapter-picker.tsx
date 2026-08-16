/**
 * Landscape chapter picker for serial works. In-tree overlay (not RN Modal) so
 * it covers the play stage; selecting a chapter only changes the route param —
 * the play shell stays mounted and orientation stays locked.
 */
import { SymbolView } from "expo-symbols";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ExperienceGameChapter } from "@repo/shared/experience-runtime";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

import { chapterDisplayTitle } from "./experience-session";

type ExperienceChapterPickerProps = {
  visible: boolean;
  chapters: readonly ExperienceGameChapter[];
  activeChapterId: string | null;
  locale: string;
  title: string;
  closeLabel: string;
  onSelect: (chapterId: string) => void;
  onClose: () => void;
};

export function ExperienceChapterPicker({
  visible,
  chapters,
  activeChapterId,
  locale,
  title,
  closeLabel,
  onSelect,
  onClose,
}: ExperienceChapterPickerProps) {
  const insets = useSafeAreaInsets();
  if (!visible || chapters.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        style={styles.backdrop}
        onPress={onClose}
      >
        <Pressable
          accessible={false}
          onAccessibilityEscape={onClose}
          style={[
            styles.sheet,
            {
              paddingLeft: Math.max(insets.left, Spacing.four),
              paddingRight: Math.max(insets.right, Spacing.four),
              paddingBottom: Math.max(insets.bottom, Spacing.four),
            },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.sheetHeader}>
            <ThemedText type="smallBold" style={styles.sheetTitle}>
              {title}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              onPress={onClose}
              hitSlop={12}
              style={styles.closeHit}
            >
              <SymbolView
                name={{ ios: "xmark", android: "close", web: "close" }}
                size={16}
                tintColor="rgba(255,255,255,0.7)"
              />
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {chapters.map((chapter) => {
              const active = chapter.chapterId === activeChapterId;
              const label = chapterDisplayTitle(chapter, locale);
              return (
                <Pressable
                  key={chapter.chapterId}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => onSelect(chapter.chapterId)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <ThemedText
                    type="smallBold"
                    style={[styles.chipLabel, active && styles.chipLabelActive]}
                    numberOfLines={1}
                  >
                    {label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </View>
  );
}

/** Floating control that opens the chapter picker — clears the native back affordance. */
export function ExperienceChapterButton({
  label,
  onPress,
  top,
  left,
}: {
  label: string;
  onPress: () => void;
  top: number;
  left: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chapterButton, { top, left }]}
    >
      <SymbolView
        name={{ ios: "list.bullet", android: "list", web: "list" }}
        size={14}
        tintColor="#FFFFFF"
      />
      <ThemedText type="code" style={styles.chapterButtonLabel} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "rgba(18,18,18,0.96)",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.one,
  },
  sheetTitle: {
    color: "#FFFFFF",
  },
  closeHit: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  chipRow: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  chip: {
    maxWidth: 220,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  chipActive: {
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  chipLabel: {
    color: "rgba(255,255,255,0.88)",
  },
  chipLabelActive: {
    color: "#0C0E14",
  },
  chapterButton: {
    position: "absolute",
    zIndex: 20,
    maxWidth: 200,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  chapterButtonLabel: {
    color: "#FFFFFF",
    flexShrink: 1,
  },
});
