import type {
  CanvasReferenceEdit,
  CanvasReferenceTarget,
} from "../../../../canvas-editor/reference-schema";
import { loadCanvasReferenceTarget } from "../api/canvas-reference-target";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { uuid } from "expo-modules-core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { StoryCanvasMediaPreview } from "./story-canvas-media-preview";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasShotMedia } from "../../../../canvas-editor/shot-media-schema";
import {
  canvasMediaBaseline,
  canvasMediaDraftStore,
  type CanvasMediaDraft,
} from "../lib/story-canvas-media-draft";
import { canvasMediaView, type CanvasMediaItem } from "../lib/story-canvas-media-view";
import { canvasUpdatePending, type CanvasUpdateCommand } from "../api/story-canvas-update";
import type { CanvasEditScope } from "../lib/story-canvas-draft";
import {
  platformCanvasUpdatePending,
  openPlatformCanvasDocument,
} from "../api/platform-canvas-document";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCanvasEncoder } from "./story-canvas-encoder";

type MediaSelection = CanvasShotMedia | Extract<CanvasReferenceEdit, { action: "removeReference" }>;

export function StoryCanvasMediaForm({
  scope,
  userId,
  loaded,
  nodeId,
  canEdit,
  close,
  saved,
}: {
  scope: CanvasEditScope;
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
  const client = useMemo(
    () =>
      "kind" in scope
        ? platformCanvasUpdatePending(scope, userId)
        : canvasUpdatePending(scope, userId),
    [scope, userId]
  );
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
  const reference =
    (loaded.snapshot.nodes[nodeId] as { type?: string } | undefined)?.type !== "shot";
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [catalog, setCatalog] = useState<{
    scope: CanvasEditScope;
    loaded: CanvasLoaded;
    nodeId: string;
    attempt: number;
    target?: CanvasReferenceTarget;
    error?: string;
  }>();
  const currentCatalog =
    catalog?.scope === scope &&
    catalog.loaded === loaded &&
    catalog.nodeId === nodeId &&
    catalog.attempt === catalogAttempt
      ? catalog
      : undefined;
  const target = currentCatalog?.target;
  const catalogError = currentCatalog?.error;
  useEffect(() => {
    if (!reference || !canEdit) return;
    const controller = new AbortController();
    void loadCanvasReferenceTarget(scope, loaded, nodeId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          setCatalog({ scope, loaded, nodeId, attempt: catalogAttempt, target: value });
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setCatalog({ scope, loaded, nodeId, attempt: catalogAttempt, error: String(cause) });
      });
    return () => controller.abort();
  }, [scope, loaded, nodeId, reference, canEdit, catalogAttempt]);
  const [preview, setPreview] = useState<{ key: string; attached: boolean }>();
  const view = useMemo(() => {
    try {
      return { data: canvasMediaView(loaded.snapshot, nodeId, target) };
    } catch (cause) {
      return { error: String(cause) };
    }
  }, [loaded, nodeId, target]);
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
  const choose = (edit: MediaSelection) => {
    if (!current() || !canEdit || busy.current || draft || initial.error) return;
    try {
      const selected =
        edit.action === "attach"
          ? view.data?.sources.find((item) => item.sourceId === edit.sourceId)?.name
          : edit.action === "removeReference"
            ? view.data?.attached.find(
                (item) => item.field === edit.field && item.referenceId === edit.referenceId
              )?.name
            : view.data?.attached.find((item) => item.edgeId === edit.edgeId)?.name;
      if (
        (reference && edit.action === "prefer") ||
        (!reference && edit.action === "removeReference")
      )
        return;
      let selectedEdit: CanvasMediaDraft["edit"] = edit;
      if (reference && (edit.action === "attach" || edit.action === "refresh")) {
        if (!target) throw Error(t("storyCanvas.loadError"));
        selectedEdit = { ...edit, target };
      }
      const next = {
        edit: selectedEdit,
        ...(reference ? { reference: true as const } : {}),
        title: `${view.data?.title ?? nodeId} · ${selected ?? t("storyCanvas.media.automatic")}`,
        baseline: canvasMediaBaseline(loaded.snapshot, selectedEdit),
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
    if (!draft || !["detach", "removeReference"].includes(draft.edit.action) || draft.command)
      return save();
    Alert.alert(
      t(
        draft.edit.action === "removeReference"
          ? "storyCanvas.media.removeReference"
          : "storyCanvas.media.detach"
      ),
      t(reference ? "storyCanvas.referencesDetachBody" : "storyCanvas.media.detachBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t(
            draft.edit.action === "removeReference"
              ? "storyCanvas.media.removeReference"
              : "storyCanvas.media.detach"
          ),
          style: "destructive",
          onPress: save,
        },
      ]
    );
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
          <ThemedText type="smallBold">
            {t(reference ? "storyCanvas.referencesTitle" : "storyCanvas.media.title")}
          </ThemedText>
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
            {reference && canEdit && !target && !catalogError && <ActivityIndicator />}
            {catalogError && (
              <>
                <ThemedText accessibilityRole="alert">{catalogError}</ThemedText>
                <MediaAction
                  label={t("common.retry")}
                  onPress={() => setCatalogAttempt((value) => value + 1)}
                />
              </>
            )}
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
                reference={reference}
                canEdit={canEdit && !initial.error}
                nodeId={nodeId}
                onChoose={choose}
                onPreview={(item) => {
                  setPreview({ key: item.key, attached: true });
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
                    reference={reference}
                    attached={false}
                    available={item.available}
                    availabilityKnown={!reference || !!target}
                    canEdit={canEdit && !initial.error}
                    nodeId={nodeId}
                    onChoose={choose}
                    onPreview={(item) => {
                      setPreview({ key: item.key, attached: false });
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
            platform={"kind" in scope ? { scope, load: openPlatformCanvasDocument } : undefined}
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onError={failed}
            onResult={async (value) => {
              if (!current()) return;
              try {
                if (
                  value.documentId !== scope.documentId ||
                  canvasMediaBaseline(value.snapshot, draft.edit) !== draft.baseline
                )
                  throw Error(t("storyCanvas.changed"));
                if (draft.reference && "target" in draft.edit) {
                  const latest = await loadCanvasReferenceTarget(
                    scope,
                    value,
                    nodeId,
                    life.current!.signal
                  );
                  if (!current()) return;
                  if (JSON.stringify(latest) !== JSON.stringify(draft.edit.target))
                    throw Error(t("storyCanvas.changed"));
                }
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
            edit={
              draft.reference
                ? { action: "references", references: draft.edit as CanvasReferenceEdit }
                : (draft.edit as CanvasShotMedia)
            }
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
        {preview && (
          <StoryCanvasMediaPreview
            scope={scope}
            shot={{ nodeId, ...preview }}
            close={() => setPreview(undefined)}
          />
        )}
      </View>
    </Modal>
  );
}

function CanvasMediaRow({
  item,
  attached,
  available = true,
  availabilityKnown = true,
  reference = false,
  canEdit,
  nodeId,
  onChoose,
  onPreview,
}: {
  item: CanvasMediaItem;
  attached: boolean;
  available?: boolean;
  availabilityKnown?: boolean;
  reference?: boolean;
  canEdit: boolean;
  nodeId: string;
  onChoose(edit: MediaSelection): void;
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
        {t(
          item.missingSource
            ? "storyCanvas.referencesMissingSource"
            : item.kind === "audio"
              ? "storyCanvas.audio"
              : item.kind === "image"
                ? reference
                  ? "storyCanvas.image"
                  : "storyCanvas.media.frame"
                : reference
                  ? "storyCanvas.video"
                  : "storyCanvas.media.clip"
        )}
        {item.preferred ? ` · ${t("storyCanvas.media.preferred")}` : ""}
      </ThemedText>
      {!item.url && !item.mediaAssetId && (
        <ThemedText type="small">
          {t(item.pending ? "storyCanvas.media.pending" : "storyCanvas.media.unavailable")}
        </ThemedText>
      )}
      {(!!item.url || !!item.mediaAssetId) && (
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
            {!reference &&
              item.edgeId &&
              item.kind === "image" &&
              !item.pending &&
              !item.preferred && (
                <MediaAction
                  label={t("storyCanvas.media.prefer")}
                  onPress={() => onChoose({ action: "prefer", nodeId, edgeId: item.edgeId })}
                />
              )}
            {reference && !item.edgeId && item.referenceId && item.field && (
              <MediaAction
                label={t("storyCanvas.media.removeReference")}
                onPress={() =>
                  onChoose({
                    action: "removeReference",
                    nodeId,
                    field: item.field!,
                    referenceId: item.referenceId!,
                  })
                }
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
            {!available && availabilityKnown && (
              <ThemedText type="small">
                {t(reference ? "storyCanvas.referencesUnavailable" : "storyCanvas.media.full")}
              </ThemedText>
            )}
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
