import { createExperienceJourneyMapCopy } from "@/features/experience-player/lib/experience-player-copy";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react-native";
import {
  ExperienceRuntimeManifestSchema,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  hasWorldRenderer,
  loadWorldPreviewScope,
  type WorldPreviewScope,
} from "@/features/experience-player/world/world-preview-scope";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { fillMessageTemplate } from "@/features/agent/api/story-production-api";
import {
  getStoryWorkingPreview,
  type StoryBuildDiagnostic,
  type StoryWorkingPreview,
} from "@/features/agent/api/story-working-preview-api";
import {
  ExperiencePlayerWithAccess,
  ExperienceStartShell,
  localize,
  type ExperiencePlayerCopy,
} from "@/features/experience-player";
import { usePlayScreenOrientation } from "@/hooks/use-screen-orientation";
import { PLAY_ROUTE_SCREEN_OPTIONS } from "@/hooks/play-orientation";
import { useLocale, useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Creator playtest — H5 `/story-studio/projects/:id/playtest`. Compiles the
 * saved draft via working-preview and runs the same ExperiencePlayer as a
 * published film. Clip-level diagnostics stay beside a playable runtime.
 */
export default function StoryPreviewScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { landscapeReady, exiting, onStageLayout } = usePlayScreenOrientation();
  const params = useLocalSearchParams<{
    projectId?: string | string[];
    chapter?: string | string[];
    title?: string | string[];
    coverUrl?: string | string[];
  }>();
  const projectId = firstParam(params.projectId)?.trim() ?? "";
  const chapterId = firstParam(params.chapter)?.trim() || undefined;
  const previewTitle = firstParam(params.title)?.trim() || "";
  const previewCoverUrl = firstParam(params.coverUrl)?.trim() || "";

  const [loadedPreview, setPreview] = useState<
    StoryWorkingPreview & {
      generation: number;
      projectId: string;
      chapterId?: string;
      worldScope?: WorldPreviewScope;
    }
  >();
  const preview =
    auth.status === "authenticated" &&
    loadedPreview?.generation === auth.generation &&
    loadedPreview.projectId === projectId &&
    loadedPreview.chapterId === chapterId
      ? loadedPreview
      : undefined;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [reloadToken, setReloadToken] = useState(0);

  const copy = useMemo<ExperiencePlayerCopy>(
    () => ({
      journeyMap: createExperienceJourneyMapCopy(t),
      speed: {
        label: t("play.speed.label"),
        interactionBlocked: t("play.speed.interactionBlocked"),
      },
      invalidManifest: t("play.invalidManifest"),
      unsupportedRuntime: t("play.unsupportedRuntime"),
      manifestRoot: t("play.manifestRoot"),
      interactiveFilm: t("play.playtest.eyebrow"),
      starting: t("play.starting"),
      start: t("play.start"),
      loadingMedia: t("play.loadingMedia"),
      endingEyebrow: t("play.endingEyebrow"),
      unknownEnding: t("play.unknownEnding"),
      playAgain: t("play.playAgain"),
      runtimeError: t("play.runtimeError"),
      restart: t("play.restart"),
      noVisibleChoices: t("play.noVisibleChoices"),
      continue: t("play.continue"),
      pause: t("play.pause"),
      resume: t("play.resume"),
      paused: t("play.paused"),
      emptySequence: t("play.emptySequence"),
      mediaError: (assetId: string) => t("play.mediaError").replace("{assetId}", assetId),
    }),
    [t]
  );

  const retry = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!landscapeReady) return;

    const abort = new AbortController();
    const generation = auth.generation;
    const current = () => !abort.signal.aborted && generation === getAuthGeneration();
    const run = async () => {
      if (auth.status !== "authenticated") {
        setPreview(undefined);
        setLoading(false);
        setError(t("agent.signInToLoadProjects"));
        return;
      }
      if (!projectId) {
        setError(t("play.playtest.missingProjectId"));
        setLoading(false);
        setPreview(undefined);
        return;
      }
      setLoading(true);
      setError(undefined);
      try {
        const next = await getStoryWorkingPreview(projectId, chapterId, abort.signal);
        if (!current()) return;
        const parsed = ExperienceRuntimeManifestSchema.safeParse(next.runtime);
        const worldScope =
          parsed.success && hasWorldRenderer(parsed.data)
            ? await loadWorldPreviewScope(projectId, generation, abort.signal)
            : undefined;
        if (!current()) return;
        setPreview({ ...next, generation, projectId, chapterId, worldScope });
      } catch (loadError) {
        if (!current()) return;
        setError(playtestErrorMessage(loadError, t("play.playtest.errorFallback")));
        setPreview(undefined);
      } finally {
        if (current()) setLoading(false);
      }
    };

    void run();
    return () => {
      abort.abort();
    };
  }, [chapterId, landscapeReady, projectId, reloadToken, t, auth.generation, auth.status]);

  const parsedRuntime = useMemo(() => {
    if (!preview?.runtime) return null;
    const parsed = ExperienceRuntimeManifestSchema.safeParse(preview.runtime);
    return parsed.success ? parsed.data : null;
  }, [preview]);
  const playableRuntime = (preview?.runtime ?? null) as ExperienceRuntimeManifest | null;

  const runtimeTitle = parsedRuntime
    ? localize(parsedRuntime.metadata.title, locale, parsedRuntime.localization.defaultLocale)
    : "";
  const bootTitle = runtimeTitle || previewTitle || t("play.playtest.pageTitle");
  const bootCover = preview?.coverUrl || previewCoverUrl || undefined;
  const sourceLabel = preview
    ? fillMessageTemplate(t("play.playtest.draftRevision"), { revision: preview.draftRevision })
    : "";
  const diagnostics = preview?.diagnostics ?? [];
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const unavailable = Boolean(preview) && !preview?.runtime;

  const headerRight = useCallback(
    () => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("play.playtest.refresh")}
        hitSlop={8}
        onPress={retry}
        style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
      >
        <IconRefresh color="#FFFFFF" size={18} strokeWidth={1.8} />
      </Pressable>
    ),
    [retry, t]
  );
  const refreshReady = Boolean(preview) && !loading && landscapeReady && !exiting;

  return (
    <ThemedView style={[styles.screen, { backgroundColor: "#000000" }]} onLayout={onStageLayout}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerTitle: "",
          headerTintColor: "#FFFFFF",
          headerBackButtonDisplayMode: "minimal",
          ...PLAY_ROUTE_SCREEN_OPTIONS,
          headerRight: refreshReady ? headerRight : undefined,
        }}
      />

      {!landscapeReady || exiting ? (
        <View style={styles.blackGate} />
      ) : unavailable ? (
        <PlaytestUnavailable
          message={fillMessageTemplate(t("play.playtest.unavailableDescription"), {
            errors: errors.length,
            warnings: warnings.length,
          })}
          diagnostics={diagnostics}
          onRetry={retry}
          paddingTop={insets.top + 52}
        />
      ) : playableRuntime ? (
        <View style={styles.body}>
          <ExperiencePlayerWithAccess
            key={`${parsedRuntime?.buildId ?? "invalid-runtime"}:${preview?.draftRevision ?? 0}:${reloadToken}`}
            accessMode="preview"
            worldScope={preview?.worldScope}
            runtime={playableRuntime}
            locale={locale}
            copy={copy}
            coverUrl={preview?.coverUrl ?? undefined}
            active={!loading}
          />
          {sourceLabel ? (
            <View
              pointerEvents="none"
              style={[
                styles.sourceChip,
                {
                  top: insets.top + 8,
                  left: Math.max(insets.left, Spacing.two) + 44 + Spacing.two,
                },
              ]}
            >
              <ThemedText type="code" style={styles.sourceTitle} numberOfLines={1}>
                {bootTitle}
              </ThemedText>
              <ThemedText type="code" style={styles.sourceMeta} numberOfLines={1}>
                {sourceLabel}
              </ThemedText>
            </View>
          ) : null}
          {loading ? (
            <View pointerEvents="auto" style={styles.switchOverlay}>
              <ActivityIndicator color="#FFFFFF" />
              <ThemedText type="small" style={styles.switchLabel}>
                {t("play.playtest.loading")}
              </ThemedText>
            </View>
          ) : null}
        </View>
      ) : error ? (
        <View style={styles.body}>
          <ExperienceStartShell
            eyebrow={copy.interactiveFilm}
            title={bootTitle}
            summary={null}
            coverUri={bootCover}
            ctaLabel={t("common.retry")}
            onPressCta={retry}
          />
          <View
            pointerEvents="box-none"
            style={[styles.errorBanner, { paddingTop: insets.top + 52 }]}
          >
            <ThemedText type="smallBold" style={styles.errorTitle}>
              {t("play.playtest.unavailableTitle")}
            </ThemedText>
            <ThemedText type="small" style={styles.errorDetail}>
              {error}
            </ThemedText>
          </View>
        </View>
      ) : (
        <View style={styles.body}>
          <ExperienceStartShell
            eyebrow={copy.interactiveFilm}
            title={bootTitle}
            summary={null}
            coverUri={bootCover}
            ctaLabel={copy.start}
            ctaDisabled
            ctaBusy={loading}
          />
        </View>
      )}
    </ThemedView>
  );
}

