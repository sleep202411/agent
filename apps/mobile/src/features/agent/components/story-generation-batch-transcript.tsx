import {
  IconAlertTriangle,
  IconBan,
  IconBox,
  IconChevronDown,
  IconLoader2,
  IconMapPin,
  IconMovie,
  IconPlayerPlay,
  IconRefresh,
  IconUser,
  IconWallet,
} from "@tabler/icons-react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useLayoutEffect, useMemo, useState, type ComponentType } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Colors, Spacing } from "@/constants/theme";
import { useStoryChapterContext } from "@/features/agent/context/story-chapter-context";
import { openComputeRecharge } from "@/features/agent/lib/open-compute-recharge";
import { navigateToStoryPreview } from "@/features/experience-player";
import { useTranslations, type MessageKey } from "@/i18n";

import {
  fillMessageTemplate,
  generationItemFailureDetail,
  isActiveGenerationItem,
  sequentiallyRevealedGenerationItems,
  storyGenerationBatchFailure,
  type StoryAssetSpec,
  type StoryAssetSpecKind,
  type StoryCreativeMediaVersion,
  type StoryGenerationBatch,
  type StoryGenerationBatchItem,
  type StoryStoryboardSequence,
} from "../api/story-production-api";
import { useThreadScrollHydrateLock } from "../hooks/use-agent-thread-scroll";
import { useStoryGenerationBatch } from "../hooks/use-story-generation-batch";
import type { StoryGenerationBatchArtifact } from "../types";

const theme = Colors.dark;
const BRAND_RED = theme.brand;
const CANCELLABLE = new Set(["blocked", "queued", "running", "failed", "partial_failed"]);

const ITEM_STATUS_KEYS = {
  awaiting_confirmation: "agent.generation.itemStatus.awaiting_confirmation",
  blocked: "agent.generation.itemStatus.blocked",
  generating: "agent.generation.itemStatus.generating",
  ready: "agent.generation.itemStatus.ready",
  dispatching: "agent.generation.itemStatus.dispatching",
  submitted: "agent.generation.itemStatus.submitted",
  completed: "agent.generation.itemStatus.completed",
  failed: "agent.generation.itemStatus.failed",
  cancelled: "agent.generation.itemStatus.cancelled",
} as const satisfies Record<string, MessageKey>;

const KIND_KEYS = {
  character: "agent.generation.assetKinds.character",
  location: "agent.generation.assetKinds.location",
  prop: "agent.generation.assetKinds.prop",
} as const satisfies Record<StoryAssetSpecKind, MessageKey>;

const KIND_ICONS = {
  character: IconUser,
  location: IconMapPin,
  prop: IconBox,
} as const satisfies Record<
  StoryAssetSpecKind,
  ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
>;

function mediaUrl(media: StoryCreativeMediaVersion | null | undefined): string | undefined {
  return media?.previewUrl?.trim() || media?.thumbnailUrl?.trim() || undefined;
}

function isVideoMedia(media: StoryCreativeMediaVersion | null | undefined): boolean {
  if (!media) return false;
  return media.mediaKind === "video" || (media.mimeType?.startsWith("video/") ?? false);
}

/** H5 `GeneratedStoryboardMedia` / `GeneratedMedia` — image still, video plays. */
function StoryGeneratedMedia({
  media,
  label,
}: {
  media: StoryCreativeMediaVersion;
  label: string;
}) {
  const videoUrl = isVideoMedia(media) ? media.previewUrl?.trim() : undefined;
  if (videoUrl) {
    return (
      <InlineClipVideo
        url={videoUrl}
        poster={media.thumbnailUrl?.trim() || undefined}
        label={label}
      />
    );
  }
  const uri = mediaUrl(media);
  if (!uri) return null;
  return <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />;
}

