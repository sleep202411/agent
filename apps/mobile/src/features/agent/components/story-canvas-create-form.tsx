import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { uuid } from "expo-modules-core";
import * as DocumentPicker from "expo-document-picker";
import { canvasUploadTypes } from "../../../../canvas-editor/upload-schema";
import { uploadCanvasFile, confirmCanvasUpload } from "../api/story-canvas-upload";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasNodeCreate } from "../../../../canvas-editor/schema";
import {
  canvasCreateDraftStore,
  canvasAppendPosition,
  type CanvasCreateDraft,
} from "../lib/story-canvas-create-draft";
import { canvasUpdatePending, type CanvasUpdateCommand } from "../api/story-canvas-update";
import { loadCanvasModels } from "../api/story-canvas-models";
import type { CanvasEditScope } from "../lib/story-canvas-draft";
import {
  openPlatformCanvasDocument,
  platformCanvasUpdatePending,
} from "../api/platform-canvas-document";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCanvasEncoder } from "./story-canvas-encoder";

const types = ["prompt", "video", "audio", "note", "shot", "uploadedAsset"] as const;
export function StoryCanvasCreateForm({
  scope,
  userId,
  close,
  saved,
  libraryAsset,
}: {
  scope: CanvasEditScope;
  userId: string;
  close(): void;
  saved(): void;
  libraryAsset?: { id: string; name?: string };
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const store = useMemo(() => canvasCreateDraftStore(scope, userId), [scope, userId]);
  const client = useMemo(
    () =>
      "kind" in scope
        ? platformCanvasUpdatePending(scope, userId)
        : canvasUpdatePending(scope, userId),
    [scope, userId]
  );
  const [initial] = useState(() => {
    try {
      return {
        draft:
          store.read() ??
          (libraryAsset
            ? {
                nodeId: uuid.v4(),
                type: "libraryAsset" as const,
                name: libraryAsset.name ?? "",
                text: "",
                assetId: libraryAsset.id,
              }
            : { nodeId: uuid.v4(), type: "prompt" as const, name: "", text: "" }),
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const [draft, setDraft] = useState<CanvasCreateDraft | undefined>(initial.draft),
    [error, setError] = useState(initial.error);
  const [phase, setPhase] = useState<"idle" | "refresh" | "prepare" | "encode" | "save" | "upload">(
    "idle"
  );
  const [prepared, setPrepared] = useState<{ loaded: CanvasLoaded; create: CanvasNodeCreate }>();
  const life = useRef<AbortController | null>(null),
    busy = useRef(false),
    persistedInitial = useRef(false);
  useLayoutEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    try {
      if (!persistedInitial.current && initial.draft) {
        store.write(initial.draft);
        persistedInitial.current = true;
      }
    } catch (cause) {
      queueMicrotask(() => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    }
    return () => controller.abort();
  }, [initial, store]);
  const current = () =>
    !!life.current && !life.current.signal.aborted && getAuthGeneration() === scope.generation;
  const fail = (cause: unknown) => {
    if (!current()) return;
    busy.current = false;
    setPhase("idle");
    setError(cause instanceof Error ? cause.message : String(cause));
  };
  const change = (patch: Partial<Pick<CanvasCreateDraft, "type" | "name" | "text">>) => {
    if (!current() || !draft || busy.current || draft.command) return;
    if (patch.type && patch.type !== draft.type && (draft.upload || draft.uploadedAsset)) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    try {
      store.write(next);
      setError(undefined);
    } catch (cause) {
      fail(cause);
    }
  };
  const pickFile = async () => {
    if (
      !current() ||
      !draft ||
      busy.current ||
      draft.command ||
      draft.upload ||
      draft.uploadedAsset
    )
      return;
    busy.current = true;
    setError(undefined);
    setPhase("upload");
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: canvasUploadTypes,
        multiple: false,
        copyToCacheDirectory: true,
        base64: false,
      });
      if (!current()) return;
      if (!picked.canceled) {
        if (picked.assets.length !== 1) throw Error(t("storyCanvas.upload.pickOne"));
        const file = picked.assets[0]!;
        let latest = draft;
        const uploadedAsset = await uploadCanvasFile(
          scope,
          {
            uri: file.uri,
            name: file.name,
            type: file.file?.type || file.mimeType || "",
            size: file.file?.size ?? file.size,
          },
          life.current!.signal,
          (upload) => {
            if (!current()) throw Error(t("storyCanvas.changed"));
            latest = { ...draft, upload };
            store.write(latest);
            setDraft(latest);
          }
        );
        if (!current()) return;
        const next = { ...latest, uploadedAsset };
        store.write(next);
        setDraft(next);
      }
      busy.current = false;
      setPhase("idle");
    } catch (cause) {
      fail(cause);
    }
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
      fail(cause);
    }
  };
  const save = async () => {
    if (!current() || !draft || busy.current) return;
    busy.current = true;
    setError(undefined);
    try {
      if (draft.type === "uploadedAsset" && !draft.uploadedAsset && !draft.upload)
        throw Error(t("storyCanvas.upload.pickOne"));
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
      else {
        if (draft.type === "uploadedAsset" && !draft.uploadedAsset && draft.upload) {
          setPhase("upload");
          const uploadedAsset = await confirmCanvasUpload(
            scope,
            draft.upload,
            life.current!.signal
          );
          if (!current()) return;
          const next = { ...draft, uploadedAsset };
          store.write(next);
          setDraft(next);
        }
        setPhase("refresh");
      }
    } catch (cause) {
      fail(cause);
    }
  };
  const prepare = async (loaded: CanvasLoaded) => {
    if (!current() || !draft) return;
    setPhase("prepare");
    try {
      if (loaded.documentId !== scope.documentId) throw Error(t("storyCanvas.changed"));
      const position = canvasAppendPosition(loaded.snapshot);
      let create: CanvasNodeCreate;
      if (draft.type === "uploadedAsset") {
        if (!draft.uploadedAsset) throw Error(t("storyCanvas.upload.pickOne"));
        create = {
          nodeId: draft.nodeId,
          type: "uploadedAsset",
          asset: draft.uploadedAsset,
          position,
        };
      } else if (draft.type === "libraryAsset")
        create = { nodeId: draft.nodeId, type: "libraryAsset", assetId: draft.assetId!, position };
      else if (draft.type === "shot") create = { nodeId: draft.nodeId, type: "shot", position };
      else if (draft.type === "note")
        create = { nodeId: draft.nodeId, type: "note", position, data: { text: draft.text } };
      else {
        const catalog = await loadCanvasModels(scope, life.current!.signal);
        if (!current()) return;
        const kind = draft.type === "prompt" ? "image" : draft.type;
        const count = Object.values(loaded.snapshot.nodes).filter(
          (node) => (node as { type?: string }).type === draft.type
        ).length;
        create = {
          nodeId: draft.nodeId,
          type: draft.type,
          position,
          data: {
            ...catalog.defaults[kind],
            name: draft.name.trim() || `${t(`storyCanvas.createType.${draft.type}`)} ${count + 1}`,
            prompt: draft.text,
          },
        };
      }
      setPrepared({ loaded, create });
      setPhase("encode");
    } catch (cause) {
      fail(cause);
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
            fail(cause);
          }
        },
      },
    ]);
  const editable = phase === "idle" && !draft?.command && !draft?.upload && !draft?.uploadedAsset;
  const missingFile = draft?.type === "uploadedAsset" && !draft.upload && !draft.uploadedAsset;
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: 16,
          gap: 12,
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          <ThemedText type="smallBold">{t("storyCanvas.create")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={close} style={{ padding: 12 }}>
            <ThemedText type="small">{t("agent.close")}</ThemedText>
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 16, paddingBottom: 24 }}
        >
          {draft && (
            <>
              <ThemedText type="small">
                {t(draft.command ? "storyCanvas.pending" : "storyCanvas.draftSaved")}
              </ThemedText>
              {libraryAsset && draft.assetId !== libraryAsset.id && (
                <ThemedText type="small">{t("storyCanvas.library.existingDraft")}</ThemedText>
              )}
              {draft.type === "libraryAsset" ? (
                <ThemedText type="smallBold">
                  {draft.name || t("storyCanvas.library.add")}
                </ThemedText>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {types.map((type) => (
                    <Pressable
                      key={type}
                      accessibilityRole="button"
                      accessibilityState={{ selected: draft.type === type, disabled: !editable }}
                      disabled={!editable}
                      onPress={() => change({ type })}
                      style={{
                        padding: 10,
                        borderWidth: 1,
                        borderRadius: 8,
                        borderColor: draft.type === type ? theme.brand : theme.border,
                      }}
                    >
                      <ThemedText type="small">{t(`storyCanvas.createType.${type}`)}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              )}
              {!["shot", "note", "libraryAsset", "uploadedAsset"].includes(draft.type) && (
                <>
                  <ThemedText type="small">{t("storyCanvas.createName")}</ThemedText>
                  <TextInput
                    accessibilityLabel={t("storyCanvas.createName")}
                    editable={editable}
                    value={draft.name}
                    onChangeText={(name) => change({ name })}
                    style={{
                      color: theme.text,
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 8,
                      padding: 12,
                    }}
                  />
                </>
              )}
              {!["shot", "libraryAsset", "uploadedAsset"].includes(draft.type) && (
                <>
                  <ThemedText type="small">
                    {t(draft.type === "note" ? "storyCanvas.noteText" : "storyCanvas.promptText")}
                  </ThemedText>
                  <TextInput
                    accessibilityLabel={t(
                      draft.type === "note" ? "storyCanvas.noteText" : "storyCanvas.promptText"
                    )}
                    multiline
                    editable={editable}
                    value={draft.text}
                    onChangeText={(text) => change({ text })}
                    style={{
                      color: theme.text,
                      minHeight: 140,
                      textAlignVertical: "top",
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 8,
                      padding: 12,
                    }}
                  />
                </>
              )}
              {draft.type === "uploadedAsset" && (
                <>
                  <ThemedText type="small">
                    {draft.uploadedAsset?.name ??
                      draft.upload?.name ??
                      t("storyCanvas.upload.formats")}
                  </ThemedText>
                  {!draft.upload && !draft.uploadedAsset && (
                    <Pressable
                      accessibilityRole="button"
                      disabled={phase !== "idle"}
                      onPress={() => {
                        void pickFile();
                      }}
                      style={{ paddingVertical: 12 }}
                    >
                      <ThemedText type="small">{t("storyCanvas.upload.choose")}</ThemedText>
                    </Pressable>
                  )}
                </>
              )}
              <ThemedText type="small">
                {t(
                  draft.type === "uploadedAsset"
                    ? "storyCanvas.upload.help"
                    : draft.type === "libraryAsset"
                      ? "storyCanvas.library.addHelp"
                      : draft.type === "shot"
                        ? "storyCanvas.createShotHelp"
                        : draft.type === "note"
                          ? "storyCanvas.createNoteHelp"
                          : "storyCanvas.createGenerationHelp"
                )}
              </ThemedText>
              {phase === "idle" ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={missingFile}
                  accessibilityState={{ disabled: missingFile }}
                  onPress={() => {
                    void save();
                  }}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: theme.brand,
                    opacity: missingFile ? 0.5 : 1,
                  }}
                >
                  <ThemedText type="smallBold">
                    {t(draft.command ? "common.retry" : "storyCanvas.create")}
                  </ThemedText>
                </Pressable>
              ) : (
                <ActivityIndicator />
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
        </ScrollView>
        {phase === "refresh" && (
          <StoryCanvasReader
            scope={scope}
            platform={"kind" in scope ? { scope, load: openPlatformCanvasDocument } : undefined}
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onError={fail}
            onResult={(value) => {
              void prepare(value);
            }}
          />
        )}
        {phase === "encode" && prepared && draft && (
          <StoryCanvasEncoder
            loaded={prepared.loaded}
            edit={prepared.create}
            generation={scope.generation}
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onError={fail}
            onResult={(update) => {
              if (!current()) return;
              try {
                if (!update) throw Error(t("storyCanvas.loadError"));
                const command = { clientKey: uuid.v4(), yjsUpdateBase64: update },
                  next = { ...draft, command };
                store.write(next);
                setDraft(next);
                void submit(command);
              } catch (cause) {
                fail(cause);
              }
            }}
          />
        )}
      </View>
    </Modal>
  );
}