function PlaytestUnavailable({
  message,
  diagnostics,
  onRetry,
  paddingTop,
}: {
  message: string;
  diagnostics: StoryBuildDiagnostic[];
  onRetry: () => void;
  paddingTop: number;
}) {
  const t = useTranslations();
  return (
    <ScrollView
      contentContainerStyle={[styles.unavailableBody, { paddingTop }]}
      keyboardShouldPersistTaps="handled"
    >
      <IconAlertTriangle color="rgba(254,202,202,0.88)" size={24} strokeWidth={1.7} />
      <ThemedText type="smallBold" style={styles.unavailableTitle}>
        {t("play.playtest.unavailableTitle")}
      </ThemedText>
      <ThemedText type="small" style={styles.unavailableMessage}>
        {message}
      </ThemedText>
      {diagnostics.length > 0 ? (
        <View style={styles.diagnosticList}>
          {diagnostics.map((diagnostic, index) => (
            <View
              key={`${diagnostic.code}:${diagnostic.entityId ?? "project"}:${index}`}
              style={styles.diagnostic}
            >
              <ThemedText type="small" style={styles.diagnosticMessage}>
                {diagnostic.message}
              </ThemedText>
            </View>
          ))}
        </View>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onRetry}>
        <View style={styles.retryChrome}>
          <IconRefresh color="#FFFFFF" size={16} strokeWidth={1.8} />
          <ThemedText type="smallBold" style={styles.retryLabel}>
            {t("common.retry")}
          </ThemedText>
        </View>
      </Pressable>
    </ScrollView>
  );
}

function playtestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && error.code === "NETWORK_ERROR") return fallback;
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  blackGate: {
    flex: 1,
    backgroundColor: "#000000",
  },
  refreshButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.72,
  },
  sourceChip: {
    position: "absolute",
    maxWidth: 220,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  sourceTitle: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 11,
    fontWeight: "600",
  },
  sourceMeta: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 10,
    marginTop: 2,
  },
  switchOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    backgroundColor: "rgba(0,0,0,0.72)",
    zIndex: 30,
  },
  switchLabel: {
    color: "rgba(255,255,255,0.72)",
  },
  errorBanner: {
    position: "absolute",
    left: Spacing.four,
    right: Spacing.four,
    gap: Spacing.one,
  },
  errorTitle: {
    color: "#fecaca",
    textAlign: "center",
  },
  errorDetail: {
    color: "rgba(254,202,202,0.78)",
    textAlign: "center",
  },
  unavailableBody: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  unavailableTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    textAlign: "center",
  },
  unavailableMessage: {
    color: "rgba(255,255,255,0.54)",
    textAlign: "center",
  },
  diagnosticList: {
    alignSelf: "stretch",
    gap: Spacing.two,
    maxHeight: 280,
    marginTop: Spacing.two,
  },
  diagnostic: {
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  diagnosticMessage: {
    color: "rgba(255,255,255,0.68)",
  },
  retryChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    height: 40,
    justifyContent: "center",
    marginTop: Spacing.two,
    paddingHorizontal: 16,
  },
  retryLabel: {
    color: "#FFFFFF",
  },
});
