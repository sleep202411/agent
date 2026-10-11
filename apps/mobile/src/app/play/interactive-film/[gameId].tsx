import { createExperienceJourneyMapCopy } from "@/features/experience-player/lib/experience-player-copy";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ExperiencePublishedPlayer } from "@/features/experience-player/components/experience-published-player";
import { useAuth } from "@/auth";
import { createPlaySessionReporter } from "@/features/experience-player/lib/play-session-reporter";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import {
  InteractiveFilmLoadError,
  loadPublishedInteractiveFilm,
  type PublishedInteractiveFilm,
} from "@/data/interactive-film-api";
import {
  ExperienceChapterButton,
  ExperienceChapterPicker,
  ExperienceShareButton,
  ExperienceStartShell,
  buildExperiencePlayShareUrl,
  chapterDisplayTitle,
  findChapter,
  nextChapterAfter,
  type ExperiencePlayerCopy,
} from "@/features/experience-player";
import { usePlayScreenOrientation } from "@/hooks/use-screen-orientation";
import { useLocale, useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Play session shell: orientation + chapter session stay mounted across chapter
 * switches. Changing `?chapter=` reloads only the active Runtime Manifest;
 * the stack does not pop back to the catalogue.
 */
export default function PlayGameScreen() {
  const t = useTranslations();
  const auth = useAuth();
  const reporter = useMemo(() => createPlaySessionReporter(auth.generation), [auth.generation]);
  const locale = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { landscapeReady, exiting } = usePlayScreenOrientation();
  const params = useLocalSearchParams<{
    gameId?: string | string[];
    chapter?: string | string[];
    title?: string | string[];
    subtitle?: string | string[];
    coverUrl?: string | string[];
  }>();
  const gameId = firstParam(params.gameId);
  const chapterId = firstParam(params.chapter);
  const [chapterIntent, setChapterIntent] = useState({ gameId, explicit: Boolean(chapterId) });
  if (chapterIntent.gameId !== gameId) setChapterIntent({ gameId, explicit: Boolean(chapterId) });
  const previewTitle = firstParam(params.title)?.trim() || "";
  const previewSummary = firstParam(params.subtitle)?.trim() || "";
  const previewCoverUrl = firstParam(params.coverUrl)?.trim() || "";

  const [published, setPublished] = useState<PublishedInteractiveFilm>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [reloadToken, setReloadToken] = useState(0);
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false);
  /** Prevents a second fetch when we only canonicalize `?chapter=` onto the URL. */
  const loadedSessionKeyRef = useRef<string | null>(null);

  const copy = useMemo<ExperiencePlayerCopy>(
    () => ({
      journeyMap: createExperienceJourneyMapCopy(t),
      seek: {
        back: t("play.seek.back"),
        forward: t("play.seek.forward"),
        progress: t("play.seek.progress"),
        watchedOnly: t("play.seek.watchedOnly"),
      },
      speed: {
        label: t("play.speed.label"),
        interactionBlocked: t("play.speed.interactionBlocked"),
      },
      invalidManifest: t("play.invalidManifest"),
      unsupportedRuntime: t("play.unsupportedRuntime"),
      manifestRoot: t("play.manifestRoot"),
      interactiveFilm: t("play.interactiveFilm"),
      starting: t("play.starting"),
      start: t("play.start"),
      loadingMedia: t("play.loadingMedia"),
      endingEyebrow: t("play.endingEyebrow"),
      unknownEnding: t("play.unknownEnding"),
      playAgain: t("play.playAgain"),
      runtimeError: t("play.runtimeError"),
      restart: t("play.restart"),
      retryReport: t("play.retryReport"),
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

  const selectChapter = useCallback(
    (nextChapterId: string) => {
      setChapterIntent({ gameId, explicit: true });
      setChapterPickerOpen(false);
      if (nextChapterId === chapterId) return;
      // Same play route — only the chapter search param changes.
      router.setParams({ chapter: nextChapterId });
    },
    [chapterId, gameId, router]
  );

  useEffect(() => {
    // Wait for landscape lock before fetch — orientation mid-request can
    // cancel Expo networking on iOS (FetchRequestCanceledException).
    if (!landscapeReady) return;

    let cancelled = false;

    const run = async () => {
      if (!gameId) {
        setError(t("play.missingGameId"));
        setLoading(false);
        setPublished(undefined);
        loadedSessionKeyRef.current = null;
        return;
      }
      const requestedKey = `${gameId}:${chapterId ?? ""}:${reloadToken}`;
      if (loadedSessionKeyRef.current === requestedKey) {
        setLoading(false);
        setError(undefined);
        return;
      }
      setLoading(true);
      setError(undefined);
      try {
        const next = await loadPublishedInteractiveFilm(gameId, {
          ...(chapterId ? { chapterId } : {}),
        });
        if (cancelled) return;
        setPublished(next);
        const resolvedId = next.activeChapterId ?? chapterId ?? "";
        loadedSessionKeyRef.current = `${gameId}:${resolvedId}:${reloadToken}`;
        // Canonicalize the URL so share / reload land on the same chapter that
        // actually loaded (default chapters[0] when the param was omitted).
        if (next.activeChapterId && next.activeChapterId !== chapterId) {
          router.setParams({ chapter: next.activeChapterId });
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(playLoadErrorMessage(loadError, t("play.loadError")));
        // Keep the previous chapter mounted when a switch fails.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [chapterId, gameId, landscapeReady, reloadToken, router, t]);

  const bootTitle = previewTitle || published?.game.title || t("play.interactiveFilm");
  const bootSummary = previewSummary;
  const bootCover = previewCoverUrl || published?.game.coverUrl || undefined;
  const chapters = published?.chapters ?? [];
  const activeChapterId = published?.activeChapterId ?? chapterId ?? null;
  const multiChapter = chapters.length > 1;
  const activeChapter = findChapter(chapters, activeChapterId);
  const nextChapter = nextChapterAfter(chapters, activeChapterId);
  const chapterButtonLabel = activeChapter
    ? chapterDisplayTitle(activeChapter, locale)
    : t("play.chapters");

  const playerKey = published
    ? `${published.game.gameId}:${published.activeChapterId ?? "solo"}:${published.manifest.buildId}`
    : "boot";

  /** A chapter switch failed but the previous chapter is still mounted. */
  const switchFailed = Boolean(error) && Boolean(published);
  /**
   * Back out of a failed switch: point the URL at the chapter that is actually
   * on stage. The load effect then recognizes its own session key, clears the
   * error without refetching, and the picker can retry the same chapter again.
   */
  const dismissSwitchError = useCallback(() => {
    setError(undefined);
    const loadedChapterId = published?.activeChapterId;
    if (loadedChapterId && loadedChapterId !== chapterId) {
      router.setParams({ chapter: loadedChapterId });
    }
  }, [chapterId, published?.activeChapterId, router]);

  // Share the site link for whatever chapter is open, same as web. The recipient
  // almost never has the app, so a web URL is the only payload that plays on tap.
  const shareUrl = useMemo(
    () =>
      gameId ? buildExperiencePlayShareUrl({ gameId, locale, chapterId: activeChapterId }) : "",
    [activeChapterId, gameId, locale]
  );
  // Only once a chapter is actually on stage — nothing to share from the boot
  // shell or an error state, and the black orientation gate owns the screen.
  const shareReady =
    Boolean(shareUrl) && Boolean(published) && !error && landscapeReady && !exiting;
  const headerRight = useCallback(
    () => (
      <ExperienceShareButton
        label={t("play.share")}
        failedLabel={t("play.shareFailed")}
        shareUrl={shareUrl}
      />
    ),
    [shareUrl, t]
  );

  return (
    <ThemedView style={[styles.screen, { backgroundColor: "#000000" }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerTitle: "",
          headerTintColor: "#FFFFFF",
          headerBackButtonDisplayMode: "minimal",
          // Explicit undefined, not an omitted key: options merge, so a missing
          // `headerRight` would leave the previous one mounted.
          headerRight: shareReady ? headerRight : undefined,
        }}
      />

      {/* Black covers enter/leave orientation windows — not the network wait. */}
      {!landscapeReady || exiting ? (
        <View style={styles.blackGate} />
      ) : published ? (
        <View style={styles.body}>
          <ExperiencePublishedPlayer
            key={`${playerKey}:${auth.generation}`}
            reporter={reporter}
            chapterId={published.activeChapterId ?? ""}
            availableChapterIds={chapters.map((chapter) => chapter.chapterId)}
            explicitChapter={chapterIntent.explicit}
            onSavedChapter={selectChapter}
            runtime={published.manifest}
            locale={locale}
            copy={copy}
            coverUrl={published.game.coverUrl || previewCoverUrl || undefined}
            onNextChapter={nextChapter ? () => selectChapter(nextChapter.chapterId) : undefined}
            nextChapterLabel={
              nextChapter
                ? `${t("play.nextChapter")}: ${chapterDisplayTitle(nextChapter, locale)}`
                : undefined
            }
            // Freeze video / audio / scene clock while an overlay owns the screen.
            active={!loading && !switchFailed}
          />
          {multiChapter ? (
            <ExperienceChapterButton
              label={chapterButtonLabel}
              onPress={() => setChapterPickerOpen(true)}
              top={insets.top + 8}
              left={Math.max(insets.left, Spacing.two) + 44}
            />
          ) : null}
          {multiChapter ? (
            <ExperienceChapterPicker
              visible={chapterPickerOpen}
              chapters={chapters}
              activeChapterId={activeChapterId}
              locale={locale}
              title={t("play.chapters")}
              closeLabel={t("report.close")}
              onSelect={selectChapter}
              onClose={() => setChapterPickerOpen(false)}
            />
          ) : null}
          {switchFailed ? (
            <View pointerEvents="auto" style={styles.switchOverlay}>
              <ThemedText type="smallBold" style={styles.errorTitle}>
                {t("play.chapterLoadFailed")}
              </ThemedText>
              <ThemedText type="small" style={styles.errorDetail}>
                {error}
              </ThemedText>
              <View style={styles.switchActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={retry}
                  style={[styles.switchAction, styles.switchActionPrimary]}
                >
                  <ThemedText type="smallBold" style={styles.switchActionPrimaryLabel}>
                    {t("common.retry")}
                  </ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={dismissSwitchError}
                  style={styles.switchAction}
                >
                  <ThemedText type="smallBold" style={styles.switchActionLabel}>
                    {t("play.keepWatching")}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ) : loading ? (
            <View pointerEvents="auto" style={styles.switchOverlay}>
              <ActivityIndicator color="#FFFFFF" />
              <ThemedText type="small" style={styles.switchLabel}>
                {t("play.loadingChapter")}
              </ThemedText>
            </View>
          ) : null}
        </View>
      ) : error ? (
        <View style={styles.body}>
          <ExperienceStartShell
            eyebrow={copy.interactiveFilm}
            title={bootTitle}
            summary={bootSummary || null}
            coverUri={bootCover}
            ctaLabel={t("common.retry")}
            onPressCta={retry}
          />
          <View
            pointerEvents="box-none"
            style={[styles.errorBanner, { paddingTop: insets.top + 52 }]}
          >
            <ThemedText type="smallBold" style={styles.errorTitle}>
              {t("play.errorTitle")}
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
            summary={bootSummary || null}
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

function playLoadErrorMessage(error: unknown, fallback: string): string {
  // Network / timeout / TLS: show the localized load copy, not Expo native dumps.
  if (error instanceof InteractiveFilmLoadError) {
    if (error.code === "MANIFEST_REQUEST_FAILED" || error.code === "JAVA_REQUEST_FAILED") {
      return fallback;
    }
    return error.message;
  }
  if (error instanceof ApiRequestError && error.code === "NETWORK_ERROR") {
    return fallback;
  }
  return error instanceof Error ? error.message : fallback;
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
  switchActions: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  switchAction: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  switchActionLabel: {
    color: "rgba(255,255,255,0.88)",
  },
  switchActionPrimary: {
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  switchActionPrimaryLabel: {
    color: "#0C0E14",
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
});
