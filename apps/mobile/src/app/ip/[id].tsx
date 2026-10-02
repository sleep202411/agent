import { IpContributingStudios } from "@/features/studios/ip-contributing-studios";
import { resolvePlan, type UnlockPlan } from "@/features/content-gps/episode-access";
import { loadPlaybackDetail } from "@/features/content-gps/load-playback-detail";
import { resolvePlaybackEntry } from "@/features/content-gps/playback-entry";
import { BookmarkControl } from "@/features/ip-collection/bookmark-control";
import { IpTags } from "@/features/browse/ip-tags";
import { EpisodeFeedback } from "@/components/episode-feedback";
import { IpKnowledgeChat } from "@/components/ip-knowledge-chat";
import { IpGenerationPanel } from "@/components/ip-generation-panel";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEvent } from "expo";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";

import { useAuth, useAuthGate } from "@/auth";
import { ShareSheet } from "@/components/ip-share-sheet";
import {
  MoreActionsButton,
  ReportReasonSheet,
  showContentActionsMenu,
} from "@/components/report-actions";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, PosterImage, SectionHeader } from "@/components/ui";
import { webBaseUrl } from "@/config";
import { Spacing } from "@/constants/theme";
import { promptInsufficientPaywall } from "@/features/paywall";
import { useScreenActive } from "@/hooks/use-app-active";
import { invalidateBrowse } from "@/data/browse-refresh";
import {
  blockIpContent,
  isInsufficientBalanceError,
  isMemberOnlyError,
  likeIp,
  purchaseIpContent,
  recordIpView,
  reportIpContent,
  unlikeIp,
  type IpReportReason,
} from "@/data/browse-service";
import type { IpAccess, IpDetail, IpEngagementSnapshot, IpEpisode, Person } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";
import { dicebearAvatarUrl } from "@/lib/avatar";
import { toHref } from "@/lib/navigation";

/** Format whole community points for display (locale-grouped; amounts are BigInt strings). */
function formatPoints(value: string, locale: string): string {
  try {
    return BigInt(value).toLocaleString(locale);
  } catch {
    return value;
  }
}

/** True when `balance` is strictly below `price` (both whole-point BigInt strings). */
function balanceBelow(balance: string, price: string): boolean {
  try {
    return BigInt(balance) < BigInt(price);
  } catch {
    return false;
  }
}

function formatEngagementCount(value: number, locale: string): string {
  const normalized = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  try {
    return new Intl.NumberFormat(locale, {
      notation: normalized >= 10_000 ? "compact" : "standard",
      maximumFractionDigits: normalized >= 10_000 ? 1 : 0,
    }).format(normalized);
  } catch {
    return String(normalized);
  }
}

export default function IpDetailScreen() {
  const params = useLocalSearchParams<{
    id: string;
    watch?: string | string[];
    episode?: string | string[];
  }>();
  const auth = useAuth();
  const locale = useLocale();
  // A different viewer, locale or playback target cannot retain the previous video.
  return (
    <IpDetailSession
      key={JSON.stringify([params.id, params.watch, params.episode, auth.generation, locale])}
    />
  );
}

