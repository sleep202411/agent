import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, TextInput, View } from "react-native";
import type { TextGamePlaySession } from "@repo/shared/text-game";
import { ThemedText } from "@/components/themed-text";
import { getAuthGeneration } from "@/auth/auth-store";
import { useLocale, useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import type { TextAdventureSession } from "./api/text-adventure-api";
import { TextAdventureMedia } from "./text-adventure-media";
import { Action } from "./text-adventure-editor";
import { textAdventurePlayWorkflow, type PendingTextPlay } from "./text-adventure-play-workflow";
export function TextAdventurePlayer({
  gameId,
  account,
  onBack,
}: {
  gameId: string;
  account: TextAdventureSession;
  onBack: () => void;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [workflow] = useState(() => textAdventurePlayWorkflow(gameId, account));
  const [session, setSession] = useState<TextGamePlaySession | null>(null),
    [pending, setPending] = useState<PendingTextPlay | null>(null),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(true),
    [loaded, setLoaded] = useState(false),
    [action, setAction] = useState(""),
    [confirm, setConfirm] = useState<"restart" | "clear">();
  const abort = useRef<AbortController | null>(null),
    running = useRef(false);
  const current = () =>
    account.generation === getAuthGeneration() && !!abort.current && !abort.current.signal.aborted;
  useEffect(() => {
    const c = new AbortController();
    abort.current = c;
    void workflow
      .refresh(c.signal)
      .then(
        (result) => {
          if (c.signal.aborted || account.generation !== getAuthGeneration()) return;
          setSession(result.session);
          setPending(result.pending);
          setLoaded(true);
        },
        (e) => {
          if (!c.signal.aborted && account.generation === getAuthGeneration())
            setError(String(e.message ?? e));
        }
      )
      .finally(() => {
        if (!c.signal.aborted && account.generation === getAuthGeneration()) setBusy(false);
      });
    return () => c.abort();
  }, [workflow, account.generation]);
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (!current() || running.current || busy || !abort.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work(abort.current.signal);
    } catch (e) {
      if (current()) {
        setError(String(e instanceof Error ? e.message : e));
        setLoaded(false);
      }
    } finally {
      running.current = false;
      if (current()) {
        try {
          setPending(workflow.read());
        } catch (e) {
          setError(String(e));
          setLoaded(false);
        }
        setBusy(false);
      }
    }
  };
  const refresh = async (signal: AbortSignal) => {
    const result = await workflow.refresh(signal);
    if (current()) {
      setSession(result.session);
      setPending(result.pending);
      setLoaded(true);
    }
  };
  const update = (next: TextGamePlaySession) => {
    if (current()) setSession(next);
  };
  const start = () =>
    run(async (signal) => {
      setConfirm(undefined);
      const result = await workflow.start(session?.sessionId ?? null, locale, signal, update);
      if (current()) {
        setSession(result);
        setAction("");
        setLoaded(true);
      }
    });
  const send = () =>
    run(async (signal) => {
      if (!session || pending || !loaded) return;
      const result = await workflow.send(session, action, locale, signal, update);
      if (current()) {
        setSession(result);
        setAction("");
        setLoaded(true);
      }
    });
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>{t("textAdventures.playtest.title")}</ThemedText>
      <ThemedText>{t("textAdventures.playtest.draftNotice")}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {pending && (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("textAdventures.mobile.playUnknown")}</ThemedText>
          {pending.kind === "action" && <ThemedText>{pending.message}</ThemedText>}
          <Action
            label="textAdventures.mobile.clearPlay"
            disabled={busy || !!confirm}
            onPress={() => setConfirm("clear")}
          />
        </View>
      )}
      {session && (
        <TextAdventureMedia
          key={session.sessionId}
          stillUrls={session.stillUrls}
          bgmUrl={session.bgmUrl}
        />
      )}
      {session?.messages
        .filter((m) => m.role !== "system")
        .map((message) => (
          <View
            key={message.id}
            style={{
              padding: 12,
              borderRadius: 8,
              backgroundColor: theme.backgroundElement,
              gap: 6,
            }}
          >
            {message.role === "user" && (
              <ThemedText>{t("textAdventures.playtest.yourAction")}</ThemedText>
            )}
            <ThemedText selectable>{message.content}</ThemedText>
          </View>
        ))}
      {busy && <ActivityIndicator />}
      {session && (
        <>
          <TextInput
            multiline
            accessibilityLabel={t("textAdventures.playtest.actionPlaceholder")}
            placeholder={t("textAdventures.playtest.actionPlaceholder")}
            placeholderTextColor={theme.textSecondary}
            value={action}
            onChangeText={setAction}
            editable={loaded && !busy && !pending && !confirm}
            style={{
              color: theme.text,
              padding: 12,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 8,
            }}
          />
          <Action
            label="textAdventures.playtest.send"
            disabled={
              !loaded ||
              busy ||
              !!pending ||
              !!confirm ||
              !action.trim() ||
              session.messages.at(-1)?.role !== "assistant"
            }
            onPress={() => void send()}
          />
        </>
      )}
      {!session && loaded && !pending && (
        <Action
          label="textAdventures.playtest.newSession"
          disabled={busy}
          onPress={() => void start()}
        />
      )}
      {session && (
        <Action
          label="textAdventures.playtest.restart"
          disabled={!loaded || busy || !!pending || !!confirm}
          onPress={() => setConfirm("restart")}
        />
      )}
      {confirm && (
        <View style={{ gap: 8 }}>
          <ThemedText>
            {t(
              confirm === "restart"
                ? "textAdventures.playtest.restartBody"
                : "textAdventures.mobile.clearPlayWarning"
            )}
          </ThemedText>
          <Action
            label={
              confirm === "restart"
                ? "textAdventures.playtest.restartConfirm"
                : "textAdventures.mobile.clearPlay"
            }
            disabled={busy}
            onPress={() => {
              if (confirm === "restart") void start();
              else if (pending)
                void run(async (signal) => {
                  await workflow.clearUnknown(pending.id);
                  if (current()) {
                    setConfirm(undefined);
                    await refresh(signal);
                  }
                });
            }}
          />
          <Action
            label="textAdventures.actions.cancel"
            disabled={busy}
            onPress={() => setConfirm(undefined)}
          />
        </View>
      )}
      <Action
        label="thread.refresh"
        disabled={busy || !!confirm}
        onPress={() => void run(refresh)}
      />
      <Action label="textAdventures.mobile.backToEditor" onPress={onBack} />
    </ScrollView>
  );
}
