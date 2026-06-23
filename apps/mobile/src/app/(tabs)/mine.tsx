import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/auth";
import { LanguageSheet, LOCALE_NAMES } from "@/components/language-switcher";
import { ThemedText } from "@/components/themed-text";
import { appEnv, resolveAssetUrl } from "@/config";
import { Spacing } from "@/constants/theme";
import { fetchMyCrews } from "@/data/crew-api";
import { fetchMyIps, type MyIp } from "@/data/ip-api";
import { fetchMyWorks, type MyWork } from "@/data/mine-api";
import type { CrewSummary } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";

type TabKey = "works" | "ips" | "crews";

const TABS: { key: TabKey; labelKey: "mine.tabWorks" | "mine.tabIps" | "mine.tabCrews" }[] = [
  { key: "works", labelKey: "mine.tabWorks" },
  { key: "ips", labelKey: "mine.tabIps" },
  { key: "crews", labelKey: "mine.tabCrews" },
];

interface Tile {
  id: string;
  title: string;
  coverUrl?: string;
  subtitle?: string;
  badge?: string;
  href?: string;
  /** Tap feedback for tiles with no destination (e.g. unpublished IPs). */
  alert?: { title: string; message: string };
  /** Invisible spacer that pads a partial last row to keep the grid aligned. */
  ghost?: boolean;
}

const COLUMNS = 3;

