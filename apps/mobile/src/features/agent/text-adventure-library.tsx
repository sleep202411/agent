import { TextAdventurePlayer } from "./text-adventure-player";
import { TextAdventurePreview } from "./text-adventure-preview";
import { TextAdventureCreate } from "./text-adventure-create";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import type { TextGameSummary } from "@repo/shared/text-game";
import { ThemedText } from "@/components/themed-text";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { listTextAdventures, type TextAdventureSession } from "./api/text-adventure-api";
import { Action, TextAdventureEditor } from "./text-adventure-editor";
export function TextAdventureLibrary({ session }: { session: TextAdventureSession }) {
  const [identity] = useState(session),
    [selected, setSelected] = useState<string>(),
    [playing, setPlaying] = useState(false),
    [preview, setPreview] = useState<string>(),
    [revision, setRevision] = useState(0);
  if (preview)
    return (
      <TextAdventurePreview
        key={preview}
        gameId={preview}
        session={identity}
        onBack={() => setPreview(undefined)}
      />
    );
  if (selected && playing)
    return (
      <TextAdventurePlayer
        key={selected}
        gameId={selected}
        account={identity}
        onBack={() => setPlaying(false)}
      />
    );
  if (selected)
    return (
      <TextAdventureEditor
        gameId={selected}
        onPlay={() => setPlaying(true)}
        session={identity}
        onBack={() => {
          setSelected(undefined);
          setRevision((n) => n + 1);
        }}
      />
    );
  return (
    <Listing
      key={revision}
      session={identity}
      select={setSelected}
      preview={setPreview}
      refresh={() => setRevision((n) => n + 1)}
    />
  );
}
function Listing({
  session,
  select,
  refresh,
  preview,
}: {
  session: TextAdventureSession;
  select: (id: string) => void;
  refresh: () => void;
  preview: (id: string) => void;
}) {
  const t = useTranslations();
  const [rows, setRows] = useState<TextGameSummary[]>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void listTextAdventures(session, c.signal).then(
      (value) => {
        if (!c.signal.aborted) setRows(value);
      },
      (e) => {
        if (!c.signal.aborted && session.generation === getAuthGeneration())
          setError(String(e.message ?? e));
      }
    );
    return () => c.abort();
  }, [session]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <TextAdventureCreate session={session} onOpen={select} onRefresh={refresh} />
      {!rows && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {rows?.length === 0 && <ThemedText>{t("textAdventures.library.emptyTitle")}</ThemedText>}
      {rows?.map((row) => (
        <View key={row.gameId}>
          <Pressable
            accessibilityRole="button"
            style={{ paddingVertical: 12, gap: 6 }}
            onPress={() => {
              if (session.generation === getAuthGeneration()) select(row.gameId);
            }}
          >
            <ThemedText>{row.name || t("textAdventures.library.untitled")}</ThemedText>
            <ThemedText>{t(`textAdventures.status.${row.status}`)}</ThemedText>
            <ThemedText>{row.synopsis}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (session.generation === getAuthGeneration()) preview(row.gameId);
            }}
          >
            <ThemedText>{t("textAdventure.preview")}</ThemedText>
          </Pressable>
        </View>
      ))}
      <Action label="thread.refresh" onPress={refresh} />
    </ScrollView>
  );
}
