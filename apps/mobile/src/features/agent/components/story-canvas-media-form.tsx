import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { ConversationVideo } from "@/features/services/conversation-video";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasShotMedia } from "../../../../canvas-editor/shot-media-schema";
import {
  canvasMediaBaseline,
  canvasMediaDraftStore,
  type CanvasMediaDraft,
} from "../lib/story-canvas-media-draft";
import { canvasMediaView, type CanvasMediaItem } from "../lib/story-canvas-media-view";
import {
  canvasUpdatePending,
  type CanvasWriteScope,
  type CanvasUpdateCommand,
} from "../api/story-canvas-update";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCanvasEncoder } from "./story-canvas-encoder";

export function StoryCanvasMediaForm({
  scope,
  userId,
  loaded,
  nodeId,
  canEdit,
  close,
  saved,
}: {
  scope: CanvasWriteScope;
  userId: string;
  loaded: CanvasLoaded;
  nodeId: string;
  canEdit: boolean;
  close(): void;
  saved(): void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const store = useMemo(() => canvasMediaDraftStore(scope, userId), [scope, userId]);
  const client = useMemo(() => canvasUpdatePending(scope, userId), [scope, userId]);
  const [initial] = useState(() => {
    try {
      return { draft: store.read() };
    } catch (cause) {
      return { error: String(cause) };
    }
  });
  const [draft, setDraft] = useState<CanvasMediaDraft | null>(initial.draft ?? null),
    [error, setError] = useState(initial.error);
  const [phase, setPhase] = useState<"idle" | "refresh" | "encode" | "save">("idle"),
    [fresh, setFresh] = useState<CanvasLoaded>();
  const [preview, setPreview] = useState<CanvasMediaItem>(),
    [previewError, setPreviewError] = useState(false);
  const view = useMemo(() => {
    try {
      return { data: canvasMediaView(loaded.snapshot, nodeId) };
    } catch (cause) {
      return { error: String(cause) };
    }
  }, [loaded, nodeId]);
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
  const choose = (edit: CanvasShotMedia) => {
    if (!current() || !canEdit || busy.current || draft || initial.error) return;
    try {
      const selected =
        edit.action === "attach"
          ? view.data?.sources.find((item) => item.sourceId === edit.sourceId)?.name
          : view.data?.attached.find((item) => item.edgeId === edit.edgeId)?.name;
      const next = {
        edit,
        title: `${view.data?.title ?? nodeId} · ${selected ?? t("storyCanvas.media.automatic")}`,
        baseline: canvasMediaBaseline(loaded.snapshot, edit),
      };
      store.write(next);
      setDraft(next);
      setError(undefined);
    } catch (cause) {
      failed(cause);
    }
  };
  const submit = async (command: CanvasUpdateCommand) => {
    if (!current() || !canEdit) return;
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
    if (!current() || !canEdit || !draft || busy.current) return;
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
  const confirmSave = () => {
    if (draft?.edit.action !== "detach" || draft.command) return save();
    Alert.alert(t("storyCanvas.media.detach"), t("storyCanvas.media.detachBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("storyCanvas.media.detach"), style: "destructive", onPress: save },
    ]);
  };
  const discard = () =>
    Alert.alert(t("storyCanvas.discard"), t("storyCanvas.discardBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("storyCanvas.discard"),
        style: "destructive",
        onPress: () => {
          if (!current() || !canEdit || busy.current || draft?.command) return;
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
          gap: 12,
        }}
      >
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <ThemedText type="smallBold">{t("storyCanvas.media.title")}</ThemedText>
          {<MediaAction label={t("agent.close")} onPress={close} />}
        </View>
        <ThemedText type="smallBold">{draft?.title ?? view.data?.title ?? nodeId}</ThemedText>
        {!!error && (
          <ThemedText type="small" accessibilityRole="alert">
            {error}
          </ThemedText>
        )}
        {draft ? (
          <>
            <ThemedText type="small">{t(`storyCanvas.media.${draft.edit.action}`)}</ThemedText>
            <ThemedText type="small">
              {t(draft.command ? "storyCanvas.pending" : "storyCanvas.draftSaved")}
            </ThemedText>
            {phase !== "idle" ? (
              <ActivityIndicator />
            ) : (
              canEdit && (
                <MediaAction
                  label={t(draft.command ? "common.retry" : "storyCanvas.save")}
                  onPress={confirmSave}
                />
              )
            )}
            {canEdit && !draft.command && phase === "idle" && (
              <MediaAction label={t("storyCanvas.discard")} onPress={discard} />
            )}
          </>
        ) : (
          <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
            {view.error && <ThemedText accessibilityRole="alert">{view.error}</ThemedText>}
            <ThemedText type="smallBold">{t("storyCanvas.media.attached")}</ThemedText>
            {view.data?.attached.length === 0 && (
              <ThemedText type="small">{t("storyCanvas.empty")}</ThemedText>
            )}
            {view.data?.attached.map((item) => (
              <CanvasMediaRow
                key={item.key}
                item={item}
                attached
                canEdit={canEdit && !initial.error}
                nodeId={nodeId}
                onChoose={choose}
                onPreview={(item) => {
                  setPreviewError(false);
                  setPreview(item);
                }}
              />
            ))}
            {canEdit && view.data?.explicitPreferred && (
              <MediaAction
                label={t("storyCanvas.media.automatic")}
                onPress={() => choose({ action: "prefer", nodeId })}
              />
            )}
            {canEdit && (
              <>
                <ThemedText type="smallBold">{t("storyCanvas.media.sources")}</ThemedText>
                {view.data?.sources.length === 0 && (
                  <ThemedText type="small">{t("storyCanvas.empty")}</ThemedText>
                )}
                {view.data?.sources.map((item) => (
                  <CanvasMediaRow
                    key={item.key}
                    item={item}
                    attached={false}
                    available={item.available}
                    canEdit={canEdit && !initial.error}
                    nodeId={nodeId}
                    onChoose={choose}
                    onPreview={(item) => {
                      setPreviewError(false);
                      setPreview(item);
                    }}
                  />
                ))}
              </>
            )}
          </ScrollView>
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
                if (
                  value.documentId !== scope.documentId ||
                  canvasMediaBaseline(value.snapshot, draft.edit) !== draft.baseline
                )
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
        {preview?.url && (
          <Modal visible animationType="fade" onRequestClose={() => setPreview(undefined)}>
            <View
              style={{
                flex: 1,
                padding: 16,
                paddingTop: insets.top + 16,
                paddingBottom: insets.bottom + 16,
                backgroundColor: theme.background,
                gap: 12,
              }}
            >
              {
                <MediaAction
                  label={t("thread.closePreview")}
                  onPress={() => setPreview(undefined)}
                />
              }
              <ThemedText type="smallBold">{preview.name}</ThemedText>
              {previewError && (
                <ThemedText accessibilityRole="alert">{t("thread.previewFailed")}</ThemedText>
              )}
              {preview.kind === "image" ? (
                <Image
                  source={{ uri: preview.url }}
                  cachePolicy="none"
                  contentFit="contain"
                  style={{ flex: 1 }}
                  accessibilityLabel={preview.name}
                  onError={() => setPreviewError(true)}
                />
              ) : (
                <ConversationVideo url={preview.url} onRetry={() => setPreview(undefined)} />
              )}
            </View>
          </Modal>
        )}
      </View>
    </Modal>
  );
}

function CanvasMediaRow({
  item,
  attached,
  available = true,
  canEdit,
  nodeId,
  onChoose,
  onPreview,
}: {
  item: CanvasMediaItem;
  attached: boolean;
  available?: boolean;
  canEdit: boolean;
  nodeId: string;
  onChoose(edit: CanvasShotMedia): void;
  onPreview(item: CanvasMediaItem): void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  return (
    <View
      key={item.key}
      style={{ gap: 4, padding: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 8 }}
    >
      <ThemedText type="smallBold">{item.name}</ThemedText>
      <ThemedText type="small">
        {t(item.kind === "image" ? "storyCanvas.media.frame" : "storyCanvas.media.clip")}
        {item.preferred ? ` · ${t("storyCanvas.media.preferred")}` : ""}
      </ThemedText>
      {!item.url && (
        <ThemedText type="small">
          {t(item.pending ? "storyCanvas.media.pending" : "storyCanvas.media.unavailable")}
        </ThemedText>
      )}
      {!!item.url && (
        <MediaAction
          label={t("storyCandidates.preview")}
          onPress={() => {
            onPreview(item);
          }}
        />
      )}
      {canEdit &&
        (attached ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {item.edgeId && item.needsRefresh && (
              <MediaAction
                label={t("storyCanvas.media.refresh")}
                onPress={() => onChoose({ action: "refresh", nodeId, edgeId: item.edgeId! })}
              />
            )}
            {item.edgeId && item.kind === "image" && !item.pending && !item.preferred && (
              <MediaAction
                label={t("storyCanvas.media.prefer")}
                onPress={() => onChoose({ action: "prefer", nodeId, edgeId: item.edgeId })}
              />
            )}
            {item.edgeId && (
              <MediaAction
                label={t("storyCanvas.media.detach")}
                onPress={() => onChoose({ action: "detach", nodeId, edgeId: item.edgeId! })}
              />
            )}
          </View>
        ) : (
          <>
            {
              <MediaAction
                label={t("storyCanvas.media.attach")}
                onPress={() =>
                  onChoose({
                    action: "attach",
                    nodeId,
                    sourceId: item.sourceId!,
                    edgeId: uuid.v4(),
                  })
                }
                disabled={!available}
              />
            }
            {!available && <ThemedText type="small">{t("storyCanvas.media.full")}</ThemedText>}
          </>
        ))}
    </View>
  );
}

function MediaAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ paddingVertical: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
