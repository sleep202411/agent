import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasNodeEdit } from "../../../../canvas-editor/schema";
import { canvasDraftStore, canvasEditBaseline, type CanvasDraft } from "../lib/story-canvas-draft";
import {
  canvasUpdatePending,
  type CanvasWriteScope,
  type CanvasUpdateCommand,
} from "../api/story-canvas-update";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCanvasEncoder } from "./story-canvas-encoder";

export function StoryCanvasEditForm({
  scope,
  userId,
  loaded,
  edit,
  close,
  saved,
}: {
  scope: CanvasWriteScope;
  userId: string;
  loaded: CanvasLoaded;
  edit: Pick<CanvasNodeEdit, "nodeId" | "kind">;
  close(): void;
  saved(): void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const store = useMemo(() => canvasDraftStore(scope, userId), [scope, userId]);
  const client = useMemo(() => canvasUpdatePending(scope, userId), [scope, userId]);
  const [initial] = useState(() => {
    try {
      const draft = store.read();
      if (draft) return { draft, resumed: true };
      const baseline = canvasEditBaseline(loaded.snapshot, edit);
      return {
        draft: { ...baseline, edit: { ...edit, value: baseline.baseValue } } as CanvasDraft,
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const [draft, setDraft] = useState(initial.draft),
    [error, setError] = useState(initial.error);
  const [phase, setPhase] = useState<"idle" | "refresh" | "encode" | "save">("idle");
  const [fresh, setFresh] = useState<CanvasLoaded>();
  const target = draft
    ? (loaded.snapshot.nodes[draft.edit.nodeId] as { data?: Record<string, unknown> } | undefined)
    : undefined;
  const targetName = [target?.data?.name, target?.data?.label, draft?.edit.nodeId].find(
    (value): value is string => typeof value === "string" && !!value
  );
  const life = useRef<AbortController | null>(null),
    busy = useRef(false);
  useLayoutEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    return () => controller.abort();
  }, []);
  const current = () =>
    !!life.current && !life.current.signal.aborted && getAuthGeneration() === scope.generation;
  const failed = (cause: unknown) => {
    if (!current()) return;
    busy.current = false;
    setPhase("idle");
    setError(cause instanceof Error ? cause.message : String(cause));
  };
  const submit = async (command: CanvasUpdateCommand) => {
    if (!current()) return;
    setPhase("save");
    try {
      await client.submit(command, life.current!.signal);
      if (!current()) return;
      store.write(null);
      saved();
    } catch (cause) {
      failed(cause);
    }
  };
  const save = () => {
    if (!current() || !draft || busy.current) return;
    busy.current = true;
    setError(undefined);
    try {
      store.write(draft);
      const pending = client.read();
      if (
        pending &&
        (!draft.command ||
          pending.clientKey !== draft.command.clientKey ||
          pending.yjsUpdateBase64 !== draft.command.yjsUpdateBase64)
      )
        throw Error(t("storyCanvas.pendingMismatch"));
      if (draft.command) void submit(draft.command);
      else setPhase("refresh");
    } catch (cause) {
      failed(cause);
    }
  };
  const discard = () =>
    Alert.alert(t("storyCanvas.discard"), t("storyCanvas.discardBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("storyCanvas.discard"),
        style: "destructive",
        onPress: () => {
          if (!current() || busy.current || draft?.command) return;
          try {
            if (client.read()) throw Error(t("storyCanvas.pendingMismatch"));
            store.write(null);
            saved();
          } catch (cause) {
            failed(cause);
          }
        },
      },
    ]);
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          padding: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          gap: 16,
        }}
      >
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <ThemedText type="smallBold">
            {t(draft?.edit.kind === "prompt" ? "storyCanvas.editPrompt" : "storyCanvas.rename")}
          </ThemedText>
          <Pressable accessibilityRole="button" onPress={close} style={{ padding: 12 }}>
            <ThemedText type="small">{t("agent.close")}</ThemedText>
          </Pressable>
        </View>
        {draft && (
          <>
            {targetName && <ThemedText type="smallBold">{targetName}</ThemedText>}
            {initial.resumed && (
              <ThemedText type="small">{t("storyCanvas.resumeDraft")}</ThemedText>
            )}
            <ThemedText type="small">
              {t(draft.command ? "storyCanvas.pending" : "storyCanvas.draftSaved")}
            </ThemedText>
            <TextInput
              accessibilityLabel={t(
                draft.edit.kind === "prompt" ? "storyCanvas.editPrompt" : "storyCanvas.rename"
              )}
              multiline={draft.edit.kind === "prompt"}
              editable={phase === "idle" && !draft.command}
              value={draft.edit.value}
              onChangeText={(value) => {
                if (!current() || busy.current || draft.command) return;
                const next = { ...draft, edit: { ...draft.edit, value } };
                setDraft(next);
                try {
                  store.write(next);
                  setError(undefined);
                } catch (cause) {
                  failed(cause);
                }
              }}
              style={{
                color: theme.text,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 8,
                padding: 12,
                minHeight: draft.edit.kind === "prompt" ? 150 : 48,
                textAlignVertical: "top",
              }}
            />
            {phase !== "idle" ? (
              <ActivityIndicator />
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={save}
                style={{ padding: 12, borderRadius: 8, backgroundColor: theme.brand }}
              >
                <ThemedText type="smallBold">
                  {t(draft.command ? "common.retry" : "storyCanvas.save")}
                </ThemedText>
              </Pressable>
            )}
            {!draft.command && phase === "idle" && (
              <Pressable
                accessibilityRole="button"
                onPress={discard}
                style={{ paddingVertical: 12 }}
              >
                <ThemedText type="small">{t("storyCanvas.discard")}</ThemedText>
              </Pressable>
            )}
          </>
        )}
        {error && (
          <ThemedText type="small" accessibilityRole="alert">
            {error}
          </ThemedText>
        )}
        {phase === "refresh" && draft && (
          <StoryCanvasReader
            scope={scope}
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onError={failed}
            onResult={(value) => {
              if (!current()) return;
              try {
                if (value.documentId !== scope.documentId) throw Error(t("storyCanvas.changed"));
                const baseline = canvasEditBaseline(value.snapshot, draft.edit);
                if (baseline.nodeType !== draft.nodeType || baseline.baseValue !== draft.baseValue)
                  throw Error(t("storyCanvas.changed"));
                setFresh(value);
                setPhase("encode");
              } catch (cause) {
                failed(cause);
              }
            }}
          />
        )}
        {phase === "encode" && fresh && draft && (
          <StoryCanvasEncoder
            loaded={fresh}
            edit={draft.edit}
            generation={scope.generation}
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onError={failed}
            onResult={(update) => {
              if (!current()) return;
              try {
                if (!update) {
                  store.write(null);
                  saved();
                  return;
                }
                const command = { clientKey: uuid.v4(), yjsUpdateBase64: update };
                const next = { ...draft, command };
                store.write(next);
                setDraft(next);
                void submit(command);
              } catch (cause) {
                failed(cause);
              }
            }}
          />
        )}
      </View>
    </Modal>
  );
}
