import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import type { TextGameSummary, TextGameDetail } from "@repo/shared/text-game";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { PosterImage } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { TextAdventurePlayer } from "@/features/agent/text-adventure-player";
import { listPublicTextGames, getPublicTextGame } from "./api";

export function TextGameCatalogue({ active = true }: { active?: boolean }) {
  const auth = useAuth();
  const [selected, setSelected] = useState<string>();
  if (!active) return null;
  return selected ? (
    <PublishedAdventure
      key={`${selected}:${auth.generation}`}
      gameId={selected}
      onBack={() => setSelected(undefined)}
    />
  ) : (
    <CatalogueList key={auth.generation} onSelect={setSelected} />
  );
}
function CatalogueList({ onSelect }: { onSelect: (id: string) => void }) {
  const t = useTranslations(),
    theme = useTheme();
  const [rows, setRows] = useState<TextGameSummary[]>(),
    [error, setError] = useState<string>(),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    void listPublicTextGames(c.signal).then(
      (value) => {
        if (!c.signal.aborted) setRows(value);
      },
      (e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => c.abort();
  }, [revision]);
  const refresh = () => {
    setRows(undefined);
    setError(undefined);
    setRevision((n) => n + 1);
  };
  return (
    <FlatList
      data={rows ?? []}
      keyExtractor={(row) => row.gameId}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <ThemedText>{t("textGames.subtitle")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={refresh}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
          {error ? (
            <ThemedText accessibilityRole="alert">{error}</ThemedText>
          ) : !rows ? (
            <ActivityIndicator />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        rows?.length === 0 ? <ThemedText>{t("textGames.empty")}</ThemedText> : null
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => onSelect(item.gameId)}
          style={{ backgroundColor: theme.backgroundElement, borderRadius: 8, overflow: "hidden" }}
        >
          <PosterImage
            uri={item.posterUrl ?? undefined}
            label={item.name ?? t("textAdventures.library.untitled")}
            radius={8}
            style={{ width: "100%", aspectRatio: 16 / 9 }}
          />
          <View style={{ padding: 12, gap: 6 }}>
            <ThemedText type="smallBold">
              {item.name ?? t("textAdventures.library.untitled")}
            </ThemedText>
            {item.synopsis ? <ThemedText numberOfLines={3}>{item.synopsis}</ThemedText> : null}
          </View>
        </Pressable>
      )}
    />
  );
}
function PublishedAdventure({ gameId, onBack }: { gameId: string; onBack: () => void }) {
  const auth = useAuth(),
    gate = useAuthGate(),
    t = useTranslations();
  const [detail, setDetail] = useState<TextGameDetail>(),
    [error, setError] = useState<string>(),
    [playing, setPlaying] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    void getPublicTextGame(gameId, c.signal).then(
      (value) => {
        if (!c.signal.aborted) setDetail(value);
      },
      (e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => c.abort();
  }, [gameId, revision]);
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  if (playing && auth.status === "authenticated" && userId)
    return (
      <TextAdventurePlayer
        gameId={gameId}
        account={{ userId, generation: auth.generation }}
        onBack={() => {
          setPlaying(false);
          setDetail(undefined);
          setRevision((n) => n + 1);
        }}
        backLabel="textGames.backToDetails"
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Pressable accessibilityRole="button" onPress={onBack}>
        <ThemedText>{t("textGames.backToCatalogue")}</ThemedText>
      </Pressable>
      {error ? (
        <View style={{ gap: 12 }}>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setDetail(undefined);
              setError(undefined);
              setRevision((n) => n + 1);
            }}
          >
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </View>
      ) : !detail ? (
        <ActivityIndicator />
      ) : (
        <>
          <PosterImage
            uri={detail.content.posterUrl ?? undefined}
            label={detail.content.name ?? t("textAdventures.library.untitled")}
            radius={8}
            style={{ width: "100%", aspectRatio: 16 / 9 }}
          />
          <ThemedText type="smallBold">
            {detail.content.name ?? t("textAdventures.library.untitled")}
          </ThemedText>
          {detail.content.synopsis ? <ThemedText>{detail.content.synopsis}</ThemedText> : null}
          <Pressable
            accessibilityRole="button"
            disabled={auth.status === "hydrating"}
            onPress={() => {
              if (gate.requireAuth()) setPlaying(true);
            }}
          >
            <ThemedText>{t("textGames.play")}</ThemedText>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}
