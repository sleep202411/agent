import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { createCrewFilm, loadCrewFilms } from "./crew-film-api";

export function CrewFilmPicker({
  crewId,
  generation,
  disabled,
  onSelect,
}: {
  crewId: string;
  generation: number;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    router = useRouter();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadCrewFilms>>>();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [created, setCreated] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  async function run(create = false) {
    if (
      disabled ||
      request.current ||
      generation !== getAuthGeneration() ||
      (create && (attempted || !data?.workspaceId || !title.trim()))
    )
      return;
    const c = new AbortController();
    request.current = c;
    setBusy(true);
    setError(undefined);
    try {
      if (create) {
        setAttempted(true);
        const film = await createCrewFilm(crewId, data!.workspaceId!, title, generation, c.signal);
        if (c.signal.aborted || generation !== getAuthGeneration()) return;
        setCreated(film.id);
        setTitle("");
        onSelect(film.id);
      } else {
        const next = await loadCrewFilms(crewId, generation, c.signal);
        if (c.signal.aborted || generation !== getAuthGeneration()) return;
        setData(next);
      }
    } catch (cause) {
      if (!c.signal.aborted && generation === getAuthGeneration())
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request.current === c) request.current = undefined;
      if (!c.signal.aborted && generation === getAuthGeneration()) setBusy(false);
    }
  }
  const blocked = disabled || busy || generation !== getAuthGeneration();
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        disabled={blocked}
        onPress={() => void run()}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("canvasImport.chooseFilm")}</ThemedText>
      </Pressable>
      {busy && <ActivityIndicator />}
      {data?.projects.map((film) => (
        <Pressable
          key={film.id}
          accessibilityRole="button"
          disabled={blocked}
          onPress={() => onSelect(film.id)}
          style={{ padding: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 8 }}
        >
          <ThemedText>{film.title}</ThemedText>
        </Pressable>
      ))}
      {data && !data.workspaceId && <ThemedText>{t("canvasImport.linkWorkspace")}</ThemedText>}
      {data?.workspaceId && !attempted && (
        <>
          <TextInput
            accessibilityLabel={t("canvasImport.filmTitle")}
            placeholder={t("canvasImport.filmTitle")}
            value={title}
            maxLength={180}
            editable={!blocked}
            onChangeText={setTitle}
            placeholderTextColor={theme.textSecondary}
            style={{
              padding: 12,
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 8,
            }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={blocked || !title.trim()}
            onPress={() => void run(true)}
            style={{ padding: 12 }}
          >
            <ThemedText>{t("canvasImport.createFilm")}</ThemedText>
          </Pressable>
        </>
      )}
      {created && (
        <Pressable
          accessibilityRole="button"
          disabled={blocked}
          onPress={() =>
            router.push({ pathname: "/agent/[projectId]", params: { projectId: created } })
          }
          style={{ padding: 12 }}
        >
          <ThemedText>{t("canvasImport.openFilm")}</ThemedText>
        </Pressable>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {error && attempted && <ThemedText>{t("canvasImport.checkCreation")}</ThemedText>}
    </View>
  );
}
