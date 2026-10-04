import { StoryRepairSheet } from "./story-repair-sheet";
import {
  storyPublicationActionErrorKind,
  storyPublicationActionDetail,
  storyPublicationDiagnostics,
  type StoryPublicationDiagnostics,
} from "../api/story-publication-errors";
import {
  IconAlertTriangle,
  IconBolt,
  IconCheck,
  IconCloudOff,
  IconCloudUpload,
  IconLoader2,
} from "@tabler/icons-react-native";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth, useAuthGate } from "@/auth";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import {
  offlineInteractiveFilm,
  prepareInteractiveFilmRelease,
  submitInteractiveFilmRelease,
  type InteractiveFilmPublicationStatus,
} from "@/features/agent/api/interactive-film-publication-api";
import { fillMessageTemplate } from "@/features/agent/api/story-production-api";
import { useStoryChapterContext } from "@/features/agent/context/story-chapter-context";
import { useTranslations, type MessageKey } from "@/i18n";

function formatPoints(value: string | undefined): string {
  if (!value || !/^\d+$/.test(value)) return "—";
  try {
    return BigInt(value).toLocaleString();
  } catch {
    return value;
  }
}

function statusLabelKey(
  status: InteractiveFilmPublicationStatus | null
):
  | "agent.publish.status.draft"
  | "agent.publish.status.reviewing"
  | "agent.publish.status.published"
  | "agent.publish.status.offline" {
  switch (status) {
    case "reviewing":
      return "agent.publish.status.reviewing";
    case "published":
      return "agent.publish.status.published";
    case "offline":
      return "agent.publish.status.offline";
    case null:
    case "draft":
      return "agent.publish.status.draft";
  }
}

function submitActionKey(
  status: InteractiveFilmPublicationStatus | null,
  submitting: boolean,
  rejectReason: string | null
): MessageKey {
  if (submitting) return "agent.publish.actionPending";
  if (status === "reviewing") return "agent.publish.actionReviewing";
  if (status === "published") return "agent.publish.actionPublished";
  if (rejectReason) return "agent.publish.actionResubmit";
  if (status === "offline") return "agent.publish.actionUpdate";
  return "agent.publish.action";
}

/** Compute credits chip — shared by chat and script/assets headers. */
export function StoryCreditsButton() {
  const t = useTranslations();
  const { billingBalance } = useStoryChapterContext();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("agent.credits.manage")}
      hitSlop={6}
      onPress={() =>
        Alert.alert(t("agent.credits.webRechargeTitle"), t("agent.credits.webRechargeBody"), [
          { text: t("common.ok") },
        ])
      }
      style={({ pressed }) => [styles.creditsButton, pressed && styles.pressed]}
    >
      <View style={styles.creditsChrome}>
        <IconBolt color="rgba(255,255,255,0.82)" size={16} strokeWidth={1.8} />
        <Text style={styles.creditsText} numberOfLines={1}>
          {formatPoints(billingBalance?.availablePoints)}
        </Text>
      </View>
    </Pressable>
  );
}

/** Project header actions: publication badge + submit + take offline + credits. */
export function StoryProjectHeaderActions({ projectId }: { projectId: string }) {
  const context = useStoryChapterContext();
  const { generation, user } = useAuth();
  const active = useScreenActive();
  const [repair, setRepair] = useState<{
    projectId: string;
    generation: number;
    diagnostics: StoryPublicationDiagnostics;
  }>();
  const scope = useMemo(
    () => ({ projectId, chapterId: repair?.diagnostics.chapterId ?? "", generation }),
    [projectId, repair?.diagnostics.chapterId, generation]
  );
  const parentToken = useMemo(
    () => ({ projectId, generation, active }),
    [projectId, generation, active]
  );
  const parentLife = useRef<{ token: typeof parentToken; controller: AbortController } | null>(
    null
  );
  useLayoutEffect(() => {
    const controller = new AbortController();
    parentLife.current = { token: parentToken, controller };
    return () => controller.abort();
  }, [parentToken]);
  const authGate = useAuthGate();
  const currentParent = () =>
    active &&
    !!parentLife.current &&
    parentLife.current.token === parentToken &&
    !parentLife.current.controller.signal.aborted &&
    generation === getAuthGeneration();
  const userId = String(user?.userId ?? user?.id ?? "");
  const identity = JSON.stringify([
    projectId,
    generation,
    active,
    ...(["story.release", "story.edit", "story.build"] as const).map((capability) =>
      context.capabilities.includes(capability)
    ),
    context.draftRevision,
    context.videoSnapshotHash,
    context.publication?.status,
    context.publicationFailed,
    context.publicationLoading,
    context.loading,
  ]);
  return (
    <>
      <OwnedStoryProjectHeaderActions
        key={identity}
        projectId={projectId}
        active={active}
        onDiagnostics={(diagnostics) => {
          if (currentParent() && userId) setRepair({ projectId, generation, diagnostics });
        }}
        onSignIn={() => {
          if (currentParent()) authGate.openLogin();
        }}
      />
      {active &&
      userId &&
      repair?.projectId === projectId &&
      repair.generation === generation &&
      scope.chapterId &&
      context.capabilities.includes("story.read") ? (
        <StoryRepairSheet
          scope={scope}
          userId={userId}
          issues={repair.diagnostics.issues}
          onClose={() => setRepair(undefined)}
          onSaved={() => {
            context.refresh();
            context.refreshPublication();
          }}
        />
      ) : null}
    </>
  );
}

