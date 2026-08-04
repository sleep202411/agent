import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, PosterImage } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import {
  loadPublishedInteractiveFilm,
  type PublishedInteractiveFilm,
} from "@/data/interactive-film-api";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

/**
 * Phase A placeholder: loads + verifies the published Runtime Manifest.
 * The RN experience-player host lands in a later phase.
 */
export default function PlayGameScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    gameId?: string | string[];
    chapter?: string | string[];
  }>();
  const gameId = Array.isArray(params.gameId) ? params.gameId[0] : params.gameId;
  const chapterId = Array.isArray(params.chapter) ? params.chapter[0] : params.chapter;

  const [published, setPublished] = useState<PublishedInteractiveFilm>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!gameId) {
      setError(t("play.missingGameId"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const next = await loadPublishedInteractiveFilm(gameId, {
        ...(chapterId ? { chapterId } : {}),
      });
      setPublished(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("play.loadError"));
      setPublished(undefined);
    } finally {
      setLoading(false);
    }
  }, [chapterId, gameId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ThemedView style={[styles.screen, { backgroundColor: "#000000" }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerTitle: "",
          headerTintColor: "#FFFFFF",
          headerBackButtonDisplayMode: "minimal",
        }}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#FFFFFF" />
          <ThemedText type="small" style={styles.lightMuted}>
            {t("play.loading")}
          </ThemedText>
        </View>
      ) : error || !published ? (
        <View style={[styles.center, { paddingTop: insets.top + 56 }]}>
          <EmptyState
            title={t("play.errorTitle")}
            detail={error ?? t("play.loadError")}
            symbol={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
            action={{ label: t("common.retry"), onPress: () => void load() }}
          />
        </View>
      ) : (
        <View style={[styles.body, { paddingTop: insets.top + 56 }]}>
          <PosterImage
            uri={published.game.coverUrl}
            label={published.game.title}
            radius={12}
            style={styles.cover}
          />
          <ThemedText type="subtitle" style={styles.title}>
            {published.game.title}
          </ThemedText>
          <ThemedText type="small" style={styles.lightMuted}>
            {t("play.manifestReady")}
          </ThemedText>
          <View style={[styles.metaBox, { borderColor: theme.border }]}>
            <MetaRow label={t("play.version")} value={published.game.currentVersion} />
            <MetaRow
              label={t("play.profile")}
              value={published.manifest.metadata.experienceProfile ?? "—"}
            />
            <MetaRow
              label={t("play.chapters")}
              value={
                published.chapters.length
                  ? String(published.chapters.length)
                  : t("play.singleChapter")
              }
            />
            {published.activeChapterId ? (
              <MetaRow label={t("play.activeChapter")} value={published.activeChapterId} />
            ) : null}
            <MetaRow
              label={t("play.scenes")}
              value={String(published.manifest.graph.nodes.length)}
            />
          </View>
          <ThemedText type="small" style={styles.lightMuted}>
            {t("play.playerComingSoon")}
          </ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <ThemedText type="code" style={styles.lightMuted}>
        {label}
      </ThemedText>
      <ThemedText type="code" style={styles.lightText} numberOfLines={2}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  body: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 28,
    lineHeight: 34,
  },
  metaBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  metaRow: {
    gap: 2,
  },
  lightText: {
    color: "#FFFFFF",
  },
  lightMuted: {
    color: "rgba(255,255,255,0.65)",
  },
});
