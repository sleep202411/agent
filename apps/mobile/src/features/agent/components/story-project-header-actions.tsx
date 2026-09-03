import IconBolt from "@tabler/icons-react-native/icons/IconBolt";
import IconCheck from "@tabler/icons-react-native/icons/IconCheck";
import IconCloudUpload from "@tabler/icons-react-native/icons/IconCloudUpload";
import IconLoader2 from "@tabler/icons-react-native/icons/IconLoader2";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { appEnv } from "@/config";
import {
  getInteractiveFilmPublication,
  prepareInteractiveFilmRelease,
  submitInteractiveFilmRelease,
  type InteractiveFilmPublication,
  type InteractiveFilmPublicationStatus,
} from "@/features/agent/api/interactive-film-publication-api";
import {
  storyProjectsApi,
  type StoryBillingBalance,
} from "@/features/agent/api/studio-projects-api";
import { useStoryChapterContext } from "@/features/agent/context/story-chapter-context";
import { useLocale, useTranslations } from "@/i18n";

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

/** Compute credits chip — shared by chat and script/assets headers. */
export function StoryCreditsButton({ projectId }: { projectId: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const billingUrl = `${appEnv.api.studioBaseUrl.replace(/\/+$/, "")}/${locale}/settings/billing`;
  const [balance, setBalance] = useState<StoryBillingBalance | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void storyProjectsApi
      .getBillingBalance(projectId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setBalance(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setBalance(null);
      });
    return () => controller.abort();
  }, [projectId]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("agent.credits.manage")}
      hitSlop={6}
      onPress={() => {
        Alert.alert(t("agent.credits.title"), t("agent.credits.insufficientBody"), [
          { text: t("report.cancel"), style: "cancel" },
          {
            text: t("ipDetail.insufficientOpenWeb"),
            onPress: () => {
              Linking.openURL(billingUrl).catch((error: unknown) => {
                console.warn("[story-project-header] open web billing failed", error);
                Alert.alert(t("ipDetail.openWebFailed"));
              });
            },
          },
        ]);
      }}
      style={({ pressed }) => [styles.creditsButton, pressed && styles.pressed]}
    >
      <View style={styles.creditsChrome}>
        <IconBolt color="rgba(255,255,255,0.82)" size={16} strokeWidth={1.8} />
        <Text style={styles.creditsText} numberOfLines={1}>
          {formatPoints(balance?.availablePoints)}
        </Text>
      </View>
    </Pressable>
  );
}

/** Project header actions: publication badge + submit + compute credits. */
export function StoryProjectHeaderActions({ projectId }: { projectId: string }) {
  const t = useTranslations();
  const {
    capabilities,
    draftRevision,
    videoSnapshotHash,
    loading: workbenchLoading,
  } = useStoryChapterContext();

  const [publication, setPublication] = useState<InteractiveFilmPublication | null>(null);
  const [publicationLoading, setPublicationLoading] = useState(true);
  const [publicationFailed, setPublicationFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canRelease = capabilities.includes("story.release");
  const canEdit = capabilities.includes("story.edit");
  const canBuild = capabilities.includes("story.build");
  const status = publication?.status ?? null;
  const canSubmitStatus = status === null || status === "draft" || status === "offline";
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
    !submitting;

  const refreshHeaderData = useCallback(
    async (signal?: AbortSignal) => {
      if (!canRelease) {
        setPublication(null);
        setPublicationFailed(false);
        setPublicationLoading(false);
        return;
      }

      setPublicationLoading(true);
      setPublicationFailed(false);
      try {
        const nextPublication = await getInteractiveFilmPublication(projectId, signal);
        if (signal?.aborted) return;
        setPublication(nextPublication);
      } catch {
        if (signal?.aborted) return;
        setPublication(null);
        setPublicationFailed(true);
      } finally {
        if (!signal?.aborted) setPublicationLoading(false);
      }
    },
    [canRelease, projectId]
  );

  useEffect(() => {
    if (workbenchLoading) return;
    const controller = new AbortController();
    void refreshHeaderData(controller.signal).catch(() => {
      if (!controller.signal.aborted) setPublicationLoading(false);
    });
    return () => controller.abort();
  }, [refreshHeaderData, workbenchLoading]);

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
            if (draftRevision == null || !videoSnapshotHash) return;
            setSubmitting(true);
            try {
              const release = await prepareInteractiveFilmRelease(projectId, {
                expectedDraftRevision: draftRevision,
                expectedVideoSnapshotHash: videoSnapshotHash,
              });
              const next = await submitInteractiveFilmRelease(projectId, release);
              setPublication(next);
              Alert.alert(t("agent.publish.successTitle"), t("agent.publish.success"));
            } catch (error) {
              const message =
                error instanceof Error && error.message.trim()
                  ? error.message
                  : t("agent.publish.failed");
              Alert.alert(t("agent.publish.action"), message);
            } finally {
              setSubmitting(false);
            }
          })();
        },
      },
    ]);
  };

  const PublishIcon =
    submitting || status === "reviewing"
      ? IconLoader2
      : status === "published"
        ? IconCheck
        : IconCloudUpload;

  return (
    <View style={styles.row}>
      {canRelease ? (
        <View style={styles.publishGroup}>
          {!publicationLoading && !publicationFailed ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {t(statusLabelKey(status))}
              </Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("agent.publish.action")}
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
        </View>
      ) : null}
      <StoryCreditsButton projectId={projectId} />
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
    height: 28,
    justifyContent: "center",
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.055)",
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