function InlineClipVideo({ url, poster, label }: { url: string; poster?: string; label: string }) {
  const player = useVideoPlayer(url, (instance) => {
    instance.staysActiveInBackground = false;
    instance.muted = true;
  });
  useLayoutEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // Player already released.
      }
    };
  }, [player]);

  return (
    <View style={StyleSheet.absoluteFill}>
      {poster ? (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
      <VideoView
        accessibilityLabel={label}
        contentFit="cover"
        nativeControls
        player={player}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function mediaAspect(
  media: StoryCreativeMediaVersion | null | undefined,
  fallback: number
): number {
  const width = media?.width;
  const height = media?.height;
  return width && height && width > 0 && height > 0 ? width / height : fallback;
}

function isGenericRequestFailed(message: string) {
  return message.trim() === "Request failed";
}

/** H5 `StoryGenerationBatchTranscript` compactMobile — sequential cards in chat. */
export function StoryGenerationBatchTranscript({
  reference,
}: {
  reference: StoryGenerationBatchArtifact;
}) {
  const t = useTranslations();
  const live = useStoryGenerationBatch(
    reference.storyProjectId,
    reference.storyChapterId,
    reference.generationBatchId
  );
  useThreadScrollHydrateLock(live.loading && !live.batch);

  if (live.loading && !live.batch) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="rgba(255,255,255,0.72)" />
        <Text style={styles.muted}>{t("agent.generation.loading")}</Text>
      </View>
    );
  }

  if (live.error && !live.batch) {
    return (
      <View style={styles.alert}>
        <Text style={styles.alertText}>{live.error || t("agent.generation.loadError")}</Text>
        <Pressable accessibilityRole="button" onPress={live.retry}>
          <View style={styles.quietChrome}>
            <Text style={styles.quietText}>{t("agent.generation.retry")}</Text>
          </View>
        </Pressable>
      </View>
    );
  }

  if (!live.batch) return null;

  return (
    <BatchBody
      batch={live.batch}
      assets={live.assets}
      storyboard={live.storyboard}
      mutating={live.mutating}
      actionError={live.actionError}
      onCancel={live.cancel}
      onResume={live.resume}
    />
  );
}

function BatchBody({
  batch,
  assets,
  storyboard,
  mutating,
  actionError,
  onCancel,
  onResume,
}: {
  batch: StoryGenerationBatch;
  assets: StoryAssetSpec[];
  storyboard: StoryStoryboardSequence[];
  mutating: boolean;
  actionError: string | null;
  onCancel: () => Promise<void>;
  onResume: () => Promise<void>;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { projectTitle } = useStoryChapterContext();
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const ordered = useMemo(
    () => [...batch.items].sort((left, right) => left.ordinal - right.ordinal),
    [batch.items]
  );
  const transcriptItems = useMemo(() => sequentiallyRevealedGenerationItems(ordered), [ordered]);
  const targetKind = batch.items[0]?.targetKind;
  const recoverable =
    batch.status === "blocked" || batch.status === "failed" || batch.status === "partial_failed";
  const failure = storyGenerationBatchFailure(batch);
  const insufficientBalance =
    failure?.code === "INSUFFICIENT_COMPUTE_POINTS" ||
    failure?.code === "INSUFFICIENT_UNEXPIRED_COMPUTE_POINTS";
  const firstUnfinished = ordered.find((item) => item.status !== "completed");
  const canCancelBatch = batch.canCancel && CANCELLABLE.has(batch.status);

  const itemLabel = (item: StoryGenerationBatchItem): string => {
    if (batch.status === "blocked" && item.id === firstUnfinished?.id) {
      return t(ITEM_STATUS_KEYS.blocked);
    }
    if (isActiveGenerationItem(item.status)) return t(ITEM_STATUS_KEYS.generating);
    return t(ITEM_STATUS_KEYS[item.status]);
  };

  return (
    <View style={styles.stream}>
      {targetKind === "storyboard_clip" ? (
        <StoryboardStream
          items={transcriptItems}
          sequences={storyboard}
          blocked={batch.status === "blocked"}
          canCancel={canCancelBatch}
          mutating={mutating}
          onCancel={onCancel}
        />
      ) : (
        transcriptItems.map((item) => (
          <AssetCard
            key={item.id}
            item={item}
            asset={assetById.get(item.targetId)}
            label={itemLabel(item)}
            blocked={batch.status === "blocked" && item.id === firstUnfinished?.id}
            failureStopped={
              item.status === "failed" &&
              ordered
                .filter((candidate) => candidate.ordinal > item.ordinal)
                .every((candidate) => candidate.status === "cancelled")
            }
            canCancel={isActiveGenerationItem(item.status) && canCancelBatch}
            mutating={mutating}
            onCancel={onCancel}
          />
        ))
      )}

      {recoverable ? (
        <View style={styles.recovery}>
          <Text style={styles.recoveryTitle}>
            {insufficientBalance
              ? t("agent.generation.recovery.balanceTitle")
              : t("agent.generation.recovery.failedTitle")}
          </Text>
          <Text style={styles.recoveryBody}>
            {insufficientBalance
              ? t("agent.generation.recovery.balanceBody")
              : t("agent.generation.recovery.failedBody")}
          </Text>
          <View style={styles.recoveryActions}>
            {insufficientBalance ? (
              <View style={styles.recoveryHit}>
                <Pressable
                  accessibilityRole="button"
                  disabled={mutating}
                  onPress={openComputeRecharge}
                >
                  <View style={[styles.continueChrome, mutating && styles.disabled]}>
                    <IconWallet size={14} color="#FFFFFF" strokeWidth={1.8} />
                    <Text style={styles.continueText} numberOfLines={1}>
                      {t("agent.generation.recovery.recharge")}
                    </Text>
                  </View>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.recoveryHit}>
              <Pressable
                accessibilityRole="button"
                disabled={mutating}
                onPress={() => void onResume()}
              >
                <View
                  style={[
                    insufficientBalance ? styles.stopChrome : styles.continueChrome,
                    mutating && styles.disabled,
                  ]}
                >
                  {mutating ? (
                    <IconLoader2
                      size={14}
                      color={insufficientBalance ? "rgba(255,255,255,0.82)" : "#FFFFFF"}
                      strokeWidth={1.8}
                    />
                  ) : (
                    <IconRefresh
                      size={14}
                      color={insufficientBalance ? "rgba(255,255,255,0.82)" : "#FFFFFF"}
                      strokeWidth={1.8}
                    />
                  )}
                  <Text
                    style={insufficientBalance ? styles.stopText : styles.continueText}
                    numberOfLines={1}
                  >
                    {t("agent.generation.recovery.continue")}
                  </Text>
                </View>
              </Pressable>
            </View>
            <View style={insufficientBalance ? styles.recoveryHitFull : styles.recoveryHit}>
              <Pressable
                accessibilityRole="button"
                disabled={mutating}
                onPress={() => void onCancel()}
              >
                <View style={[styles.stopChrome, mutating && styles.disabled]}>
                  <IconBan size={14} color="rgba(255,255,255,0.82)" strokeWidth={1.8} />
                  <Text style={styles.stopText} numberOfLines={1}>
                    {t("agent.generation.recovery.stop")}
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {actionError && recoverable ? (
        <Text style={styles.alertText}>
          {isGenericRequestFailed(actionError)
            ? t("agent.generation.recovery.resumeError")
            : actionError}
        </Text>
      ) : null}

      {targetKind === "storyboard_clip" && batch.status === "completed" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("agent.generation.mobileStoryboard.play")}
          onPress={() =>
            navigateToStoryPreview(router, batch.projectId, {
              chapterId: batch.chapterId,
              title: projectTitle,
            })
          }
        >
          <View style={styles.playChrome}>
            <IconPlayerPlay size={16} color="#FFFFFF" strokeWidth={1.8} />
            <Text style={styles.playText}>{t("agent.generation.mobileStoryboard.play")}</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

function AssetCard({
  item,
  asset,
  label,
  blocked,
  failureStopped,
  canCancel,
  mutating,
  onCancel,
}: {
  item: StoryGenerationBatchItem;
  asset?: StoryAssetSpec;
  label: string;
  blocked: boolean;
  failureStopped: boolean;
  canCancel: boolean;
  mutating: boolean;
  onCancel: () => Promise<void>;
}) {
  const t = useTranslations();
  const [expanded, setExpanded] = useState(true);
  const [errorOpen, setErrorOpen] = useState(false);
  const media = item.status === "completed" ? asset?.selectedMediaVersion : null;
  const uri = mediaUrl(media);
  const kind = asset?.kind ?? "prop";
  const KindIcon = KIND_ICONS[kind];
  const title = fillMessageTemplate(t("agent.generation.mobileCard.title"), {
    kind: t(KIND_KEYS[kind]),
    name: asset?.name ?? item.targetId,
  });
  const active = isActiveGenerationItem(item.status);
  const failureDetail = item.status === "failed" ? generationItemFailureDetail(item.error) : null;

  return (
    <View style={styles.card} accessibilityLabel={`${title}: ${label}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
      >
        <View style={styles.cardHeader}>
          <KindIcon size={20} color="rgba(255,255,255,0.58)" strokeWidth={1.7} />
          <Text style={styles.cardTitle} numberOfLines={1}>
            {title}
          </Text>
          <View style={expanded ? styles.chevron : styles.chevronCollapsed}>
            <IconChevronDown size={16} color="rgba(255,255,255,0.45)" strokeWidth={1.8} />
          </View>
        </View>
      </Pressable>
      {expanded ? (
        <View style={[styles.media, { aspectRatio: mediaAspect(media, 1) }]}>
          {media ? <StoryGeneratedMedia media={media} label={title} /> : null}
          {!uri && active ? (
            <View style={styles.mediaState}>
              <ActivityIndicator color="rgba(255,255,255,0.72)" />
              <Text style={styles.muted}>{t("agent.generation.mobileCard.generating")}</Text>
              {canCancel ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={mutating}
                  onPress={() => void onCancel()}
                >
                  <View style={[styles.quietChrome, mutating && styles.disabled]}>
                    <IconBan size={14} color="rgba(255,255,255,0.82)" strokeWidth={1.8} />
                    <Text style={styles.quietText}>{t("agent.generation.cancel")}</Text>
                  </View>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {!uri && blocked && item.status === "awaiting_confirmation" ? (
            <View style={styles.mediaState}>
              <IconWallet size={24} color="rgba(255,255,255,0.68)" strokeWidth={1.7} />
              <Text style={styles.stateTitle}>{t("agent.generation.mobileCard.paused")}</Text>
              <Text style={styles.muted}>{t("agent.generation.mobileCard.pausedHint")}</Text>
            </View>
          ) : null}
          {!uri && item.status === "failed" ? (
            <View style={styles.mediaState}>
              <IconAlertTriangle size={24} color="rgba(254,202,202,0.82)" strokeWidth={1.7} />
              <Text style={styles.failTitle}>{t("agent.generation.mobileCard.failed")}</Text>
              <Text style={styles.muted}>
                {t(
                  failureStopped
                    ? "agent.generation.mobileCard.failedStoppedHint"
                    : "agent.generation.mobileCard.failedRetainedHint"
                )}
              </Text>
              {failureDetail ? (
                <Pressable accessibilityRole="button" onPress={() => setErrorOpen((open) => !open)}>
                  <Text style={styles.link}>{t("agent.generation.mobileCard.viewError")}</Text>
                </Pressable>
              ) : null}
              {errorOpen && failureDetail ? (
                <Text style={styles.errorDetail}>{failureDetail}</Text>
              ) : null}
            </View>
          ) : null}
          {!uri && item.status === "cancelled" ? (
            <View style={styles.mediaState}>
              <IconBan size={24} color="rgba(255,255,255,0.55)" strokeWidth={1.7} />
              <Text style={styles.muted}>{t("agent.generation.mobileCard.cancelled")}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function StoryboardStream({
  items,
  sequences,
  blocked,
  canCancel,
  mutating,
  onCancel,
}: {
  items: StoryGenerationBatchItem[];
  sequences: StoryStoryboardSequence[];
  blocked: boolean;
  canCancel: boolean;
  mutating: boolean;
  onCancel: () => Promise<void>;
}) {
  const t = useTranslations();
  const clipIndex = useMemo(() => {
    const map = new Map<string, { sequence: StoryStoryboardSequence; clipTitle: string }>();
    for (const sequence of sequences) {
      for (const clip of sequence.clips) {
        map.set(clip.id, { sequence, clipTitle: clip.title });
      }
    }
    return map;
  }, [sequences]);

  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { sequence: StoryStoryboardSequence | null; items: StoryGenerationBatchItem[] }
    >();
    for (const item of items) {
      const indexed = clipIndex.get(item.targetId);
      const sequenceId = item.sequenceId ?? indexed?.sequence.id ?? item.targetId;
      const group = groups.get(sequenceId) ?? { sequence: indexed?.sequence ?? null, items: [] };
      group.items.push(item);
      groups.set(sequenceId, group);
    }
    return [...groups.entries()];
  }, [clipIndex, items]);

  return (
    <View style={styles.stream}>
      {grouped.map(([sequenceId, group], sequenceIndex) => (
        <View key={sequenceId} style={styles.card}>
          <View style={styles.cardHeader}>
            <IconMovie size={20} color="rgba(255,255,255,0.58)" strokeWidth={1.7} />
            <Text style={styles.cardTitle} numberOfLines={1}>
              {fillMessageTemplate(t("agent.generation.mobileStoryboard.title"), {
                index: sequenceIndex + 1,
                name:
                  group.sequence?.title?.trim() || t("agent.generation.mobileStoryboard.untitled"),
              })}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.clipRow}>
              {group.items.map((item, clipIndexInSequence) => {
                const clip = group.sequence?.clips.find((entry) => entry.id === item.targetId);
                const media = item.status === "completed" ? clip?.selectedMediaVersion : null;
                const uri = mediaUrl(media);
                const active = isActiveGenerationItem(item.status);
                const title =
                  clip?.title?.trim() ||
                  fillMessageTemplate(t("agent.generation.mobileStoryboard.clip"), {
                    index: clipIndexInSequence + 1,
                  });
                return (
                  <View key={item.id} style={styles.clipCard}>
                    <Text style={styles.clipTitle} numberOfLines={1}>
                      {title}
                    </Text>
                    <View style={styles.clipMedia}>
                      {media ? <StoryGeneratedMedia media={media} label={title} /> : null}
                      {!uri && active ? (
                        <View style={styles.mediaState}>
                          <ActivityIndicator color="rgba(255,255,255,0.72)" />
                          <Text style={styles.muted}>
                            {t("agent.generation.mobileStoryboard.generating")}
                          </Text>
                          {canCancel ? (
                            <Pressable
                              accessibilityRole="button"
                              disabled={mutating}
                              onPress={() => void onCancel()}
                            >
                              <View style={[styles.quietChrome, mutating && styles.disabled]}>
                                <Text style={styles.quietText}>{t("agent.generation.cancel")}</Text>
                              </View>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                      {!uri && blocked && item.status === "awaiting_confirmation" ? (
                        <View style={styles.mediaState}>
                          <IconWallet size={24} color="rgba(255,255,255,0.68)" strokeWidth={1.7} />
                          <Text style={styles.stateTitle}>
                            {t("agent.generation.mobileStoryboard.paused")}
                          </Text>
                        </View>
                      ) : null}
                      {!uri && item.status === "failed" ? (
                        <View style={styles.mediaState}>
                          <IconAlertTriangle
                            size={24}
                            color="rgba(254,202,202,0.82)"
                            strokeWidth={1.7}
                          />
                          <Text style={styles.failTitle}>
                            {t("agent.generation.mobileStoryboard.failed")}
                          </Text>
                          {generationItemFailureDetail(item.error) ? (
                            <Text style={styles.muted} numberOfLines={3}>
                              {generationItemFailureDetail(item.error)}
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                      {!uri && item.status === "cancelled" ? (
                        <View style={styles.mediaState}>
                          <IconBan size={24} color="rgba(255,255,255,0.55)" strokeWidth={1.7} />
                          <Text style={styles.muted}>
                            {t("agent.generation.mobileCard.cancelled")}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stream: {
    gap: Spacing.three,
  },
  loading: {
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 112,
    justifyContent: "center",
  },
  muted: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  alert: {
    gap: Spacing.two,
  },
  alertText: {
    color: "rgba(254,202,202,0.88)",
    fontSize: 12,
    lineHeight: 18,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.018)",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cardTitle: {
    color: "rgba(255,255,255,0.88)",
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  chevron: {
    transform: [{ rotate: "0deg" }],
  },
  chevronCollapsed: {
    transform: [{ rotate: "180deg" }],
  },
  media: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderRadius: 12,
    marginBottom: 10,
    marginHorizontal: 10,
    overflow: "hidden",
  },
  mediaState: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    gap: Spacing.two,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  stateTitle: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
  failTitle: {
    color: "rgba(254,202,202,0.88)",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
  link: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    textDecorationLine: "underline",
  },
  errorDetail: {
    color: "rgba(254,202,202,0.76)",
    fontSize: 11,
    lineHeight: 16,
    maxHeight: 96,
  },
  clipRow: {
    flexDirection: "row",
    gap: 10,
    paddingBottom: 10,
    paddingHorizontal: 10,
  },
  clipCard: {
    width: 280,
  },
  clipTitle: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    marginBottom: 8,
  },
  clipMedia: {
    aspectRatio: 16 / 9,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderRadius: 12,
    overflow: "hidden",
  },
  recovery: {
    backgroundColor: "rgba(255,255,255,0.025)",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 16,
    borderWidth: 1,
    gap: Spacing.two,
    padding: 14,
  },
  recoveryTitle: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 14,
    fontWeight: "500",
  },
  recoveryBody: {
    color: "rgba(255,255,255,0.56)",
    fontSize: 12,
    lineHeight: 18,
  },
  recoveryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: 4,
    width: "100%",
  },
  recoveryHit: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 0,
  },
  recoveryHitFull: {
    flexBasis: "100%",
    minWidth: 0,
    width: "100%",
  },
  continueChrome: {
    alignItems: "center",
    backgroundColor: BRAND_RED,
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    height: 40,
    justifyContent: "center",
    width: "100%",
  },
  continueText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  playChrome: {
    alignItems: "center",
    backgroundColor: BRAND_RED,
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    height: 40,
    justifyContent: "center",
  },
  playText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  stopChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    height: 40,
    justifyContent: "center",
    width: "100%",
  },
  stopText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    fontWeight: "500",
  },
  quietChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 10,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quietText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontWeight: "500",
  },
  disabled: {
    opacity: 0.45,
  },
});
