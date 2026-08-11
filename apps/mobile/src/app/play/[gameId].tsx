import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import {
  InteractiveFilmLoadError,
  loadPublishedInteractiveFilm,
  type PublishedInteractiveFilm,
} from "@/data/interactive-film-api";
import {
  ExperiencePlayer,
  ExperienceStartShell,
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
 * Play route boot: black gate while lockAsync rotates to landscape on enter,
 * and again while restoring portrait on leave (usePreventRemove) before pop.
 * Orientation is lockAsync-only — Stack orientation does not drive iOS rotation
 * reliably with react-native-screens / Dev Client.
 */
export default function PlayGameScreen() {
  const t = useTranslations();
  const locale = useLocale();
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
  const previewTitle = firstParam(params.title)?.trim() || "";
  const previewSummary = firstParam(params.subtitle)?.trim() || "";
  const previewCoverUrl = firstParam(params.coverUrl)?.trim() || "";

  const [published, setPublished] = useState<PublishedInteractiveFilm>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [reloadToken, setReloadToken] = useState(0);

  const copy = useMemo<ExperiencePlayerCopy>(
    () => ({
      invalidManifest: t("play.invalidManifest"),
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
      noVisibleChoices: t("play.noVisibleChoices"),
      continue: t("play.continue"),
      emptySequence: t("play.emptySequence"),
      mediaError: (assetId: string) => t("play.mediaError").replace("{assetId}", assetId),
    }),
    [t]
  );

  const retry = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

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
      } catch (loadError) {
        if (cancelled) return;
        setError(playLoadErrorMessage(loadError, t("play.loadError")));
        setPublished(undefined);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [chapterId, gameId, landscapeReady, reloadToken, t]);

  const bootTitle = previewTitle || published?.game.title || t("play.interactiveFilm");
  const bootSummary = previewSummary;
  const bootCover = previewCoverUrl || published?.game.coverUrl || undefined;

  return (
    <ThemedView style={[styles.screen, { backgroundColor: "#000000" }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerTitle: "",
          headerTintColor: "#FFFFFF",
          headerBackButtonDisplayMode: "minimal",
          // Required with usePreventRemove on native-stack (see RN screens / RN nav docs).
          headerBackButtonMenuEnabled: false,
          gestureEnabled: false,
          fullScreenGestureEnabled: false,
        }}
      />

      {/* Black covers enter/leave orientation windows — not the network wait. */}
      {!landscapeReady || exiting ? (
        <View style={styles.blackGate} />
      ) : published && !error ? (
        <View style={styles.body}>
          <ExperiencePlayer
            runtime={published.manifest}
            locale={locale}
            copy={copy}
            coverUrl={published.game.coverUrl || previewCoverUrl || undefined}
          />
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
