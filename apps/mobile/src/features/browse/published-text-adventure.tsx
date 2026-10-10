import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import type { TextGameDetail } from "@repo/shared/text-game";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { getPublishedTextGame } from "@/data/text-game-api";
import { ThemedText } from "@/components/themed-text";
import { PosterImage } from "@/components/ui";
import { useScreenActive } from "@/hooks/use-app-active";
import { textGameShareUrl } from "@/data/text-game-share";
import { ExperienceShareButton } from "@/features/experience-player/components/experience-share-button";
import { useTranslations, useLocale } from "@/i18n";
import { TextAdventureMedia } from "@/features/agent/text-adventure-media";
import { TextAdventurePlayer } from "@/features/agent/text-adventure-player";
import { Action } from "@/features/agent/text-adventure-editor";
export function PublishedTextAdventure({ gameId }: { gameId: string }) {
  const focused = useIsFocused();
  return focused ? <PublishedTextAdventureDetail key={gameId} gameId={gameId} /> : null;
}
function PublishedTextAdventureDetail({ gameId }: { gameId: string }) {
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useScreenActive(),
    t = useTranslations(),
    locale = useLocale();
  const [game, setGame] = useState<TextGameDetail>(),
    [error, setError] = useState<string>(),
    [revision, setRevision] = useState(0),
    [playGeneration, setPlayGeneration] = useState<number>();
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void getPublishedTextGame(gameId, c.signal).then(
      (value) => {
        if (!c.signal.aborted) setGame(value);
      },
      (e) => {
        if (!c.signal.aborted) setError(String(e.message ?? e));
      }
    );
    return () => c.abort();
  }, [gameId, revision]);
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  if (game && auth.status === "authenticated" && userId && playGeneration === auth.generation)
    return (
      <TextAdventurePlayer
        key={`${gameId}:${userId}:${auth.generation}`}
        gameId={gameId}
        account={{ userId, generation: auth.generation }}
        mode="public"
        backLabel="games.textBack"
        onBack={() => {
          setPlayGeneration(undefined);
          setGame(undefined);
          setError(undefined);
          setRevision((n) => n + 1);
        }}
      />
    );
  if (!active) return null;
  if (!game)
    return (
      <View style={{ padding: 16, gap: 12 }}>
        {error ? (
          <>
            <ThemedText accessibilityRole="alert">{error}</ThemedText>
            <Action
              label="common.retry"
              onPress={() => {
                setError(undefined);
                setRevision((n) => n + 1);
              }}
            />
          </>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <PosterImage
        uri={game.content.posterUrl ?? undefined}
        label={game.content.name ?? t("textAdventures.library.untitled")}
        radius={8}
        style={{ width: 120, height: 180 }}
      />
      <ThemedText type="smallBold">
        {game.content.name || t("textAdventures.library.untitled")}
      </ThemedText>
      <ThemedText>{game.content.synopsis}</ThemedText>
      <ExperienceShareButton
        label={t("play.share")}
        failedLabel={t("play.shareFailed")}
        shareUrl={textGameShareUrl(gameId, locale)}
      />
      <Action
        label="games.textPlay"
        disabled={auth.status === "hydrating" || !active}
        onPress={() =>
          gate.requireAuth({
            onAuthenticated: () => {
              if (alive.current) setPlayGeneration(getAuthGeneration());
            },
          })
        }
      />
      {game.content.characters.map((character) => (
        <View key={character.id} style={{ gap: 4 }}>
          <ThemedText type="smallBold">{character.name}</ThemedText>
          <ThemedText>{character.intro}</ThemedText>
        </View>
      ))}
      {active && (
        <TextAdventureMedia stillUrls={game.content.stillUrls} bgmUrl={game.content.bgmUrl} />
      )}
    </ScrollView>
  );
}