function OwnedStoryProjectHeaderActions({
  projectId,
  active,
  onDiagnostics,
  onSignIn,
}: {
  projectId: string;
  active: boolean;
  onDiagnostics: (diagnostics: StoryPublicationDiagnostics) => void;
  onSignIn: () => void;
}) {
  const t = useTranslations();
  const {
    capabilities,
    draftRevision,
    videoSnapshotHash,
    loading: workbenchLoading,
    publication,
    publicationLoading,
    publicationFailed,
    publicationError,
    publicationErrorKind,
    refreshPublication,
    setPublication,
  } = useStoryChapterContext();

  const { generation } = useAuth();
  const gate = useAuthGate();
  const life = useRef<AbortController | null>(null);
  const locked = useRef(false);
  useLayoutEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    return () => controller.abort();
  }, [projectId, generation]);
  const current = () =>
    active && !!life.current && !life.current.signal.aborted && generation === getAuthGeneration();
  const [submitting, setSubmitting] = useState(false);
  const [offlining, setOfflining] = useState(false);

  const canReadPublication = capabilities.includes("story.read");
  const canRelease = capabilities.includes("story.release");
  const canEdit = capabilities.includes("story.edit");
  const canBuild = capabilities.includes("story.build");
  const status = publication?.status ?? null;
  const rejectReason = publication?.rejectReason ?? null;
  const canSubmitStatus = status === null || status === "draft" || status === "offline";
  const canOffline =
    canRelease &&
    !publicationFailed &&
    !publicationLoading &&
    (status === "reviewing" || status === "published");
  const busy = submitting || offlining;
  const hasSnapshot =
    typeof draftRevision === "number" &&
    typeof videoSnapshotHash === "string" &&
    /^[a-f0-9]{64}$/.test(videoSnapshotHash);
  const canSubmit =
    canRelease &&
    canEdit &&
    canBuild &&
    !workbenchLoading &&
    !publicationLoading &&
    !publicationFailed &&
    canSubmitStatus &&
    hasSnapshot &&
    !busy;

  const disabledReason =
    workbenchLoading || publicationLoading
      ? t("agent.publish.statusChecking")
      : publicationFailed
        ? t("agent.publish.statusUnavailable")
        : status === "reviewing"
          ? t("agent.publish.reviewingLocked")
          : status === "published"
            ? t("agent.publish.publishedUpdateLocked")
            : !canEdit || !canBuild
              ? t("agent.publish.permissionDenied")
              : !hasSnapshot
                ? t("agent.publish.notReady")
                : null;

  const showActionError = (title: string, error: unknown, fallback: string) => {
    const kind = storyPublicationActionErrorKind(error);
    const detail = storyPublicationActionDetail(error, fallback);
    const message = kind ? `${t(`agent.publish.actionError.${kind}`)}\n\n${detail}` : detail;
    const diagnostics = storyPublicationDiagnostics(error);
    Alert.alert(title, message, [
      ...(diagnostics.chapterId && diagnostics.issues.length > 0
        ? [{ text: t("storyRepair.title"), onPress: () => onDiagnostics(diagnostics) }]
        : []),
      { text: t("agent.publish.cancel"), style: "cancel" },
      ...(kind === "auth"
        ? [
            {
              text: t("agent.publish.signIn"),
              onPress: () => {
                onSignIn();
              },
            },
          ]
        : []),
    ]);
  };

  const onPublishPress = () => {
    if (!canSubmit) {
      if (disabledReason) Alert.alert(t("agent.publish.action"), disabledReason);
      return;
    }
    Alert.alert(t("agent.publish.confirmTitle"), t("agent.publish.confirmBody"), [
      { text: t("agent.publish.cancel"), style: "cancel" },
      {
        text: t("agent.publish.confirm"),
        onPress: () => {
          void (async () => {
            if (!current() || locked.current || draftRevision == null || !videoSnapshotHash) return;
            locked.current = true;
            const signal = life.current!.signal;
            setSubmitting(true);
            try {
              const release = await prepareInteractiveFilmRelease(
                projectId,
                {
                  expectedDraftRevision: draftRevision,
                  expectedVideoSnapshotHash: videoSnapshotHash,
                },
                signal
              );
              if (!current() || signal.aborted) return;
              const next = await submitInteractiveFilmRelease(projectId, release, signal);
              if (!current() || signal.aborted) return;
              setPublication(next);
              Alert.alert(t("agent.publish.successTitle"), t("agent.publish.success"));
            } catch (error) {
              if (!current()) return;
              showActionError(t("agent.publish.action"), error, t("agent.publish.failed"));
              void refreshPublication();
            } finally {
              locked.current = false;
              if (current()) setSubmitting(false);
            }
          })();
        },
      },
    ]);
  };

  const onOfflinePress = () => {
    if (!canOffline || busy) return;
    Alert.alert(t("agent.publish.offline.title"), t("agent.publish.offline.description"), [
      { text: t("agent.publish.cancel"), style: "cancel" },
      {
        text: t("agent.publish.offline.confirm"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            if (!current() || locked.current) return;
            locked.current = true;
            const signal = life.current!.signal;
            setOfflining(true);
            try {
              const next = await offlineInteractiveFilm(projectId, signal);
              if (!current() || signal.aborted) return;
              setPublication(next);
              Alert.alert(t("agent.publish.offline.action"), t("agent.publish.offline.success"));
            } catch (error) {
              if (!current()) return;
              showActionError(
                t("agent.publish.offline.action"),
                error,
                t("agent.publish.offline.failed")
              );
              void refreshPublication();
            } finally {
              locked.current = false;
              if (current()) setOfflining(false);
            }
          })();
        },
      },
    ]);
  };

  const onRejectionPress = () => {
    if (!rejectReason) return;
    Alert.alert(
      t(statusLabelKey(status)),
      fillMessageTemplate(t("agent.publish.rejectionReason"), { reason: rejectReason })
    );
  };

  const PublishIcon =
    submitting || status === "reviewing"
      ? IconLoader2
      : status === "published"
        ? IconCheck
        : IconCloudUpload;

  const badge = (
    <View style={styles.badge}>
      {rejectReason ? (
        <IconAlertTriangle color="rgba(239,68,68,0.92)" size={14} strokeWidth={1.8} />
      ) : null}
      <Text style={styles.badgeText} numberOfLines={1}>
        {t(statusLabelKey(status))}
      </Text>
    </View>
  );

  return (
    <View style={styles.row}>
      {canReadPublication ? (
        <View style={styles.publishGroup}>
          {publicationFailed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("agent.publish.retryStatus")}
              disabled={publicationLoading}
              hitSlop={6}
              onPress={() =>
                Alert.alert(
                  t("agent.publish.statusUnavailable"),
                  [
                    t(`agent.publish.guidance.${publicationErrorKind ?? "service"}`),
                    publicationError,
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                  [
                    { text: t("agent.publish.cancel"), style: "cancel" },
                    ...(publicationErrorKind === "auth"
                      ? [{ text: t("agent.publish.signIn"), onPress: () => gate.openLogin() }]
                      : []),
                    { text: t("agent.publish.retryStatus"), onPress: refreshPublication },
                  ]
                )
              }
            >
              <View style={styles.badge}>
                <IconAlertTriangle color="rgba(255,255,255,0.72)" size={14} strokeWidth={1.8} />
                <Text style={styles.badgeText}>{t("agent.publish.status.unavailable")}</Text>
              </View>
            </Pressable>
          ) : !publicationLoading ? (
            rejectReason ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={fillMessageTemplate(t("agent.publish.rejectionReason"), {
                  reason: rejectReason,
                })}
                hitSlop={6}
                onPress={onRejectionPress}
                style={({ pressed }) => pressed && styles.pressed}
              >
                {badge}
              </Pressable>
            ) : (
              badge
            )
          ) : null}
          {canRelease && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(submitActionKey(status, submitting, rejectReason))}
              hitSlop={8}
              onPress={onPublishPress}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              {submitting ? (
                <ActivityIndicator color="rgba(255,255,255,0.72)" size="small" />
              ) : (
                <PublishIcon color="rgba(255,255,255,0.68)" size={18} strokeWidth={1.8} />
              )}
            </Pressable>
          )}
          {canOffline ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("agent.publish.offline.action")}
              accessibilityState={{ disabled: busy }}
              hitSlop={8}
              onPress={onOfflinePress}
              style={({ pressed }) => [styles.iconButton, pressed && !busy && styles.pressed]}
            >
              {offlining ? (
                <ActivityIndicator color="rgba(248,113,113,0.92)" size="small" />
              ) : (
                <IconCloudOff color="rgba(248,113,113,0.86)" size={18} strokeWidth={1.8} />
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <StoryCreditsButton />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: 12,
    marginRight: 8,
  },
  publishGroup: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: 8,
  },
  badge: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderRadius: 8,
    flexDirection: "row",
    gap: 4,
    height: 28,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(255,255,255,0.48)",
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  creditsButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
  },
  creditsChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 16,
    flexDirection: "row",
    flexWrap: "nowrap",
    height: 32,
    paddingHorizontal: 12,
  },
  creditsText: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255,255,255,0.82)",
    fontVariant: ["tabular-nums"],
  },
  pressed: {
    opacity: 0.72,
  },
});
