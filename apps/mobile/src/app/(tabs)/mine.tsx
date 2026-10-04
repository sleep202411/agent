import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { openAuthSheet, useAuth } from "@/auth";
import { LanguageSheet, LOCALE_NAMES } from "@/components/language-switcher";
import { ThemedText } from "@/components/themed-text";
import { appEnv, resolveAssetUrl } from "@/config";
import { Spacing } from "@/constants/theme";
import { useMyCrews } from "@/features/profile/use-my-crews";
import { useMyIps } from "@/features/profile/use-my-ips";
import { useMyWorks } from "@/features/profile/use-my-works";
import { ListFooter } from "@/components/ui";
import { openPaywall } from "@/features/paywall";
import { usePersonalBalances } from "@/features/profile/use-personal-balances";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

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
  editHref?: string;
  /** Tap feedback for tiles with no destination (e.g. unpublished IPs). */
  alert?: { title: string; message: string };
  /** Invisible spacer that pads a partial last row to keep the grid aligned. */
  ghost?: boolean;
}

const COLUMNS = 3;

/** Whole community points (BigInt string) → locale-grouped display. */
function formatPoints(value: string, locale: string): string {
  try {
    return BigInt(value).toLocaleString(locale);
  } catch {
    return value;
  }
}

export default function MineScreen() {
  const auth = useAuth();
  // Signed-out viewers get the login screen the moment this tab is focused.
  // Open it as a REPLACE (not push) so dismissing returns to Home instead of a
  // stuck empty Mine — and a re-tap re-opens it cleanly each time.
  useFocusEffect(
    useCallback(() => {
      if (auth.status === "anonymous") {
        openAuthSheet({ mode: "login", replace: true });
      }
    }, [auth.status])
  );
  const theme = useTheme();
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const isAuthed = auth.status === "authenticated";
  const authOwnerKey = isAuthed
    ? JSON.stringify([
        auth.generation,
        auth.user?.userId ??
          auth.user?.id ??
          auth.user?.email ??
          auth.user?.phone ??
          auth.session?.updatedAt ??
          "authenticated",
      ])
    : undefined;

  const [tab, setTab] = useState<TabKey>("works");
  const [languageOpen, setLanguageOpen] = useState(false);
  const ownerWorks = useMyWorks(authOwnerKey);
  const ownerIps = useMyIps(authOwnerKey);
  const ownerCrews = useMyCrews(authOwnerKey);
  const balances = usePersonalBalances(authOwnerKey);
  const pointsBalance = balances?.community;
  const computeBalance = balances?.compute;
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

  const currentWorks = ownerWorks.works;
  const currentIps = ownerIps.items;
  const currentCrews = ownerCrews.items;

  const tiles = useMemo<Tile[] | undefined>(() => {
    if (tab === "works") {
      return currentWorks?.map((work) => ({
        id: work.id,
        title: work.title,
        href: `/work/${encodeURIComponent(work.id)}`,
        editHref: `/publish-work?workId=${encodeURIComponent(work.id)}`,
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
      // Published IPs retain playback; drafts open their authenticated editor.
      return currentIps?.map((ip) => ({
        id: ip.id,
        title: ip.title,
        coverUrl: ip.coverUrl,
        editHref: `/ip-studio/${ip.id}`,
        href: ip.published ? `/ip/${ip.id}` : `/ip-studio/${ip.id}`,
      }));
    }
    return currentCrews?.map((crew) => ({
      id: crew.id,
      title: crew.name,
      coverUrl: crew.coverUrl,
      subtitle: crew.openRoles > 0 ? `${crew.openRoles} ${t("mine.rolesOpen")}` : undefined,
      href: `/crew/${crew.id}`,
    }));
  }, [tab, currentWorks, currentIps, currentCrews, t]);

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

  if (!isAuthed) {
    // Signed out → jump straight to login (useLoginGateOnFocus opens it on
    // focus); no full-screen prompt. This spinner only covers the brief moment
    // before / behind the login screen.
    return (
      <View style={[styles.root, styles.guestRoot, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }

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
        onEndReached={
          tab === "works" ? ownerWorks.loadMore : tab === "ips" ? ownerIps.loadMore : undefined
        }
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          tab === "works" ? (
            ownerWorks.failed ? (
              <View style={styles.collectionFooter}>
                <ThemedText accessibilityRole="alert" style={{ textAlign: "center" }}>
                  {ownerWorks.error ?? t("creatorDetail.personalWorksError")}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={ownerWorks.retry}
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <ThemedText>{t("profileEdit.retry")}</ThemedText>
                </Pressable>
              </View>
            ) : (
              <ListFooter loading={ownerWorks.loading} />
            )
          ) : tab === "ips" ? (
            <View style={styles.empty}>
              {ownerIps.error ? (
                <>
                  <ThemedText accessibilityRole="alert">{ownerIps.error}</ThemedText>
                  <Pressable accessibilityRole="button" onPress={ownerIps.retry}>
                    <ThemedText>{t("common.retry")}</ThemedText>
                  </Pressable>
                </>
              ) : ownerIps.loading ? (
                <ListFooter loading />
              ) : (
                <Pressable accessibilityRole="button" onPress={ownerIps.refresh}>
                  <ThemedText>{t("thread.refresh")}</ThemedText>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={styles.collectionFooter}>
              {ownerCrews.error ? (
                <ThemedText accessibilityRole="alert" style={{ textAlign: "center" }}>
                  {ownerCrews.error}
                </ThemedText>
              ) : null}
              {ownerCrews.loading ? (
                <ListFooter loading />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={ownerCrews.refresh}
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <ThemedText>{t(ownerCrews.error ? "common.retry" : "thread.refresh")}</ThemedText>
                </Pressable>
              )}
            </View>
          )
        }
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("profileEdit.title")}
                  onPress={() => router.push(toHref("/profile-edit"))}
                  style={[styles.avatar, { backgroundColor: theme.brand }]}
                >
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
                </Pressable>
                <View style={styles.profileCopy}>
                  <ThemedText type="subtitle" style={styles.profileName} numberOfLines={1}>
                    {displayName}
                  </ThemedText>
                  {accountMeta ? (
                    <ThemedText type="small" style={styles.profileMeta} numberOfLines={1}>
                      {accountMeta}
                    </ThemedText>
                  ) : null}
                  <View style={styles.walletRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("mine.rechargeCommunity")}
                      onPress={() => openPaywall({ category: "community_points" })}
                      style={({ pressed }) => (pressed ? styles.pressed : null)}
                    >
                      <View style={[styles.pointsPill, { backgroundColor: `${theme.brand}22` }]}>
                        <SymbolView
                          name={{ ios: "circlebadge.2.fill", android: "toll", web: "toll" }}
                          size={12}
                          tintColor={theme.brand}
                        />
                        <ThemedText type="code" style={{ color: theme.brand }}>
                          {`${t("mine.pointsLabel")} ${
                            pointsBalance == null ? "—" : formatPoints(pointsBalance, locale)
                          }`}
                        </ThemedText>
                      </View>
                    </Pressable>
                    {/* Compute recharge stays closed for this release (community points only). */}
                    <View style={[styles.pointsPill, { backgroundColor: `${theme.brand}22` }]}>
                      <SymbolView
                        name={{ ios: "bolt.fill", android: "bolt", web: "bolt" }}
                        size={12}
                        tintColor={theme.brand}
                      />
                      <ThemedText type="code" style={{ color: theme.brand }}>
                        {`${t("mine.computePointsLabel")} ${
                          computeBalance == null ? "—" : formatPoints(computeBalance, locale)
                        }`}
                      </ThemedText>
                    </View>
                  </View>
                </View>
              </View>
            </View>

            {!!balances?.errors.length && (
              <View style={{ gap: 4, paddingHorizontal: 16 }}>
                {balances.errors.map((message, index) => (
                  <ThemedText key={index} type="small" accessibilityRole="alert">
                    {message}
                  </ThemedText>
                ))}
                <Pressable
                  accessibilityRole="button"
                  onPress={balances.refresh}
                  style={{ paddingVertical: 8 }}
                >
                  <ThemedText type="small">{t("common.retry")}</ThemedText>
                </Pressable>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/referrals")}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <View style={[styles.referralEntry, { backgroundColor: theme.backgroundElement }]}>
                <View style={[styles.referralIcon, { backgroundColor: `${theme.brand}22` }]}>
                  <SymbolView
                    name={{ ios: "gift", android: "redeem", web: "redeem" }}
                    size={20}
                    tintColor={theme.brand}
                  />
                </View>
                <View style={styles.referralCopy}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {t("referrals.title")}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {t("referrals.mineEntryBody")}
                  </ThemedText>
                </View>
                <SymbolView
                  name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
                  size={15}
                  tintColor={theme.textSecondary}
                />
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              style={{ padding: 16 }}
              onPress={() => router.push(toHref("/ai-lab"))}
            >
              <ThemedText type="smallBold">{t("aiLab.heading")}</ThemedText>
            </Pressable>
            {tab === "ips" && (
              <Pressable
                accessibilityRole="button"
                style={{ padding: 16 }}
                onPress={() => router.push(toHref("/ip-studio/create"))}
              >
                <ThemedText type="smallBold">{t("ipCreate.heading")}</ThemedText>
              </Pressable>
            )}
            {tab === "works" && (
              <Pressable
                accessibilityRole="button"
                style={{ padding: 16 }}
                onPress={() => router.push(toHref("/publish-work"))}
              >
                <ThemedText type="smallBold">{t("publishWork.title")}</ThemedText>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              style={{ paddingHorizontal: Spacing.four, paddingVertical: Spacing.two }}
              onPress={() => router.push(toHref("/orders"))}
            >
              <ThemedText type="smallBold">{t("orders.title")}</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={{ paddingHorizontal: Spacing.four, paddingVertical: Spacing.two }}
              onPress={() => router.push(toHref("/inbox"))}
            >
              <ThemedText type="smallBold">{t("inbox.title")}</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={{ paddingHorizontal: Spacing.four, paddingVertical: Spacing.two }}
              onPress={() => router.push(toHref("/my-services"))}
            >
              <ThemedText type="smallBold">{t("myServices.title")}</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={{ paddingHorizontal: Spacing.four, paddingVertical: Spacing.two }}
              onPress={() => router.push(toHref("/certification-application"))}
            >
              <ThemedText type="smallBold">{t("levelApplication.title")}</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={{ paddingHorizontal: Spacing.four, paddingVertical: Spacing.two }}
              onPress={() => router.push(toHref("/earnings"))}
            >
              <ThemedText type="smallBold">{t("creatorEarnings.title")}</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={{ paddingHorizontal: Spacing.four, paddingVertical: Spacing.two }}
              onPress={() => router.push(toHref("/task-center"))}
            >
              <ThemedText type="smallBold">{t("crewTaskCenter.title")}</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={{ paddingHorizontal: Spacing.four, paddingVertical: Spacing.two }}
              onPress={() => router.push(toHref("/my-agreements"))}
            >
              <ThemedText type="smallBold">{t("myContracts.title")}</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={{ paddingHorizontal: Spacing.four, paddingVertical: Spacing.two }}
              onPress={() => router.push(toHref("/content-reports"))}
            >
              <ThemedText type="smallBold">{t("contentReports.title")}</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={{ paddingHorizontal: Spacing.four, paddingVertical: Spacing.two }}
              onPress={() => router.push(toHref("/task-feedback"))}
            >
              <ThemedText type="smallBold">{t("feedbackHistory.title")}</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={{ paddingHorizontal: Spacing.four, paddingVertical: Spacing.two }}
              onPress={() => router.push(toHref("/text-adventures"))}
            >
              <ThemedText type="smallBold">{t("textAdventures.library.title")}</ThemedText>
            </Pressable>
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
          loading ||
          (tab === "works" && (ownerWorks.failed || ownerWorks.loading)) ||
          (tab === "ips" && (ownerIps.error || ownerIps.loading)) ||
          (tab === "crews" && (ownerCrews.error || ownerCrews.loading)) ? null : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {emptyText}
            </ThemedText>
          )
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
              onLongPress={item.editHref ? () => router.push(toHref(item.editHref!)) : undefined}
              accessibilityHint={
                item.editHref
                  ? t(tab === "ips" ? "ipAuthor.editHint" : "publishWork.editHint")
                  : undefined
              }
              accessibilityActions={
                item.editHref
                  ? [
                      {
                        name: "edit",
                        label: t(tab === "ips" ? "ipAuthor.heading" : "publishWork.edit"),
                      },
                    ]
                  : undefined
              }
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "edit" && item.editHref)
                  router.push(toHref(item.editHref));
              }}
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
  guestRoot: {
    alignItems: "center",
    justifyContent: "center",
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
  pointsPill: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: Spacing.half,
    height: 24,
    paddingHorizontal: Spacing.two,
  },
  walletRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: Spacing.half,
  },
  tabBar: {
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: Spacing.five,
    paddingHorizontal: Spacing.four,
  },
  referralEntry: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: Spacing.three,
    marginHorizontal: Spacing.four,
    marginTop: Spacing.four,
    padding: Spacing.three,
  },
  referralIcon: {
    alignItems: "center",
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  referralCopy: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
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
  collectionFooter: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    alignItems: "center",
    gap: Spacing.two,
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
