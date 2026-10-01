import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput } from "react-native";
import type { TextGamePlaySession } from "@repo/shared/text-game";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useLocale, useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import type { TextAdventureSession } from "./api/text-adventure-api";
import {
  loadTextAdventurePreview,
  sendTextAdventurePreview,
} from "./api/text-adventure-preview-api";
export function TextAdventurePreview({
  gameId,
  session,
  onBack,
}: {
  gameId: string;
  session: TextAdventureSession;
  onBack: () => void;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [preview, setPreview] = useState<TextGamePlaySession>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const pending = useRef(false),
    controller = useRef(new AbortController());
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void loadTextAdventurePreview(gameId, locale, session, c.signal)
      .then(
        (value) => {
          if (!c.signal.aborted && session.generation === getAuthGeneration()) setPreview(value);
        },
        (e) => {
          if (!c.signal.aborted && session.generation === getAuthGeneration())
            setError(String(e.message ?? e));
        }
      )
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => c.abort();
  }, [gameId, locale, session]);
  async function send() {
    if (
      !preview ||
      pending.current ||
      !message.trim() ||
      controller.current.signal.aborted ||
      session.generation !== getAuthGeneration()
    )
      return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await sendTextAdventurePreview(
        preview,
        message,
        locale,
        session,
        controller.current.signal
      );
      if (!controller.current.signal.aborted && session.generation === getAuthGeneration()) {
        setPreview(result);
        setMessage("");
      }
    } catch (e) {
      if (!controller.current.signal.aborted && session.generation === getAuthGeneration())
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = false;
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Pressable accessibilityRole="button" onPress={onBack}>
        <ThemedText>{t("textAdventure.back")}</ThemedText>
      </Pressable>
      {busy && <ActivityIndicator />}
      {error ? (
        <ThemedText accessibilityRole="alert">
          {error} {t("textAdventure.uncertain")}
        </ThemedText>
      ) : null}
      {preview?.messages.map((row) => (
        <ThemedText key={row.id}>{row.content}</ThemedText>
      ))}
      <TextInput
        accessibilityLabel={t("textAdventure.message")}
        value={message}
        onChangeText={setMessage}
        editable={!busy && !error}
        multiline
        style={{ color: theme.text, borderColor: theme.textSecondary, borderWidth: 1, padding: 12 }}
      />
      <Pressable
        accessibilityRole="button"
        disabled={busy || !!error || !preview || !message.trim()}
        onPress={() => void send()}
      >
        <ThemedText>{t("textAdventure.send")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