function IpDetailSession() {
  const params = useLocalSearchParams<{
    id: string;
    watch?: string | string[];
    episode?: string | string[];
  }>();
  const { id } = params;
  // Invalid duplicate parameters remain invalid, with stable effect dependencies.
  const watch = Array.isArray(params.watch) ? "invalid" : params.watch;
  const episode = Array.isArray(params.episode) ? "" : params.episode;
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const authGate = useAuthGate();
  const auth = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const viewedIpRef = useRef<string | null>(null);
  const [ip, setIp] = useState<IpDetail>();
  // Per-viewer access + community-point balance + prices (authoritative unlock state).
  const [access, setAccess] = useState<IpAccess>();
  const aliveRef = useRef(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const unlockBusyRef = useRef(false);
  const [unlocking, setUnlocking] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState<{ url: string; title: string; episodeId?: string }>();
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    aliveRef.current = true;
    async function load() {
      setLoading(true);
      try {
        // Detail carries the episode list + (once entitled) the video URLs;
        // access carries per-viewer unlock state, prices and the point balance.
        const { detail, access: acc, accessError } = await loadPlaybackDetail(id);
        if (!alive) return;
        setIp(detail);
        setAccess(acc);
        setAccessError(accessError);
        setPlaying(detail ? resolvePlaybackEntry(detail, acc, watch, episode) : undefined);
      } catch {
        if (alive) setIp(undefined);
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
      aliveRef.current = false;
    };
  }, [id, watch, episode]);

  const applyEngagement = useCallback(
    (ipId: string, engagement: IpEngagementSnapshot | undefined) => {
      if (!engagement) return;
      setIp((current) =>
        current?.id === ipId
          ? {
              ...current,
              viewCount: engagement.viewCount,
              likeCount: engagement.likeCount,
              viewerHasLiked: engagement.viewerHasLiked,
              heatLabel: formatEngagementCount(engagement.viewCount, locale),
            }
          : current
      );
    },
    [locale]
  );

  useEffect(() => {
    const ipId = ip?.id;
    if (!ipId || viewedIpRef.current === ipId) return;
    viewedIpRef.current = ipId;
    let alive = true;
    void recordIpView(ipId, { source: "mobile_detail" })
      .then((engagement) => {
        if (!alive) return;
        applyEngagement(ipId, engagement);
        if (engagement) invalidateBrowse();
      })
      .catch(() => {
        // Browsing should never dead-end because analytics recording failed.
      });
    return () => {
      alive = false;
    };
  }, [applyEngagement, ip?.id]);

  // Re-pull detail + access after an unlock (media URL appears; balance drops).
  // Returns both so the caller can auto-play the episode + read the fresh balance
  // without waiting on a state-update tick.
  const refreshAfterUnlock = useCallback(async (): Promise<{
    detail: IpDetail | undefined;
    access: IpAccess | undefined;
  }> => {
    const { detail, access: acc, accessError } = await loadPlaybackDetail(id);
    if (!aliveRef.current) return { detail: undefined, access: undefined };
    setIp(detail);
    setAccess(acc);
    setAccessError(accessError);
    return { detail, access: acc };
  }, [id]);

  const retryAccess = async () => {
    if (accessBusy || unlocking) return;
    setAccessBusy(true);
    setAccess(undefined);
    setPlaying(undefined);
    try {
      const { detail, access: acc } = await refreshAfterUnlock();
      if (aliveRef.current && detail) {
        setPlaying(resolvePlaybackEntry(detail, acc, watch, episode));
      }
    } catch (error) {
      if (aliveRef.current) setAccessError(error instanceof Error ? error.message : "");
    } finally {
      if (aliveRef.current) setAccessBusy(false);
    }
  };

  if (loading) {
    return (
      <ThemedView style={styles.fullCenter}>
        <ActivityIndicator color={theme.textSecondary} />
      </ThemedView>
    );
  }

  if (!ip) {
    return (
      <ThemedView style={[styles.fullCenter, { padding: Spacing.four }]}>
        <EmptyState
          title={t("ipDetail.notFoundTitle")}
          detail={t("ipDetail.notFoundDetail")}
          symbol={{ ios: "film", android: "movie", web: "movie" }}
        />
      </ThemedView>
    );
  }

  const planFor = (episode: IpEpisode) => resolvePlan(access, episode);

  const submitLikeToggle = async () => {
    if (likeBusy) return;
    setLikeBusy(true);
    try {
      const engagement = ip.viewerHasLiked ? await unlikeIp(ip.id) : await likeIp(ip.id);
      applyEngagement(ip.id, engagement);
      invalidateBrowse();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        authGate.openLogin({ onAuthenticated: () => void submitLikeToggle() });
        return;
      }
      Alert.alert(t("ipDetail.likeFailed"));
    } finally {
      setLikeBusy(false);
    }
  };

  const toggleLike = () => {
    authGate.requireAuth({ onAuthenticated: () => void submitLikeToggle() });
  };

  const metaParts = [
    ip.year?.toString(),
    ip.genres.slice(0, 2).join(" · "),
    ip.episodeCount ? `${ip.episodeCount} ${t("ipDetail.episodesUnit")}` : undefined,
  ].filter(Boolean);

  const playVideo = (url?: string, title?: string, episode?: IpEpisode) => {
    if (!url) return;
    setPlaying({
      url,
      title: title ?? ip.title,
      episodeId: episode?.feedbackEligible ? episode.id : undefined,
    });
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  // 1-based list position (same as web) — not raw episodeNo.
  const epLabel = (episode: IpEpisode) =>
    `${t("ipDetail.episodePrefix")}${episode.index}${t("ipDetail.episodeSuffix")}`;

  // Tap action for an episode, against the current access snapshot.
  const runPurchase = async (plan: Extract<UnlockPlan, { kind: "buy" }>, episode: IpEpisode) => {
    if (unlockBusyRef.current || !aliveRef.current) return;
    unlockBusyRef.current = true;
    setUnlocking(true);
    try {
      await purchaseIpContent({
        ipId: ip.id,
        targetType: plan.targetType,
        episodeId: plan.episodeId,
        priceRuleId: plan.priceRuleId,
      });
      if (!aliveRef.current) return;
      setAccess(undefined);
      // The purchase succeeded. A failed refresh is a read-recovery action,
      // not a failed purchase that should be submitted again.
      const refreshed = await refreshAfterUnlock().catch((error: unknown) => {
        if (aliveRef.current) setAccessError(error instanceof Error ? error.message : "");
        return undefined;
      });
      if (!refreshed || !aliveRef.current) return;
      const { detail, access: acc } = refreshed;
      // The just-unlocked episode's media URL now resolves — start playback.
      const fresh = detail?.episodes.find((e) => e.id === episode.id);
      if (fresh?.mediaUrl && !resolvePlan(acc, fresh)) {
        playVideo(fresh.mediaUrl, epLabel(fresh), fresh);
      }
    } catch (error) {
      if (!aliveRef.current) return;
      if (isInsufficientBalanceError(error)) {
        promptCommunityPaywall();
      } else if (isMemberOnlyError(error)) {
        promptCommunityMembership();
      } else if (error instanceof ApiRequestError && error.status === 401) {
        authGate.openLogin({
          onAuthenticated: () => router.setParams({ watch: "1", episode: episode.id }),
        });
      } else {
        Alert.alert(t("ipDetail.unlockFailed"));
      }
    } finally {
      unlockBusyRef.current = false;
      if (aliveRef.current) setUnlocking(false);
    }
  };

  const confirmUnlock = (
    plan: Extract<UnlockPlan, { kind: "buy" }>,
    episode: IpEpisode,
    balance: string | null
  ) => {
    // Balance is known and below the price → skip the doomed "unlock" and say so.
    if (balance != null && balanceBelow(balance, plan.points)) {
      promptCommunityPaywall();
      return;
    }
    const unit = t("ipDetail.pointsUnit");
    const lines = [`${t("ipDetail.unlockSpend")}${formatPoints(plan.points, locale)} ${unit}`];
    if (balance != null) {
      lines.push(`${t("ipDetail.unlockBalanceLine")}${formatPoints(balance, locale)} ${unit}`);
    }
    const title =
      plan.targetType === "ip" ? t("ipDetail.unlockAllTitle") : t("ipDetail.unlockConfirmTitle");
    Alert.alert(title, lines.join("\n"), [
      { text: t("report.cancel"), style: "cancel" },
      { text: t("ipDetail.unlock"), onPress: () => void runPurchase(plan, episode) },
    ]);
  };

  // Act on a resolved (non-pending) plan: member → upsell, buy → confirm+charge.
  const startUnlock = (
    plan: Extract<UnlockPlan, { kind: "member" | "buy" }>,
    episode: IpEpisode,
    balance: string | null
  ) => {
    if (plan.kind === "member") {
      promptCommunityMembership();
      return;
    }
    confirmUnlock(plan, episode, balance);
  };

  const unlockEpisode = (episode: IpEpisode) => {
    const plan = planFor(episode);
    if (!plan || plan.kind === "pending" || plan.kind === "unavailable") return;
    // Not signed in → sign in FIRST (before any member/price decision), then
    // re-derive against the fresh access: the viewer may now be a member (free
    // or member-priced) or the episode may have become playable.
    if (auth.status !== "authenticated") {
      authGate.openLogin({
        // The viewer-keyed session remounts after login. Resume via route intent,
        // never through a callback holding the previous viewer's state or price.
        onAuthenticated: () => router.setParams({ watch: "1", episode: episode.id }),
      });
      return;
    }
    startUnlock(plan, episode, access?.balance ?? null);
  };

  const showActions = () => {
    showContentActionsMenu({
      t,
      blockLabel: t("ipDetail.blockAction"),
      onReport: () => setReportOpen(true),
      onBlock: confirmBlock,
    });
  };

  const submitBlock = async () => {
    try {
      await blockIpContent(ip.id);
      // Lists are filtered server-side for this viewer; nudge browse screens
      // to refetch, then leave the page.
      invalidateBrowse();
      Alert.alert(t("ipDetail.blockSuccessTitle"), t("ipDetail.blockSuccessBody"), [
        { text: t("report.close"), onPress: () => router.back() },
      ]);
    } catch (error) {
      // A 401 means the session expired mid-call (the global handler already
      // cleared it) — tell the user to sign back in, not "try again later".
      if (error instanceof ApiRequestError && error.status === 401) {
        authGate.openLogin({ onAuthenticated: confirmBlock });
        return;
      }
      Alert.alert(t("ipDetail.blockFailed"));
    }
  };

  const confirmBlock = () => {
    Alert.alert(t("ipDetail.blockConfirmTitle"), t("ipDetail.blockConfirmBody"), [
      { text: t("report.cancel"), style: "cancel" },
      {
        text: t("ipDetail.blockConfirmAction"),
        style: "destructive",
        onPress: () => void submitBlock(),
      },
    ]);
  };

  const submitReport = async (reason: IpReportReason) => {
    setReporting(true);
    try {
      await reportIpContent(ip.id, reason);
      setReportOpen(false);
      Alert.alert(t("report.successTitle"), t("report.successBody"));
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        setReportOpen(false);
        authGate.openLogin({ onAuthenticated: () => setReportOpen(true) });
        return;
      }
      Alert.alert(t("report.failed"));
    } finally {
      setReporting(false);
    }
  };

  const openActions = () => {
    authGate.requireAuth({ onAuthenticated: showActions });
  };

  // The web uses locale-prefixed routes (e.g. /en-US/ips/<id>) against the
  // region's public origin. Share QR and community-point checkout both use it.
  const webIpUrl = `${webBaseUrl}/${locale}/ips/${ip.id}`;

  const promptCommunityPaywall = () => {
    promptInsufficientPaywall({
      title: t("ipDetail.insufficientTitle"),
      body: t("ipDetail.insufficientBody"),
      cancelLabel: t("common.cancel"),
      buyLabel: t("paywall.buyCredits"),
      category: "community_points",
      communityReturnUrl: webIpUrl,
    });
  };

  const promptCommunityMembership = () => {
    Alert.alert(t("ipDetail.memberOnlyTitle"), t("ipDetail.memberOnlyWebBody"), [
      { text: t("common.ok") },
    ]);
  };

  const creator = ip.creators[0];
  const creatorName = creator?.name;
  // Real avatar if resolved, else a deterministic DiceBear face (same fallback
  // as the cast/creator chips below).
  const creatorAvatar = creator
    ? (creator.avatarUrl ?? dicebearAvatarUrl(`user:${creator.userId ?? creator.id}`))
    : undefined;

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          // While the inline player is up the slot becomes its close button —
          // a floating control under the transparent native header would not
          // receive taps (the navigation bar wins the hit test).
          headerRight: playing
            ? () => (
                <Pressable
                  accessibilityLabel={t("ipDetail.close")}
                  accessibilityRole="button"
                  hitSlop={10}
                  onPress={() => setPlaying(undefined)}
                >
                  <SymbolView
                    name={{ ios: "xmark", android: "close", web: "close" }}
                    size={18}
                    tintColor="#FFFFFF"
                  />
                </Pressable>
              )
            : () => (
                <View style={styles.headerActions}>
                  <Pressable
                    accessibilityLabel={t("ipDetail.share")}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setShareOpen(true)}
                    style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
                  >
                    <SymbolView
                      name={{ ios: "square.and.arrow.up", android: "share", web: "share" }}
                      size={20}
                      tintColor="#FFFFFF"
                    />
                  </Pressable>
                  <View style={styles.headerButton}>
                    <MoreActionsButton label={t("report.moreActions")} onPress={openActions} />
                  </View>
                </View>
              ),
        }}
      />

      <ReportReasonSheet
        visible={reportOpen}
        submitting={reporting}
        onSelect={(reason) => void submitReport(reason)}
        onClose={() => setReportOpen(false)}
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.seven }}
      >
        <View style={[styles.backdrop, playing && styles.backdropPlaying]}>
          {playing ? (
            <View style={[styles.videoBox, { top: insets.top + 44 }]}>
              <InlineVideo key={playing.url} url={playing.url} />
            </View>
          ) : (
            <>
              <PosterImage
                uri={ip.backdropUrl ?? ip.coverUrl}
                label={ip.title}
                radius={0}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.backdropScrim} />
            </>
          )}
        </View>

        <View style={styles.body}>
          {watch !== undefined && !playing && !resolvePlaybackEntry(ip, access, watch, episode) && (
            <ThemedText type="small" themeColor="textSecondary">
              {t("contentGpsDiscovery.playbackUnavailable")}
            </ThemedText>
          )}
          {playing?.episodeId && <EpisodeFeedback ipId={ip.id} episodeId={playing.episodeId} />}
          <IpKnowledgeChat ipId={ip.id} ipTitle={ip.title} />
          <IpGenerationPanel ipId={ip.id} />
          <View style={styles.titleBlock}>
            <ThemedText type="subtitle" style={styles.title} numberOfLines={2}>
              {ip.title}
            </ThemedText>
            <View style={styles.metaRow}>
              {ip.rating != null ? (
                <View style={styles.ratingRow}>
                  <SymbolView
                    name={{ ios: "star.fill", android: "star", web: "star" }}
                    size={12}
                    tintColor={theme.brand}
                  />
                  <ThemedText type="code" style={{ color: theme.brand }}>
                    {ip.rating.toFixed(1)}
                  </ThemedText>
                </View>
              ) : null}
              <ThemedText type="code" themeColor="textSecondary">
                {metaParts.join("  ·  ")}
              </ThemedText>
              {/* Platform-wide AIGC label — all published IPs are AI-produced. */}
              <View style={[styles.aiBadge, { borderColor: theme.border }]}>
                <ThemedText type="code" themeColor="textSecondary">
                  {t("ipDetail.aiBadge")}
                </ThemedText>
              </View>
            </View>
            <View style={styles.engagementRow}>
              <EngagementPill
                icon={{ ios: "eye", android: "visibility", web: "visibility" }}
                count={formatEngagementCount(ip.viewCount, locale)}
                label={t("ipDetail.views")}
                tint={theme.textSecondary}
                backgroundColor={theme.backgroundElement}
                borderColor={theme.border}
              />
              <EngagementPill
                accessibilityLabel={ip.viewerHasLiked ? t("ipDetail.unlike") : t("ipDetail.like")}
                icon={{
                  ios: ip.viewerHasLiked ? "heart.fill" : "heart",
                  android: ip.viewerHasLiked ? "favorite" : "favorite_border",
                  web: ip.viewerHasLiked ? "favorite" : "favorite_border",
                }}
                count={formatEngagementCount(ip.likeCount, locale)}
                label={t("ipDetail.likes")}
                tint={ip.viewerHasLiked ? theme.brand : theme.textSecondary}
                countColor={ip.viewerHasLiked ? theme.brand : undefined}
                backgroundColor={
                  ip.viewerHasLiked ? "rgba(229,34,39,0.14)" : theme.backgroundElement
                }
                borderColor={ip.viewerHasLiked ? theme.brand : theme.border}
                disabled={likeBusy}
                onPress={toggleLike}
              />
            </View>
          </View>

          <BookmarkControl
            key={ip.id}
            ipId={ip.id}
            episodes={ip.episodes.map((episode) => ({ id: episode.id, title: epLabel(episode) }))}
          />

          <ThemedText type="small" themeColor="textSecondary">
            {t("ipDetail.likeFanNotice")}
          </ThemedText>

          {(() => {
            const pubItems = (ip.publishers ?? []).filter((p) => p.logoUrl?.trim()).slice(0, 4);
            if (!pubItems.length) return null;
            return (
              <View style={styles.publisherSection}>
                <ThemedText type="code" themeColor="textSecondary" style={styles.publisherLabel}>
                  {t("ip.publishers")}
                </ThemedText>
                <View style={styles.publisherRow}>
                  {pubItems.map((pub) => (
                    <View
                      key={pub.id}
                      style={[styles.publisherChip, { backgroundColor: theme.backgroundElement }]}
                    >
                      <Image
                        source={{ uri: pub.logoUrl! }}
                        style={styles.publisherLogo}
                        contentFit="contain"
                        accessibilityLabel={pub.name}
                      />
                    </View>
                  ))}
                </View>
              </View>
            );
          })()}

          {ip.episodes.length ? (
            <View style={styles.section}>
              <SectionHeader
                title={t("ipDetail.episodesTitle")}
                trailing={`${ip.episodeCount ?? ip.episodes.length} ${t("ipDetail.episodesTotal")}`}
              />
              {access?.authenticated && access.balance != null ? (
                <View style={[styles.balanceChip, { backgroundColor: theme.backgroundElement }]}>
                  <SymbolView
                    name={{ ios: "circlebadge.2.fill", android: "toll", web: "toll" }}
                    size={14}
                    tintColor={theme.brand}
                  />
                  <ThemedText type="code" themeColor="textSecondary">
                    {t("ipDetail.balanceLabel")}
                  </ThemedText>
                  <ThemedText type="smallBold" style={{ color: theme.brand }}>
                    {`${formatPoints(access.balance, locale)} ${t("ipDetail.pointsUnit")}`}
                  </ThemedText>
                </View>
              ) : null}
              {accessError !== null || ip.episodes.some((item) => !access?.episodes[item.id]) ? (
                <View style={{ gap: Spacing.two }}>
                  <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert">
                    {accessError || t("ipDetail.accessCheckFailed")}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    disabled={accessBusy || unlocking}
                    onPress={() => void retryAccess()}
                    style={{ minHeight: 44, justifyContent: "center" }}
                  >
                    <ThemedText type="smallBold" style={{ color: theme.brand }}>
                      {t("common.retry")}
                    </ThemedText>
                  </Pressable>
                  {accessBusy ? <ActivityIndicator color={theme.textSecondary} /> : null}
                </View>
              ) : null}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.episodeRow}
              >
                {ip.trailerUrl ? (
                  <MediaCard
                    coverUrl={ip.coverUrl}
                    label={t("ipDetail.trailer")}
                    onPlay={() => playVideo(ip.trailerUrl, t("ipDetail.trailer"))}
                  />
                ) : null}
                {ip.episodes.map((episode) => (
                  <EpisodeCard
                    key={episode.id}
                    episode={episode}
                    title={ip.title}
                    label={epLabel(episode)}
                    plan={planFor(episode)}
                    locale={locale}
                    disabled={unlocking || accessBusy}
                    onPlay={() => playVideo(episode.mediaUrl, epLabel(episode), episode)}
                    onUnlock={() => unlockEpisode(episode)}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {ip.roomCode ? (
            <ThemedView type="backgroundElement" style={styles.roomChip}>
              <SymbolView
                name={{ ios: "number", android: "tag", web: "tag" }}
                size={14}
                tintColor={theme.textSecondary}
              />
              <ThemedText type="code" themeColor="textSecondary">
                {t("ipDetail.room")}
              </ThemedText>
              <ThemedText type="smallBold" style={{ color: theme.brand }}>
                {ip.roomCode}
              </ThemedText>
            </ThemedView>
          ) : null}

          <View style={styles.section}>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={expanded ? undefined : 4}
            >
              {ip.longSynopsis}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)}>
              <ThemedText type="smallBold" style={{ color: theme.brand }}>
                {expanded ? t("ipDetail.showLess") : t("ipDetail.showMore")}
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.tagWrap}>
            <IpTags ip={ip} />
          </View>

          <View style={styles.section}>
            <SectionHeader title={t("ipDetail.castTitle")} />
            <View style={styles.peopleGrid}>
              {[...ip.creators, ...ip.cast].map((person) => (
                <PersonChip key={person.id} person={person} />
              ))}
            </View>
          </View>

          <IpContributingStudios ipId={ip.id} />

          <View style={styles.section}>
            <SectionHeader title={t("ipDetail.rightsTitle")} />
            {ip.copyrightOwner ? (
              <ThemedText type="small" themeColor="textSecondary">
                {`© ${ip.copyrightOwner}`}
              </ThemedText>
            ) : null}
            {ip.rightsStatement ? (
              <ThemedText type="small" themeColor="textSecondary">
                {ip.rightsStatement}
              </ThemedText>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              {ip.aiStatement ?? t("ipDetail.aiNotice")}
            </ThemedText>
          </View>
        </View>
      </ScrollView>

      {/* Last child so the in-tree overlay paints above the page content (and,
          being in this stack screen's tree, above the native tab bar). */}
      <ShareSheet
        visible={shareOpen}
        ip={ip}
        creatorName={creatorName}
        creatorAvatar={creatorAvatar}
        shareUrl={webIpUrl}
        onClose={() => setShareOpen(false)}
      />
    </ThemedView>
  );
}

/**
 * Views / likes chip.
 * Visual shell (border/bg) always on a View — like a Tag/div.
 * Pressable is only the click wrapper (like wrapping Tag with onClick);
 * painting chrome on Pressable itself often fails to show on iOS.
 */
function EngagementPill({
  icon,
  count,
  label,
  tint,
  countColor,
  backgroundColor,
  borderColor,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  icon: ComponentProps<typeof SymbolView>["name"];
  count: string;
  label: string;
  tint: string;
  countColor?: string;
  backgroundColor: string;
  borderColor: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const pill = (
    <View style={[styles.engagementPillChrome, { backgroundColor, borderColor }]}>
      <View style={styles.engagementPillRow}>
        <View style={styles.engagementIconBox}>
          <SymbolView name={icon} size={14} tintColor={tint} />
        </View>
        <ThemedText
          type="smallBold"
          numberOfLines={1}
          style={countColor ? { color: countColor } : undefined}
        >
          {count}
        </ThemedText>
        <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
          {label}
        </ThemedText>
      </View>
    </View>
  );

  if (!onPress) return pill;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed, disabled && styles.engagementDisabled]}
    >
      {pill}
    </Pressable>
  );
}

