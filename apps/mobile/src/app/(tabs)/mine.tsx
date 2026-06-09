import { Image } from "expo-image";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "@/auth";
import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ScreenHeader, SectionHeader } from "@/components/ui";
import { appEnv, resolveAssetUrl, type AppLocale } from "@/config";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { SUPPORTED_LOCALES, setLocale, useLocale, useTranslations } from "@/i18n";

type AppSymbol = SymbolViewProps["name"];

/** Language names are endonyms — always shown in their own script. */
const LOCALE_NAMES: Record<AppLocale, string> = {
  "en-US": "English",
  "zh-CN": "简体中文",
  "zh-HK": "繁體中文",
};

const INFO_ITEMS: {
  key: string;
  labelKey: "mine.portfolioLabel" | "mine.projectsLabel" | "mine.roleLabel" | "mine.settingsLabel";
  detailKey:
    | "mine.portfolioDetail"
    | "mine.projectsDetail"
    | "mine.roleDetail"
    | "mine.settingsDetail";
  symbol: AppSymbol;
}[] = [
  {
    key: "portfolio",
    labelKey: "mine.portfolioLabel",
    detailKey: "mine.portfolioDetail",
    symbol: { ios: "person.crop.rectangle", android: "badge", web: "badge" },
  },
  {
    key: "projects",
    labelKey: "mine.projectsLabel",
    detailKey: "mine.projectsDetail",
    symbol: { ios: "folder", android: "folder", web: "folder" },
  },
  {
    key: "role",
    labelKey: "mine.roleLabel",
    detailKey: "mine.roleDetail",
    symbol: { ios: "checkmark.seal", android: "verified", web: "verified" },
  },
  {
    key: "settings",
    labelKey: "mine.settingsLabel",
    detailKey: "mine.settingsDetail",
    symbol: { ios: "gearshape", android: "settings", web: "settings" },
  },
];

function getDisplayName(user: ReturnType<typeof useAuth>["user"]) {
  return (
    user?.nickName ?? user?.nickname ?? user?.userName ?? user?.name ?? user?.email ?? user?.phone
  );
}

function getAccountMeta(user: ReturnType<typeof useAuth>["user"]) {
  return user?.email ?? user?.phone ?? user?.userName;
}

export default function MineScreen() {
  const auth = useAuth();
  const theme = useTheme();
  const t = useTranslations();
  const locale = useLocale();
  const [languageOpen, setLanguageOpen] = useState(false);

  const displayName = getDisplayName(auth.user) ?? t("mine.creatorFallback");
  const accountMeta = getAccountMeta(auth.user) ?? t("mine.accountFallback");
  const initial = displayName.trim().slice(0, 1).toUpperCase();

  const rawAvatar = auth.user?.avatar ?? auth.user?.headImg ?? auth.user?.headImgUrl;
  const avatarUrl =
    typeof rawAvatar === "string" && rawAvatar
      ? resolveAssetUrl(rawAvatar, appEnv.assets.userBaseUrl)
      : undefined;

  return (
    <TabScreen gap={Spacing.five}>
      <ScreenHeader title={t("mine.title")} />

      <ThemedView type="backgroundElement" style={styles.profilePanel}>
        <View style={[styles.avatar, { backgroundColor: theme.brand }]}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <ThemedText type="subtitle" style={styles.avatarInitial}>
              {initial}
            </ThemedText>
          )}
        </View>
        <View style={styles.profileCopy}>
          <ThemedText type="subtitle" style={styles.profileName} numberOfLines={1}>
            {displayName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {accountMeta}
          </ThemedText>
        </View>
      </ThemedView>

      <View style={styles.section}>
        <SectionHeader title={t("mine.accountSection")} trailing={t("mine.profileTrailing")} />
        <ThemedView type="backgroundElement" style={styles.menuPanel}>
          {/* Language switcher — the one actionable preference */}
          <Pressable
            accessibilityRole="button"
            onPress={() => setLanguageOpen(true)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View
              style={[styles.menuRow, { borderBottomColor: theme.border, borderBottomWidth: 1 }]}
            >
              <View style={styles.menuLeft}>
                <View style={[styles.menuIcon, { backgroundColor: theme.backgroundSelected }]}>
                  <SymbolView
                    name={{ ios: "globe", android: "language", web: "language" }}
                    size={18}
                    tintColor={theme.textSecondary}
                  />
                </View>
                <View style={styles.menuCopy}>
                  <ThemedText type="smallBold">{t("mine.languageLabel")}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {LOCALE_NAMES[locale]}
                  </ThemedText>
                </View>
              </View>
              <SymbolView
                name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
                size={16}
                tintColor={theme.textSecondary}
              />
            </View>
          </Pressable>

          {INFO_ITEMS.map((item, index) => (
            <View
              key={item.key}
              style={[
                styles.menuRow,
                index < INFO_ITEMS.length - 1 && {
                  borderBottomColor: theme.border,
                  borderBottomWidth: 1,
                },
              ]}
            >
              <View style={styles.menuLeft}>
                <View style={[styles.menuIcon, { backgroundColor: theme.backgroundSelected }]}>
                  <SymbolView name={item.symbol} size={18} tintColor={theme.textSecondary} />
                </View>
                <View style={styles.menuCopy}>
                  <ThemedText type="smallBold">{t(item.labelKey)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {t(item.detailKey)}
                  </ThemedText>
                </View>
              </View>
            </View>
          ))}
        </ThemedView>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => void auth.signOut()}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <ThemedView type="backgroundElement" style={styles.signOutButton}>
          <ThemedText type="smallBold" style={{ color: theme.brand }}>
            {t("mine.signOut")}
          </ThemedText>
        </ThemedView>
      </Pressable>

      <Modal
        visible={languageOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLanguageOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setLanguageOpen(false)}>
          <Pressable
            style={[styles.modalSheet, { backgroundColor: theme.backgroundElement }]}
            onPress={(e) => e.stopPropagation()}
          >
            <ThemedText type="smallBold" style={styles.modalTitle}>
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
                    setLanguageOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.modalRow,
                    index < SUPPORTED_LOCALES.length - 1 && {
                      borderBottomColor: theme.border,
                      borderBottomWidth: 1,
                    },
                    pressed && styles.pressed,
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
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </TabScreen>
  );
}

const AVATAR = 60;

const styles = StyleSheet.create({
  profilePanel: {
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 24,
    lineHeight: 28,
    color: "#FFFFFF",
  },
  profileCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  profileName: {
    fontSize: 22,
    lineHeight: 28,
  },
  section: {
    gap: Spacing.two,
  },
  menuPanel: {
    borderRadius: 8,
    overflow: "hidden",
  },
  menuRow: {
    minHeight: 70,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  menuLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  menuCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  signOutButton: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.72,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
  },
  modalTitle: {
    paddingVertical: Spacing.two,
  },
  modalRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
