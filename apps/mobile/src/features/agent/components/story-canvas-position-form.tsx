import { canvasOverview } from "../lib/story-canvas-overview";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { uuid } from "expo-modules-core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasEditScope } from "../lib/story-canvas-draft";
import { openPlatformCanvasDocument } from "../api/platform-canvas-document";
import { canvasPositionRecovery } from "../lib/story-canvas-position-draft";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCanvasEncoder } from "./story-canvas-encoder";
export function StoryCanvasPositionForm({
  scope,
  loaded,
  userId,
  canEdit,
  close,
  saved,
}: {
  scope: CanvasEditScope;
  loaded: CanvasLoaded;
  userId: string;
  canEdit: boolean;
  close(): void;
  saved(): void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const nodes = useMemo(() => canvasOverview(loaded.snapshot).nodes, [loaded]);
  const recovery = useMemo(() => canvasPositionRecovery(scope, userId), [scope, userId]);
  const [initial] = useState(() => {
    try {
      return { draft: recovery.read() };
    } catch (cause) {
      return { error: String(cause) };
    }
  });
  const [draft, setDraft] = useState(initial.draft),
    [error, setError] = useState(initial.error);
  const [phase, setPhase] = useState<"idle" | "refresh" | "encode" | "save">("idle");
  const [fresh, setFresh] = useState<CanvasLoaded>();
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
  const submit = async () => {
    if (!current() || !canEdit) return;
    setPhase("save");
    try {
      await recovery.resume(life.current!.signal);
      if (current()) saved();
    } catch (cause) {
      failed(cause);
    }
  };
  const save = () => {
    if (!current() || !canEdit || busy.current || !draft || initial.error) return;
    busy.current = true;
    setError(undefined);
    if (draft.command) void submit();
    else setPhase("refresh");
  };
  const discard = () =>
    Alert.alert(t("storyCanvas.discard"), t("storyCanvas.discardBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("storyCanvas.discard"),
        style: "destructive",
        onPress: () => {
          if (!current() || !canEdit || busy.current) return;
          try {
            recovery.discard();
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
          gap: 12,
        }}
      >
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <ThemedText type="smallBold">
            {t(draft?.edit.groupId ? "storyCanvas.map.moveGroup" : "storyCanvas.map.movementTitle")}
          </ThemedText>
          <Pressable accessibilityRole="button" onPress={close} style={{ padding: 10 }}>
            <ThemedText type="small">{t("agent.close")}</ThemedText>
          </Pressable>
        </View>
        {error && (
          <ThemedText type="small" accessibilityRole="alert">
            {error}
          </ThemedText>
        )}
        <ScrollView style={{ flexGrow: 0, maxHeight: "50%" }} contentContainerStyle={{ gap: 8 }}>
          {draft?.edit.positions.map((position) => (
            <ThemedText key={position.nodeId} type="small">
              {nodes.find((node) => node.id === position.nodeId)?.title ?? position.nodeId}
              {"\n"}X: {Math.round(position.x)} / Y: {Math.round(position.y)}
            </ThemedText>
          ))}
        </ScrollView>
        {draft && (
          <ThemedText type="small">
            {t(draft.command ? "storyCanvas.pending" : "storyCanvas.draftSaved")}
          </ThemedText>
        )}
        {phase !== "idle" && <ActivityIndicator />}
        {canEdit && draft && (
          <View style={{ flexDirection: "row", gap: 16 }}>
            <Pressable
              accessibilityRole="button"
              disabled={phase !== "idle" || !!initial.error}
              onPress={save}
              style={{ paddingVertical: 10 }}
            >
              <ThemedText type="small">
                {t(draft.command ? "common.retry" : "storyCanvas.save")}
              </ThemedText>
            </Pressable>
            {!draft.command && (
              <Pressable
                accessibilityRole="button"
                disabled={phase !== "idle"}
                onPress={discard}
                style={{ paddingVertical: 10 }}
              >
                <ThemedText type="small">{t("storyCanvas.discard")}</ThemedText>
              </Pressable>
            )}
          </View>
        )}
        {phase === "refresh" && (
          <StoryCanvasReader
            scope={scope}
            platform={"kind" in scope ? { scope, load: openPlatformCanvasDocument } : undefined}
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onError={failed}
            onResult={(value) => {
              if (!current()) return;
              try {
                if (value.documentId !== scope.documentId) throw Error(t("storyCanvas.changed"));
                recovery.validate(value.snapshot);
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
              if (!current() || !canEdit) return;
              try {
                if (!update) {
                  recovery.discard();
                  saved();
                  return;
                }
                recovery.prepare({ clientKey: uuid.v4(), yjsUpdateBase64: update });
                setDraft(recovery.read());
                void submit();
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