function InlineVideo({ url }: { url: string }) {
  const t = useTranslations();
  const resumeWhenPresentingRef = useRef(false);
  // Native player (expo-video) — autoplays, native controls incl. a fullscreen
  // button; the parent box already insets below the status bar.
  const player = useVideoPlayer(url, (instance) => {
    instance.staysActiveInBackground = false;
    instance.play();
  });
  const presenting = useScreenActive();

  useEffect(() => {
    if (!presenting) {
      if (player.playing) {
        resumeWhenPresentingRef.current = true;
        player.pause();
      }
      return;
    }
    if (!resumeWhenPresentingRef.current) return;
    resumeWhenPresentingRef.current = false;
    player.play();
  }, [player, presenting]);

  /**
   * Silence before release — same window as the film player. iOS keeps feeding
   * the audio session until the last native AVPlayer reference drops.
   */
  useLayoutEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // Player already released — nothing left to silence.
      }
    };
  }, [player]);

  const { status } = useEvent(player, "statusChange", { status: player.status });
  // `idle`/`loading` cover first open + mid-playback rebuffer; hide once
  // frames are ready. Playback errors stay on the native player UI.
  const showLoading = status === "idle" || status === "loading";

  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="contain"
        nativeControls
      />
      {showLoading ? (
        <View
          accessibilityLabel={t("ipDetail.videoLoading")}
          accessibilityRole="progressbar"
          pointerEvents="none"
          style={styles.videoStatusOverlay}
        >
          <ActivityIndicator color="#FFFFFF" />
          <ThemedText type="small" style={styles.videoStatusText}>
            {t("ipDetail.videoLoading")}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

/** Trailer / promo card at the head of the episode list. */
function MediaCard({
  coverUrl,
  label,
  onPlay,
}: {
  coverUrl?: string;
  label: string;
  onPlay: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPlay} style={styles.episodeCard}>
      <View style={styles.episodeThumbWrap}>
        <PosterImage uri={coverUrl} label={label} style={styles.episodeThumb} />
        <View style={styles.episodePlay}>
          <SymbolView
            name={{ ios: "play.fill", android: "play_arrow", web: "play_arrow" }}
            size={14}
            tintColor="#FFFFFF"
          />
        </View>
      </View>
      <ThemedText type="smallBold" numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function EpisodeCard({
  episode,
  title,
  label,
  plan,
  locale,
  disabled,
  onPlay,
  onUnlock,
}: {
  episode: IpEpisode;
  title: string;
  /** Localized list-order label, e.g. "第1集" / "Episode 1". */
  label: string;
  plan?: UnlockPlan;
  locale: string;
  disabled?: boolean;
  onPlay: () => void;
  onUnlock: () => void;
}) {
  const t = useTranslations();
  // Never substitute videoUrl: it may be a trailer. Missing access is locked too.
  const playable = !!episode.mediaUrl && !plan;
  const buyPlan = plan?.kind === "buy" ? plan : undefined;
  const pending = plan?.kind === "pending";
  const memberLocked = plan?.kind === "member";
  const interactive = playable || !!buyPlan || memberLocked;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!interactive || disabled}
      onPress={playable ? onPlay : onUnlock}
      style={styles.episodeCard}
    >
      <View style={styles.episodeThumbWrap}>
        <PosterImage uri={episode.thumbnailUrl} label={title} style={styles.episodeThumb} />
        {playable ? (
          <View style={styles.episodePlay}>
            <SymbolView
              name={{ ios: "play.fill", android: "play_arrow", web: "play_arrow" }}
              size={14}
              tintColor="#FFFFFF"
            />
          </View>
        ) : pending ? (
          <View style={styles.lockOverlay}>
            <SymbolView
              name={{ ios: "clock", android: "schedule", web: "schedule" }}
              size={16}
              tintColor="#FFFFFF"
            />
            <ThemedText type="code" style={styles.lockText}>
              {t("ipDetail.pendingUnlock")}
            </ThemedText>
          </View>
        ) : buyPlan ? (
          <View style={styles.lockOverlay}>
            <SymbolView
              name={{ ios: "lock.fill", android: "lock", web: "lock" }}
              size={16}
              tintColor="#FFFFFF"
            />
            <ThemedText type="code" style={styles.lockPrice}>
              {`${formatPoints(buyPlan.points, locale)} ${t("ipDetail.pointsUnit")}`}
            </ThemedText>
          </View>
        ) : (
          // Members-only or price-unknown — an inert/upsell lock.
          <View style={styles.lockOverlay}>
            <SymbolView
              name={{ ios: "lock.fill", android: "lock", web: "lock" }}
              size={16}
              tintColor="#FFFFFF"
            />
            <ThemedText type="code" style={styles.lockText}>
              {t("ipDetail.locked")}
            </ThemedText>
          </View>
        )}
        {episode.free ? (
          <View style={styles.freeBadge}>
            <ThemedText type="code" style={styles.freeText}>
              {t("ipDetail.free")}
            </ThemedText>
          </View>
        ) : null}
      </View>
      <ThemedText type="smallBold" numberOfLines={1}>
        {label}
      </ThemedText>
      {episode.durationLabel ? (
        <ThemedText type="code" themeColor="textSecondary">
          {episode.durationLabel}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

function PersonChip({ person }: { person: Person }) {
  const theme = useTheme();
  // Real avatar if resolved, else a deterministic DiceBear face by id (web parity).
  const router = useRouter();
  const avatarUrl = person.avatarUrl ?? dicebearAvatarUrl(`user:${person.userId ?? person.id}`);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!person.userId}
      onPress={() => person.userId && router.push(toHref(`/creator/${person.userId}`))}
      style={({ pressed }) => [
        styles.personChip,
        { backgroundColor: theme.backgroundElement },
        pressed && { opacity: 0.78 },
      ]}
    >
      <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
        <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
      </View>
      <ThemedText type="small" numberOfLines={2} style={styles.personName}>
        {person.name}
      </ThemedText>
    </Pressable>
  );
}

const AVATAR = 56;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  fullCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.four,
  },
  backdrop: {
    height: 340,
    justifyContent: "flex-end",
  },
  backdropScrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(7,8,12,0.42)",
  },
  backdropPlaying: {
    backgroundColor: "#000000",
  },
  videoBox: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  videoStatusOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  videoStatusText: {
    color: "#FFFFFF",
    textAlign: "center",
    paddingHorizontal: Spacing.five,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    // Space the share + more-actions icons so they aren't cramped together.
    gap: Spacing.two,
  },
  headerButton: {
    // Comfortable touch target + breathing room around each header icon.
    minWidth: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.one,
  },
  titleBlock: {
    gap: Spacing.two,
  },
  title: {
    fontSize: 30,
    lineHeight: 34,
  },
  publisherSection: {
    gap: Spacing.one,
  },
  publisherLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  publisherRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  publisherChip: {
    height: 28,
    width: 56,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  publisherLogo: {
    width: "100%",
    height: "100%",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  aiBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  engagementRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  // Shared chrome for views + likes — identical shell so the two chips align.
  engagementPillChrome: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  engagementPillRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
    minHeight: 34,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  engagementIconBox: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  engagementDisabled: {
    opacity: 0.6,
  },
  body: {
    padding: Spacing.four,
    gap: Spacing.five,
  },
  secondaryButton: {
    height: 48,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  roomChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    height: 32,
    paddingHorizontal: Spacing.three,
    borderRadius: 8,
  },
  section: {
    gap: Spacing.two,
  },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  episodeRow: {
    gap: Spacing.two,
    paddingRight: Spacing.four,
  },
  episodeCard: {
    width: 150,
    gap: Spacing.one,
  },
  episodeThumbWrap: {
    position: "relative",
  },
  episodeThumb: {
    width: 150,
    height: 86,
  },
  episodePlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 30,
    height: 30,
    marginTop: -15,
    marginLeft: -15,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12,14,20,0.55)",
  },
  freeBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12,14,20,0.7)",
  },
  freeText: {
    color: "#FFFFFF",
    fontSize: 10,
    letterSpacing: 0.4,
  },
  lockOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: 8,
    backgroundColor: "rgba(7,8,12,0.5)",
  },
  lockText: {
    color: "#FFFFFF",
    fontSize: 10,
    letterSpacing: 0.4,
  },
  lockPrice: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  balanceChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    height: 30,
    paddingHorizontal: Spacing.three,
    borderRadius: 8,
  },
  peopleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.three,
  },
  personChip: {
    flexBasis: "47%",
    flexGrow: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: AVATAR / 2,
    paddingRight: Spacing.three,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  personName: {
    flex: 1,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.82,
  },
});
