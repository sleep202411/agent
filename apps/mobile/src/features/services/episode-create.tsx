import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { createEpisode, episodeCreateInput, fetchEpisodeCreateAccess } from "./episode-create-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function EpisodeCreate(props: Props) {
  const active = useScreenActive();
  if (!active || props.generation !== getAuthGeneration()) return null;
  return <Access key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />;
}
function Access(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    revision: number;
    allowed?: boolean;
    error?: string;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchEpisodeCreateAccess(props.crewId, props.userId, controller.signal).then(
      (allowed) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ revision, allowed });
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [props.crewId, props.userId, props.generation, revision]);
  const visible = snapshot?.revision === revision ? snapshot : undefined;
  if (visible?.allowed) return <Editor {...props} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {!visible && <ActivityIndicator />}
      {visible?.allowed === false && <ThemedText>{t("episodeCreate.denied")}</ThemedText>}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (props.generation === getAuthGeneration()) setRevision((n) => n + 1);
        }}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={props.onClose}>
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
function Editor({ crewId, userId, generation, onClose }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(crewId, true);
  const [title, setTitle] = useState(""),
    [synopsis, setSynopsis] = useState(""),
    [number, setNumber] = useState("");
  const [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>(),
    [result, setResult] = useState<Awaited<ReturnType<typeof createEpisode>>>();
  const sent = useRef(false);
  const locked = attempted || op.busy;
  const parsed = episodeCreateInput.safeParse({
    title,
    synopsis,
    ...(number.trim() ? { number: /^\d+$/.test(number.trim()) ? Number(number.trim()) : NaN } : {}),
  });
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>{t("episodeCreate.title")}</ThemedText>
      <ThemedText>{t("episodeCreate.help")}</ThemedText>
      <TextInput
        accessibilityLabel={t("episodeCreate.name")}
        placeholder={t("episodeCreate.name")}
        value={title}
        onChangeText={setTitle}
        editable={!locked}
        maxLength={180}
        style={{ color: theme.text, padding: 12 }}
      />
      <TextInput
        accessibilityLabel={t("episodeCreate.number")}
        placeholder={t("episodeCreate.number")}
        value={number}
        onChangeText={setNumber}
        editable={!locked}
        keyboardType="number-pad"
        maxLength={6}
        style={{ color: theme.text, padding: 12 }}
      />
      <TextInput
        accessibilityLabel={t("episodeCreate.synopsis")}
        placeholder={t("episodeCreate.synopsis")}
        value={synopsis}
        onChangeText={setSynopsis}
        editable={!locked}
        multiline
        maxLength={20000}
        style={{ color: theme.text, padding: 12, minHeight: 100 }}
      />
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <ThemedText>{t("episodeCreate.uncertain")}</ThemedText>
        </>
      )}
      {result && (
        <ThemedText>
          {t("episodeCreate.created")} · {result.number} · {result.title}
        </ThemedText>
      )}
      {!result && (
        <Pressable
          accessibilityRole="button"
          disabled={locked || !parsed.success}
          style={{ padding: 12 }}
          onPress={() => {
            if (sent.current || generation !== getAuthGeneration() || !parsed.success) return;
            void op.run(
              () => {
                sent.current = true;
                setAttempted(true);
                return createEpisode(crewId, userId, generation, parsed.data);
              },
              setResult,
              (cause) => setError(cause instanceof Error ? cause.message : String(cause))
            );
          }}
        >
          <ThemedText>{t(op.busy ? "episodeCreate.creating" : "episodeCreate.confirm")}</ThemedText>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        style={{ padding: 12 }}
        onPress={onClose}
      >
        <ThemedText>{t("crewTasks.back")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