export default function MineScreen() {
  const auth = useAuth();
  const theme = useTheme();
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<TabKey>("works");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [works, setWorks] = useState<MyWork[]>();
  const [ips, setIps] = useState<MyIp[]>();
  const [crews, setCrews] = useState<CrewSummary[]>();

  useEffect(() => {
    let active = true;
    void fetchMyWorks().then((rows) => active && setWorks(rows));
    void fetchMyIps().then((rows) => active && setIps(rows));
    void fetchMyCrews().then((rows) => active && setCrews(rows));
    return () => {
      active = false;
    };
  }, []);

  const displayName =
    auth.user?.nickName ??
    auth.user?.nickname ??
    auth.user?.userName ??
    auth.user?.name ??
    auth.user?.email ??
    auth.user?.phone ??
    t("mine.creatorFallback");
  // Phone first, then email; no generic fallback — hide the line when absent.
  const accountMeta = auth.user?.phone || auth.user?.email || undefined;
  const initial = displayName.trim().slice(0, 1).toUpperCase();
  const rawAvatar = auth.user?.avatar ?? auth.user?.headImg ?? auth.user?.headImgUrl;
  const avatarUrl =
    typeof rawAvatar === "string" && rawAvatar
      ? resolveAssetUrl(rawAvatar, appEnv.assets.userBaseUrl)
      : undefined;

  const tiles = useMemo<Tile[] | undefined>(() => {
    if (tab === "works") {
      return works?.map((work) => ({
        id: work.id,
        title: work.title,
        coverUrl: work.coverUrl,
        badge:
          work.reviewStatus === 0
            ? t("mine.reviewPending")
            : work.reviewStatus === 3
              ? t("mine.reviewRejected")
              : work.isPrivate
                ? t("mine.private")
                : undefined,
      }));
    }
    if (tab === "ips") {
      // Only published IPs open the public plaza detail; everything else is
      // not publicly resolvable yet, so explain instead of 404-ing.
      return ips?.map((ip) => ({
        id: ip.id,
        title: ip.title,
        coverUrl: ip.coverUrl,
        ...(ip.published
          ? { href: `/ip/${ip.id}` }
          : {
              badge: t("mine.reviewPending"),
              alert: { title: t("mine.ipPendingTitle"), message: t("mine.ipPendingBody") },
            }),
      }));
    }
    return crews?.map((crew) => ({
      id: crew.id,
      title: crew.name,
      coverUrl: crew.coverUrl,
      subtitle: crew.openRoles > 0 ? `${crew.openRoles} ${t("mine.rolesOpen")}` : undefined,
      href: `/crew/${crew.id}`,
    }));
  }, [tab, works, ips, crews, t]);

  // Pad the last row with invisible spacers so 3-col rows stay left-aligned
  // (otherwise space-between/flex spreads a partial row).
  const gridData = useMemo<Tile[]>(() => {
    if (!tiles) return [];
    const remainder = tiles.length % COLUMNS;
    if (remainder === 0) return tiles;
    const ghosts: Tile[] = Array.from({ length: COLUMNS - remainder }, (_, i) => ({
      id: `__ghost_${i}`,
      title: "",
      ghost: true,
    }));
    return [...tiles, ...ghosts];
  }, [tiles]);

  const loading = tiles === undefined;
  const emptyText =
    tab === "works"
      ? t("mine.worksEmpty")
      : tab === "ips"
        ? t("mine.ipsEmpty")
        : t("mine.crewsEmpty");

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <FlatList
        data={gridData}
        key={`grid-${COLUMNS}`}
        keyExtractor={(item) => item.id}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.column}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            {/* Profile header — avatar as a blurred banner */}
            <View style={styles.header}>
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  blurRadius={40}
                />
              ) : (
                <View
                  style={[StyleSheet.absoluteFill, { backgroundColor: theme.backgroundElement }]}
                />
              )}
              <View style={[StyleSheet.absoluteFill, styles.headerScrim]} />

              <View style={[styles.headerTop, { paddingTop: insets.top + Spacing.two }]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setLanguageOpen(true)}
                  style={({ pressed }) => (pressed ? styles.pressed : null)}
                >
                  <View style={styles.iconPill}>
                    <SymbolView
                      name={{ ios: "globe", android: "language", web: "language" }}
                      size={15}
                      tintColor="#FFFFFF"
                    />
                    <ThemedText type="small" style={styles.iconPillText}>
                      {LOCALE_NAMES[locale]}
                    </ThemedText>
                  </View>
                </Pressable>
                <View style={styles.headerActions}>
                  <Pressable
                    accessibilityLabel={t("settings.title")}
                    accessibilityRole="button"
                    hitSlop={10}
                    onPress={() => router.push("/settings")}
                    style={({ pressed }) => (pressed ? styles.pressed : null)}
                  >
                    <View style={styles.iconButton}>
                      <SymbolView
                        name={{ ios: "gearshape", android: "settings", web: "settings" }}
                        size={18}
                        tintColor="#FFFFFF"
                      />
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={t("mine.signOut")}
                    accessibilityRole="button"
                    hitSlop={10}
                    onPress={() => void auth.signOut()}
                    style={({ pressed }) => (pressed ? styles.pressed : null)}
                  >
                    <View style={styles.iconButton}>
                      <SymbolView
                        name={{
                          ios: "rectangle.portrait.and.arrow.right",
                          android: "logout",
                          web: "logout",
                        }}
                        size={18}
                        tintColor="#FFFFFF"
                      />
                    </View>
                  </Pressable>
                </View>
              </View>

              <View style={styles.profileRow}>
                <View style={[styles.avatar, { backgroundColor: theme.brand }]}>
                  {avatarUrl ? (
                    <Image
                      source={{ uri: avatarUrl }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                    />
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
                  {accountMeta ? (
                    <ThemedText type="small" style={styles.profileMeta} numberOfLines={1}>
                      {accountMeta}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
            </View>

            {/* Tab bar */}
            <View style={[styles.tabBar, { borderBottomColor: theme.border }]}>
              {TABS.map((item) => {
                const active = item.key === tab;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    onPress={() => setTab(item.key)}
                    style={({ pressed }) => (pressed ? styles.pressed : null)}
                  >
                    <View style={styles.tabItem}>
                      <ThemedText
                        type={active ? "smallBold" : "small"}
                        themeColor={active ? "text" : "textSecondary"}
                      >
                        {t(item.labelKey)}
                      </ThemedText>
                      <View
                        style={[
                          styles.tabUnderline,
                          { backgroundColor: active ? theme.brand : "transparent" },
                        ]}
                      />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            {loading ? "" : emptyText}
          </ThemedText>
        }
        renderItem={({ item }) => {
          if (item.ghost) return <View style={styles.cell} />;
          const tileAlert = item.alert;
          const onPress = item.href
            ? () => router.push(item.href as never)
            : tileAlert
              ? () => Alert.alert(tileAlert.title, tileAlert.message)
              : undefined;
          return (
            <Pressable
              accessibilityRole={onPress ? "button" : undefined}
              disabled={!onPress}
              onPress={onPress}
              style={styles.cell}
            >
              <View style={styles.tile}>
                <View style={[styles.tileCover, { backgroundColor: theme.backgroundElement }]}>
                  {item.coverUrl ? (
                    <Image
                      source={{ uri: item.coverUrl }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={styles.tileNoCover}>
                      <ThemedText type="small" themeColor="textSecondary">
                        {t("mine.noCover")}
                      </ThemedText>
                    </View>
                  )}
                  {item.badge ? (
                    <View style={styles.tileBadge}>
                      <ThemedText type="small" style={styles.tileBadgeText}>
                        {item.badge}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.tileTitle}>
                  {item.title}
                </ThemedText>
                {item.subtitle ? (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {item.subtitle}
                  </ThemedText>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
      <LanguageSheet visible={languageOpen} onClose={() => setLanguageOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    overflow: "hidden",
    paddingBottom: Spacing.four,
  },
  headerScrim: {
    backgroundColor: "rgba(9,9,11,0.55)",
  },
  headerTop: {
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "flex-end",
    paddingHorizontal: Spacing.four,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  iconPill: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.32)",
    borderRadius: 999,
    flexDirection: "row",
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  iconPillText: {
    color: "#FFFFFF",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.32)",
    borderRadius: 999,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  profileRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.six,
  },
  avatar: {
    alignItems: "center",
    borderRadius: 14,
    height: 64,
    justifyContent: "center",
    overflow: "hidden",
    width: 64,
  },
  avatarInitial: {
    color: "#FFFFFF",
    fontSize: 26,
  },
  profileCopy: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  profileName: {
    color: "#FFFFFF",
    fontSize: 22,
    lineHeight: 28,
  },
  profileMeta: {
    color: "rgba(255,255,255,0.7)",
  },
  tabBar: {
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: Spacing.five,
    paddingHorizontal: Spacing.four,
  },
  tabItem: {
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  tabUnderline: {
    borderRadius: 999,
    height: 2,
    width: 24,
  },
  column: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  cell: {
    flex: 1,
  },
  tile: {
    gap: Spacing.one + 2,
    marginTop: Spacing.four,
    width: "100%",
  },
  tileCover: {
    aspectRatio: 3 / 4,
    borderRadius: 10,
    overflow: "hidden",
    width: "100%",
  },
  tileNoCover: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: Spacing.two,
  },
  tileBadge: {
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: "absolute",
    top: 6,
  },
  tileBadgeText: {
    color: "#FFFFFF",
  },
  tileTitle: {
    paddingHorizontal: 2,
  },
  empty: {
    paddingTop: Spacing.eight,
    textAlign: "center",
    width: "100%",
  },
  pressed: {
    opacity: 0.72,
  },
});
