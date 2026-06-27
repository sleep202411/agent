import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";

import { useAuthGate } from "@/auth";
import {
  MoreActionsButton,
  ReportReasonSheet,
  showContentActionsMenu,
} from "@/components/report-actions";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, PosterImage, SectionHeader, Tag } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { invalidateBrowse } from "@/data/browse-refresh";
import {
  blockIpContent,
  getIpById,
  reportIpContent,
  type IpReportReason,
} from "@/data/browse-service";
import type { IpDetail, IpEpisode, Person } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";
import { dicebearAvatarUrl } from "@/lib/avatar";

export default function IpDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const t = useTranslations();
  const router = useRouter();
  const authGate = useAuthGate();
  const scrollRef = useRef<ScrollView>(null);
  const [ip, setIp] = useState<IpDetail>();
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState<{ url: string; title: string }>();
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const data = await getIpById(id);
        if (alive) setIp(data);
      } catch {
        if (alive) setIp(undefined);
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [id]);

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

  const metaParts = [
    ip.year?.toString(),
    ip.genres.slice(0, 2).join(" · "),
    ip.episodeCount ? `${ip.episodeCount} ${t("ipDetail.episodesUnit")}` : undefined,
  ].filter(Boolean);

  const playVideo = (url?: string, title?: string) => {
    if (!url) return;
    setPlaying({ url, title: title ?? ip.title });
    scrollRef.current?.scrollTo({ y: 0, animated: true });
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
            : () => <MoreActionsButton label={t("report.moreActions")} onPress={openActions} />,
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
              <InlineVideo url={playing.url} />
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
          </View>

          {ip.episodes.length ? (
            <View style={styles.section}>
              <SectionHeader
                title={t("ipDetail.episodesTitle")}
                trailing={`${ip.episodeCount ?? ip.episodes.length} ${t("ipDetail.episodesTotal")}`}
              />
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
                    onPlay={() =>
                      playVideo(
                        episode.videoUrl,
                        `${t("ipDetail.episodePrefix")}${episode.index}${t("ipDetail.episodeSuffix")}`
                      )
                    }
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
            {ip.tags.map((tag) => (
              <Tag key={tag} label={tag} />
            ))}
          </View>

          <View style={styles.section}>
            <SectionHeader title={t("ipDetail.castTitle")} />
            <View style={styles.peopleGrid}>
              {[...ip.creators, ...ip.cast].map((person) => (
                <PersonChip key={person.id} person={person} />
              ))}
            </View>
          </View>

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
    </ThemedView>
  );
}

function InlineVideo({ url }: { url: string }) {
  // Native player (expo-video) — autoplays, native controls incl. a fullscreen
  // button; the parent box already insets below the status bar.
  const player = useVideoPlayer(url, (instance) => {
    instance.play();
  });
  return (
    <VideoView
      style={StyleSheet.absoluteFill}
      player={player}
      contentFit="contain"
      nativeControls
    />
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
  onPlay,
}: {
  episode: IpEpisode;
  title: string;
  onPlay: () => void;
}) {
  const t = useTranslations();
  const playable = !!episode.videoUrl;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!playable}
      onPress={onPlay}
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
        ) : (
          // No playable video = locked: the backend withholds the media URL for
          // episodes this viewer hasn't unlocked.
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
        {`${t("ipDetail.episodePrefix")}${episode.index}${t("ipDetail.episodeSuffix")}`}
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
  const avatarUrl = person.avatarUrl ?? dicebearAvatarUrl(`user:${person.userId ?? person.id}`);
  return (
    <View style={[styles.personChip, { backgroundColor: theme.backgroundElement }]}>
      <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
        <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
      </View>
      <ThemedText type="small" numberOfLines={2} style={styles.personName}>
        {person.name}
      </ThemedText>
    </View>
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
  },
  titleBlock: {
    gap: Spacing.one,
  },
  title: {
    fontSize: 30,
    lineHeight: 34,
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
