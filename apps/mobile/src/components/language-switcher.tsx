import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { type AppLocale } from "@/config";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { SUPPORTED_LOCALES, setLocale, useLocale, useTranslations } from "@/i18n";

/** Language names are endonyms — always shown in their own script. */
export const LOCALE_NAMES: Record<AppLocale, string> = {
  "en-US": "English",
  "zh-CN": "简体中文",
  "zh-HK": "繁體中文",
};

const LOCALE_SHORT: Record<AppLocale, string> = {
  "en-US": "EN",
  "zh-CN": "中文",
  "zh-HK": "繁體",
};

/** Bottom-sheet language picker, shared across mine / login / register. */
export function LanguageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.backgroundElement }]}
          onPress={(e) => e.stopPropagation()}
        >
          <ThemedText type="smallBold" style={styles.sheetTitle}>
            {t("mine.languageSheetTitle")}
          </ThemedText>
          {SUPPORTED_LOCALES.map((option, index) => {
            const selected = option === locale;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                onPress={() => {
                  setLocale(option);
                  onClose();
                }}
                style={({ pressed }) => (pressed ? styles.pressed : null)}
              >
                <View
                  style={[
                    styles.row,
                    index < SUPPORTED_LOCALES.length - 1 && {
                      borderBottomColor: theme.border,
                      borderBottomWidth: 1,
                    },
                  ]}
                >
                  <ThemedText type={selected ? "smallBold" : "small"}>
                    {LOCALE_NAMES[option]}
                  </ThemedText>
                  {selected ? (
                    <SymbolView
                      name={{ ios: "checkmark", android: "check", web: "check" }}
                      size={16}
                      tintColor={theme.brand}
                    />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Compact globe + locale-code trigger (e.g. for the auth screens' corner). */
export function LanguageSwitcher({ style }: { style?: StyleProp<ViewStyle> }) {
  const locale = useLocale();
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={style}>
        <View
          style={[
            styles.trigger,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        >
          <SymbolView
            name={{ ios: "globe", android: "language", web: "language" }}
            size={15}
            tintColor={theme.textSecondary}
          />
          <ThemedText type="small">{LOCALE_SHORT[locale]}</ThemedText>
        </View>
      </Pressable>
      <LanguageSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.55)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: Spacing.six,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  sheetTitle: {
    paddingVertical: Spacing.two,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
  },
  pressed: {
    opacity: 0.72,
  },
});
