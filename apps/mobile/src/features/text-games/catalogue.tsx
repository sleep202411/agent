import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import type { TextGameSummary } from "@repo/shared/text-game";
import { useAuth } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { PosterImage } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { PublishedTextAdventure } from "@/features/browse/published-text-adventure";
import { listPublicTextGames } from "./api";

export function TextGameCatalogue({ active = true }: { active?: boolean }) {
  const auth = useAuth();
  const [selected, setSelected] = useState<string>();
  if (!active) return null;
  return selected ? (
    <PublishedAdventure key={selected} gameId={selected} onBack={() => setSelected(undefined)} />
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
  const t = useTranslations();
  return (
    <View style={{ flex: 1 }}>
      <Pressable accessibilityRole="button" onPress={onBack} style={{ padding: 16 }}>
        <ThemedText>{t("textGames.backToCatalogue")}</ThemedText>
      </Pressable>
      <PublishedTextAdventure gameId={gameId} />
    </View>
  );
}
