import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, ListFooter, PosterImage, ScreenHeader, Skeleton } from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { loadGameCatalogue, type GameCatalogueRow } from "@/data/game-catalogue";
import { toHref } from "@/lib/navigation";
import { FilmStore } from "@/features/film-store/film-store";
import type { ExperienceGameSummary } from "@/data/interactive-film-api";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export default function GamesScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedFilm, setSelectedFilm] = useState<ExperienceGameSummary | null>(null);
  const [games, setGames] = useState<GameCatalogueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const scope = useMemo(() => ({ t }), [t]);
  const lifetime = useRef<{ scope: typeof scope; controller: AbortController | null } | null>(null);
  const load = useCallback(() => {
    if (lifetime.current?.scope !== scope) return Promise.resolve();
    lifetime.current.controller?.abort();
    const controller = new AbortController();
    lifetime.current = { scope, controller };
    const { signal } = controller;
    return loadGameCatalogue(signal)
      .then((next) => {
        if (signal?.aborted) return;
        setGames(next.games);
        setWarnings(next.warnings);
        setError(undefined);
      })
      .catch((loadError: unknown) => {
        if (signal?.aborted) return;
        setError(loadError instanceof Error ? loadError.message : t("games.loadError"));
      })
      .finally(() => {
        if (signal?.aborted) return;
        setLoading(false);
        setRefreshing(false);
        if (lifetime.current?.controller === controller)
          lifetime.current = { scope, controller: null };
      });
  }, [t, scope]);

  useEffect(() => {
    lifetime.current = { scope, controller: null };
    void load();
    return () => {
      if (lifetime.current?.scope === scope) {
        lifetime.current.controller?.abort();
        lifetime.current = null;
      }
    };
  }, [load, scope]);

  // Same chrome as `ips.tsx`: transparent native back + page title below it.
  const topPad = insets.top + Spacing.seven;
  const sidePad = {
    paddingLeft: Math.max(insets.left, Spacing.four),
    paddingRight: Math.max(insets.right, Spacing.four),
  };

  const header = (
    <View style={styles.headerStack}>
      <ScreenHeader title={t("games.title")} />
      <Pressable accessibilityRole="button" onPress={() => router.push(toHref("/text-games"))}>
        <ThemedText>{t("textGames.title")}</ThemedText>
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary">
        {t("games.subtitle")}
      </ThemedText>
      {warnings.map((warning, i) => (
        <ThemedText key={i} accessibilityRole="alert">
          {warning}
        </ThemedText>
      ))}
      {warnings.length > 0 && (
        <Pressable accessibilityRole="button" onPress={() => void load()}>
          <ThemedText>{t("common.retry")}</ThemedText>
        </Pressable>
      )}
    </View>
  );

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerTitle: "",
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: theme.text,
        }}
      />

      {loading ? (
        <View style={[styles.stateContainer, { paddingTop: topPad, ...sidePad }]}>
          {header}
          <View style={styles.skeletonWrap}>
            {[0, 1, 2].map((item) => (
              <View key={item} style={styles.skeletonCard}>
                <Skeleton width="100%" height={160} radius={10} />
                <Skeleton width="70%" height={16} />
                <Skeleton width="90%" height={12} />
              </View>
            ))}
          </View>
        </View>
      ) : error ? (
        <View style={[styles.stateContainer, { paddingTop: topPad, ...sidePad }]}>
          {header}
          <EmptyState
            title={t("games.errorTitle")}
            detail={error}
            symbol={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
            action={{ label: t("common.retry"), onPress: () => void load() }}
          />
        </View>
      ) : (
        <FlatList
          data={games}
          keyExtractor={(item) => `${item.kind}:${item.gameId}`}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="never"
          style={{ backgroundColor: theme.background }}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingTop: topPad,
              paddingBottom: insets.bottom + Spacing.seven,
              ...sidePad,
            },
            games.length === 0 && styles.listEmpty,
          ]}
          ListHeaderComponent={header}
          ListHeaderComponentStyle={styles.listHeader}
          ListEmptyComponent={
            warnings.length ? null : (
              <EmptyState title={t("games.emptyTitle")} detail={t("games.emptyDetail")} />
            )
          }
          ListFooterComponent={<ListFooter loading={false} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={theme.textSecondary}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                item.kind === "text"
                  ? router.push(toHref(`/play/text-game/${item.gameId}`))
                  : setSelectedFilm(item.film)
              }
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                pressed && styles.pressed,
              ]}
            >
              <PosterImage
                uri={item.coverUrl ?? undefined}
                label={item.title || t("textAdventures.library.untitled")}
                radius={10}
                style={styles.cover}
              />
              <View style={styles.copy}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t(item.kind === "text" ? "games.textLabel" : "games.filmLabel")}
                </ThemedText>
                <ThemedText type="smallBold" numberOfLines={2}>
                  {item.title || t("textAdventures.library.untitled")}
                </ThemedText>
                {item.subtitle ? (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
                    {item.subtitle}
                  </ThemedText>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}
      {selectedFilm && <FilmStore game={selectedFilm} close={() => setSelectedFilm(null)} />}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  stateContainer: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    gap: Spacing.five,
  },
  listContent: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  listHeader: {
    marginBottom: Spacing.four,
  },
  headerStack: {
    gap: Spacing.two,
  },
  listEmpty: {
    flexGrow: 1,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: Spacing.three,
  },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  copy: {
    padding: Spacing.three,
    gap: Spacing.one,
  },
  pressed: {
    opacity: 0.85,
  },
  skeletonWrap: {
    gap: Spacing.three,
  },
  skeletonCard: {
    gap: Spacing.two,
  },
});
