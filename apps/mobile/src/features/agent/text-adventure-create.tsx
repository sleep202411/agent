import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import type { TextAdventureSession } from "./api/text-adventure-api";
import { textAdventureCreation, type TextCreationRecord } from "./text-adventure-creation";
import { Action } from "./text-adventure-editor";
export function TextAdventureCreate({
  session,
  onOpen,
  onRefresh,
}: {
  session: TextAdventureSession;
  onOpen: (id: string) => void;
  onRefresh: () => void;
}) {
  const t = useTranslations();
  const [workflow] = useState(() => textAdventureCreation(session));
  const [initial] = useState(() => {
    try {
      return { record: workflow.read(), error: undefined };
    } catch (e) {
      return { record: null, error: String(e instanceof Error ? e.message : e) };
    }
  });
  const [record, setRecord] = useState<TextCreationRecord | null>(initial.record),
    [error, setError] = useState(initial.error),
    [busy, setBusy] = useState(false),
    [discardConfirm, setDiscardConfirm] = useState(false);
  const lock = useRef(false),
    abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    abort.current = c;
    return () => c.abort();
  }, []);
  const run = async (action: (signal: AbortSignal) => Promise<unknown>) => {
    const c = abort.current;
    if (!c || c.signal.aborted || lock.current || session.generation !== getAuthGeneration())
      return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action(c.signal);
    } catch (e) {
      if (!c.signal.aborted && session.generation === getAuthGeneration())
        setError(String(e instanceof Error ? e.message : e));
    } finally {
      lock.current = false;
      if (!c.signal.aborted && session.generation === getAuthGeneration()) {
        try {
          setRecord(workflow.read());
        } catch (e) {
          setError(String(e));
        }
        setBusy(false);
      }
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <ThemedText>{t("textAdventures.create.body")}</ThemedText>
      <ThemedText>{t("textAdventures.create.privacy")}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {record && <ThemedText>{record.name}</ThemedText>}
      {!record && (
        <Action
          label="textAdventures.library.uploadFirst"
          disabled={busy || !!initial.error}
          onPress={() => void run((signal) => workflow.select(signal))}
        />
      )}
      {record?.phase === "ready" && (
        <Action
          label="textAdventures.library.create"
          disabled={busy}
          onPress={() =>
            void run(async (signal) => {
              const result = await workflow.create(record.id, signal);
              if (result.gameId) onOpen(result.gameId);
            })
          }
        />
      )}
      {record?.phase === "creating" && (
        <>
          <ThemedText>{t("textAdventures.mobile.creationUnknown")}</ThemedText>
          <Action
            label="textAdventures.mobile.checkCreation"
            disabled={busy}
            onPress={() =>
              void run(async (signal) => {
                const result = await workflow.recover(record.id, signal);
                if (result.gameId) onOpen(result.gameId);
                else setError(t("textAdventures.mobile.notFoundYet"));
              })
            }
          />
        </>
      )}
      {record?.phase === "created" && (
        <Action
          label="textAdventures.editor.edit"
          disabled={busy}
          onPress={() => {
            if (session.generation === getAuthGeneration() && record.gameId) onOpen(record.gameId);
          }}
        />
      )}
      {record && (
        <Action
          label="textAdventures.mobile.clearCreation"
          disabled={busy}
          onPress={() => setDiscardConfirm(true)}
        />
      )}
      {discardConfirm && record && (
        <>
          <ThemedText>
            {t(
              record.phase === "creating"
                ? "textAdventures.mobile.discardUnknown"
                : "textAdventures.mobile.discardCreation"
            )}
          </ThemedText>
          <Action
            label="textAdventures.mobile.clearCreation"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await workflow.discard(record.id, true);
                setDiscardConfirm(false);
                onRefresh();
              })
            }
          />
          <Action
            label="textAdventures.actions.cancel"
            disabled={busy}
            onPress={() => setDiscardConfirm(false)}
          />
        </>
      )}
      {busy && <ActivityIndicator />}
    </View>
  );
}
