"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useStore, type Node, type NodeProps } from "@xyflow/react";
import { MEDIA_ASSET_READINESS_CAPABILITY } from "@repo/shared";
import {
  IconAlertTriangle,
  IconArrowsMaximize,
  IconDownload,
  IconLoader2,
  IconMaximize,
  IconPencil,
  IconArrowsDiagonal,
  IconBackground,
  IconBulb,
  IconPhoto,
  IconCopy,
  IconRefresh,
  IconRotate3d,
  IconRoute,
  IconVideo,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { ReactCompareSlider } from "react-compare-slider";
import { cn } from "@/lib/utils";
import { CANVAS_NODE_DRAG_HANDLE_CLASS } from "@/components/canvas/canvas-interaction-policy";
import { useVideoPlaybackError, VideoPlaybackFallback } from "@/components/video-playback-fallback";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import type { CanvasAsset, CanvasEdgeShape, CanvasNodeShape } from "@/lib/canvas-core/types";
import { useAiCatalog, usableModelsByModality } from "@/lib/canvas-authoring/use-ai-catalog";
import { removeEdgeById } from "@/lib/canvas-authoring/canvas-wiring";
import { useGeneration } from "@/lib/canvas-authoring/use-canvas-generation";
import {
  EXPAND_OP,
  MOTION_OP,
  MULTI_ANGLE_OP,
  OperationConfirmBar,
  PANORAMA_OP,
  RELIGHT_OP,
  REMOVE_BG_OP,
  UPSCALE_OP,
  useSpawnComposedOperation,
  type OperationDef,
} from "./operation-confirm-bar";
import { MultiAngleEditor } from "./multi-angle-editor";
import { ExpandEditor } from "./expand-editor";
import { MotionEditor } from "./motion-editor";
import { mentionLabel, type MentionItem } from "@/lib/prompt-mentions";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import {
  canvasDefaultMode,
  canvasDefaultModel,
  defaultSettingsForModel,
  mergeCompatibleSettings,
  estimateModelSellPoints,
  hasSchemaProperty,
  isUnsafeGenerationErrorMessage,
  referenceFieldsForMode,
  type FizzAiModel,
  type FizzAiGenerationMode,
  type FizzAiReferenceKind,
  type GenerationState,
  type ModelSettings,
} from "@/lib/canvas-authoring/generation-api";
import { useOperationLabel } from "@/lib/canvas-authoring/use-labels";
import { probeMediaDurationSeconds } from "@/lib/canvas-authoring/probe-media-duration";
import { ValidationAlertDialog } from "./validation-alert-dialog";
import { CanvasNodeToolbar, ToolbarButton } from "./node-toolbar";
import { CanvasMediaToolbarActions } from "./media-actions-context";
import { Icon720, PanoramaViewer } from "./panorama-viewer";
import { ReferenceStack, type CardReferences } from "./reference-stack";
import {
  GenerationPromptComposer,
  type GenerationPromptComposerPanel,
} from "@/app/[locale]/_components/generation/generation-prompt-composer";
import { PortPlus } from "./ports";
import { MediaAssetReadinessControlForAsset } from "./media-asset-readiness";
import { CanvasMediaViewer } from "./canvas-media-viewer";

/**
 * One generation card for both image and video — the card is a display
 * container for the produced media; selecting it reveals its composer below
 * (references / prompt / mode / model / schema-driven settings / submit).
 * The only thing that varies by modality is the descriptor below, so image and
 * video cards share this single component (registered as the `prompt`/`video`
 * node types via the thin wrappers at the bottom).
 */
export type GenerationModality = "image" | "video";

export type GenerationNodeData = {
  name?: string;
  /** Stable operation key (e.g. "upscale") for operation-result nodes — the
   *  title is translated from this at render so we never bake a locale into the
   *  CRDT. `name` (if set) is a user-chosen override and wins. */
  opType?: string;
  prompt?: string;
  modelId?: string;
  modelName?: string;
  mode?: string;
  settings?: ModelSettings;
  references?: CardReferences;
  generation?: GenerationState;
  /** Set when a node is spawned to auto-run once on mount (e.g. panorama). */
  autoSubmit?: boolean;
  /**
   * Operation-locked card (spawned from a specific op like Upscale): its model +
   * mode are fixed by the operation, so the composer hides the model + mode
   * pickers (switching them would contradict the operation the card represents).
   */
  locked?: boolean;
  /**
   * Model-locked card (spawned from a prompt-driven op like Relight): the model
   * + mode pickers are hidden (fixed by the op), but the composer stays open so
   * the user can write the prompt + tune settings before generating.
   */
  modelLocked?: boolean;
};
export type GenerationNodeType = Node<GenerationNodeData, "prompt" | "video">;

const MODALITY = {
  image: { icon: IconPhoto },
  video: { icon: IconVideo },
} as const;

function displayGenerationError(
  generation: GenerationState | undefined,
  fallback: string,
  providerUnavailable: string
): string {
  if (generation?.errorCode === "PROVIDER_NOT_CONFIGURED") return providerUnavailable;
  if (isUnsafeGenerationErrorMessage(generation?.error)) return providerUnavailable;
  return generation?.error || fallback;
}

const UPLOAD_KIND_BY_REFERENCE: Record<FizzAiReferenceKind, string> = {
  image: "ai_reference_image",
  video: "ai_reference_video",
  audio: "ai_reference_audio",
};

const SOURCE_NODE_GAP_X = 96;
const SOURCE_NODE_STACK_Y = 92;
const IMAGE_SOURCE_WIDTH = 280;
const MEDIA_SOURCE_WIDTH = 240;

function referenceCountForLayout(references: CardReferences): number {
  return Object.values(references).reduce((count, list) => count + (list?.length ?? 0), 0);
}

function sourceNodeTypeForReference(
  kind: FizzAiReferenceKind
): "image" | "videoAsset" | "audioAsset" {
  if (kind === "video") return "videoAsset";
  if (kind === "audio") return "audioAsset";
  return "image";
}

function sourceNodePosition(
  target: CanvasNodeShape | null,
  kind: FizzAiReferenceKind,
  ordinal: number
): { x: number; y: number } {
  const width = kind === "image" ? IMAGE_SOURCE_WIDTH : MEDIA_SOURCE_WIDTH;
  const targetX = target?.position.x ?? 0;
  const targetY = target?.position.y ?? 0;
  return {
    x: targetX - width - SOURCE_NODE_GAP_X,
    y: targetY + ordinal * SOURCE_NODE_STACK_Y,
  };
}

function uploadedReferenceGraph({
  edgeId,
  fileName,
  kind,
  mediaAssetId,
  ordinal,
  sourceNodeId,
  target,
  targetNodeId,
  url,
  durationSeconds,
}: {
  edgeId: string;
  fileName: string;
  kind: FizzAiReferenceKind;
  mediaAssetId: string;
  ordinal: number;
  sourceNodeId: string;
  target: CanvasNodeShape | null;
  targetNodeId: string;
  url: string;
  durationSeconds?: number;
}): { edge: CanvasEdgeShape; node: CanvasNodeShape } {
  return {
    node: {
      id: sourceNodeId,
      type: sourceNodeTypeForReference(kind),
      position: sourceNodePosition(target, kind, ordinal),
      data: {
        src: url,
        mediaAssetId,
        label: fileName,
        ...(durationSeconds != null ? { durationSeconds } : {}),
      },
    },
    edge: {
      id: edgeId,
      source: sourceNodeId,
      target: targetNodeId,
      sourceHandle: "output",
      targetHandle: "input",
    },
  };
}

/**
 * CSS aspect-ratio for the result area so the card matches its content: actual
 * output dimensions win; otherwise the selected size token (e.g. "3:4") shapes
 * the placeholder; otherwise the modality default.
 */
function resultAspectRatio(
  modality: GenerationModality,
  settings: ModelSettings,
  generation: GenerationState | undefined
): string {
  const output = generation?.outputs?.[0];
  if (output?.width && output?.height) return `${output.width} / ${output.height}`;
  const token = String(settings.imageSize ?? settings.aspectRatio ?? settings.size ?? "");
  const match = token.match(/(\d+)\s*[:x]\s*(\d+)/);
  if (match) return `${match[1]} / ${match[2]}`;
  return modality === "video" ? "16 / 9" : "1 / 1";
}

/**
 * Result-area video preview: plays on hover, pauses on leave. Muted so the
 * hover-triggered play() isn't blocked by the autoplay policy; native controls
 * stay for scrub / fullscreen / unmute.
 */
function HoverPreviewVideo({
  src,
  className,
  onLoadedRatio,
}: {
  src: string;
  className?: string;
  /** Reports the video's intrinsic aspect (e.g. "1080 / 1920") once known, so
   *  the card can hug the clip's real shape instead of a default well. */
  onLoadedRatio?: (ratio: string) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const { failed, onError } = useVideoPlaybackError(src);
  return (
    <>
      <video
        ref={ref}
        src={src}
        loop
        muted
        playsInline
        controls
        draggable={false}
        onError={onError}
        onLoadedMetadata={() => {
          const v = ref.current;
          if (v?.videoWidth && v.videoHeight) onLoadedRatio?.(`${v.videoWidth} / ${v.videoHeight}`);
        }}
        onMouseEnter={() => void ref.current?.play().catch(() => {})}
        onMouseLeave={() => ref.current?.pause()}
        className={cn("nodrag select-none", className)}
      />
      {failed && <VideoPlaybackFallback compact />}
    </>
  );
}

/** Live ETA countdown (whole seconds) while a job runs. */
function useCountdown(seconds: number | undefined, active: boolean): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!active || seconds == null) return;
    const end = Date.now() + seconds * 1000;
    const tick = () => setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [seconds, active]);
  if (!active || seconds == null) return null;
  return remaining;
}

/** Mode-specific prompt hints — generic prompt placeholder gives no guidance
 *  for ops where the prompt has a particular job (e.g. relight = the lighting).
 *  Maps a mode to the translation key for its placeholder. */
const PROMPT_PLACEHOLDER_KEYS: Record<string, string> = {
  relight: "promptPlaceholderRelight",
};
function promptPlaceholderKey(mode: string | undefined): string {
  return (mode && PROMPT_PLACEHOLDER_KEYS[mode]) || "promptPlaceholderDefault";
}

function modelSupportsMode(
  model: FizzAiModel,
  mode: string | undefined
): mode is FizzAiGenerationMode {
  return Boolean(mode && model.generationModes?.some((candidate) => candidate === mode));
}

function modeForSelectedModel(selected: FizzAiModel, currentMode: string | undefined) {
  if (modelSupportsMode(selected, currentMode)) return currentMode;
  return canvasDefaultMode(selected);
}

function GenerationCard({
  id,
  data,
  selected,
  dragging,
  modality,
}: NodeProps<GenerationNodeType> & { modality: GenerationModality }) {
  const t = useTranslations("canvasOps");
  const tc = useTranslations("common");
  const ol = useOperationLabel();
  const graph = useCanvasGraphContext();
  const { addAssets, addNodesAndEdges, getNode, patchNodeData, canEdit, nodes } = graph;
  const { data: catalog } = useAiCatalog();
  // Composer is click-triggered: it opens for a sole selected node only, so a
  // marquee / select-all doesn't pop every card's prompt at once.
  const soleSelected = nodes.filter((n) => n.selected).length === 1;
  const {
    submit,
    cancel,
    canSubmit: generationCanSubmit,
    disabledReason: generationDisabledReason,
    preflightIssues,
    clearPreflightIssues,
  } = useGeneration();
  const validationIssues = preflightIssues(id);
  const spawnComposedOp = useSpawnComposedOperation();
  const [pendingOp, setPendingOp] = useState<OperationDef | null>(null);
  const autoSubmittedRef = useRef(false);
  const [panel, setPanel] = useState<GenerationPromptComposerPanel>(null);
  const [renaming, setRenaming] = useState(false);
  const [pano, setPano] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  // Actual rendered-output aspect ratio (e.g. Topaz upscale returns no width/
  // height metadata) so the card hugs its content instead of the size default.
  const [loadedRatio, setLoadedRatio] = useState<string | null>(null);
  // Keep the composer at a constant screen size (don't shrink/grow with zoom).
  const zoom = useStore((s) => s.transform[2]);

  const descriptor = MODALITY[modality];
  const Icon = descriptor.icon;
  const modalityLabel = modality === "video" ? t("modalityVideo") : t("modalityImage");
  // Node title: a user-set name wins; else the translated operation label (for
  // op-result nodes); else the modality default. Never bakes a locale into the doc.
  const opTitle = ol(data.opType);
  const displayTitle = data.name ?? opTitle ?? modalityLabel;
  const generation = data.generation;
  const generationErrorMessage = displayGenerationError(
    generation,
    t("generationFailed"),
    t("generationProviderUnavailable")
  );
  const settings = useMemo(() => data.settings ?? {}, [data.settings]);
  const busy =
    generation?.status === "submitting" ||
    generation?.status === "queued" ||
    generation?.status === "generating";
  const eta = useCountdown(generation?.etaSeconds, generation?.status === "generating");

  const model = useMemo(
    () => catalog?.models.find((m) => m.id === data.modelId),
    [catalog, data.modelId]
  );
  const references = useMemo(() => data.references ?? {}, [data.references]);
  // First bound input image — the "before" for an op's before/after comparison.
  const compareBeforeUrl = useMemo(() => {
    for (const list of Object.values(references)) {
      const hit = (list ?? []).find((r) => r.kind === "image" && /^https?:/i.test(r.url));
      if (hit) return hit.url;
    }
    return null;
  }, [references]);
  // Optimistic, LOCAL-only reference chips still streaming to storage (blob
  // preview + spinner) — never written to the doc; on confirm the durable URL
  // is patched into `references` and the pending chip is dropped.
  const [pendingRefs, setPendingRefs] = useState<CardReferences>({});
  const referencesForDisplay = useMemo<CardReferences>(() => {
    const fields = Object.keys(pendingRefs);
    if (fields.length === 0) return references;
    const merged: CardReferences = { ...references };
    for (const field of fields) {
      const pend = pendingRefs[field] ?? [];
      if (pend.length) merged[field] = [...(references[field] ?? []), ...pend];
    }
    return merged;
  }, [references, pendingRefs]);
  const mode = data.mode ?? canvasDefaultMode(model);
  const modes = model?.generationModes ?? [];
  const refFields = useMemo(() => referenceFieldsForMode(model, mode), [model, mode]);
  // Attached references the prompt can cite with `@` — labeled per kind
  // (Image1, Video1, …) in the same scheme as the studio composer. Still-
  // uploading items are skipped (no stable target yet).
  const mentionItems = useMemo<MentionItem[]>(() => {
    const counts: Record<FizzAiReferenceKind, number> = { image: 0, video: 0, audio: 0 };
    const items: MentionItem[] = [];
    for (const field of refFields) {
      for (const ref of referencesForDisplay[field.field] ?? []) {
        if (ref.uploading) continue;
        counts[ref.kind] += 1;
        items.push({
          id: ref.id,
          label: mentionLabel(ref.kind, counts[ref.kind]),
          name: ref.name,
          kind: ref.kind,
          previewUrl: ref.url,
        });
      }
    }
    return items;
  }, [referencesForDisplay, refFields]);

  // Live compute-point estimate for the current model + settings + wired/uploaded
  // references — mirrors the model-settings panel and the standalone studio
  // composer so the same run is priced identically everywhere. Null when the
  // model has no pricing policy.
  const cost = useMemo(() => {
    if (!model) return null;
    const uploadedReferenceCount = refFields.reduce(
      (n, ff) => n + (references[ff.field]?.length ?? 0),
      0
    );
    return (
      estimateModelSellPoints(model, {
        numOutputs: Number(settings.numOutputs ?? settings.n ?? 1) || 1,
        resolution: settings.resolution != null ? String(settings.resolution) : undefined,
        quality: settings.quality != null ? String(settings.quality) : undefined,
        duration: settings.duration != null ? String(settings.duration) : undefined,
        durationSeconds:
          typeof settings.durationSeconds === "number" ? settings.durationSeconds : undefined,
        referenceImageCount: uploadedReferenceCount || undefined,
      })?.sellPoints ?? null
    );
  }, [model, settings, refFields, references]);
  const isPanorama =
    mode === "image_to_panorama" || /hunyuan|panorama|world/i.test(model?.id ?? "");

  // A spawned panorama node auto-runs once, as soon as its model resolves.
  useEffect(() => {
    if (data.autoSubmit && !autoSubmittedRef.current && model && canEdit && generationCanSubmit) {
      autoSubmittedRef.current = true;
      submit(id);
      patchNodeData(id, { autoSubmit: false });
    }
  }, [data.autoSubmit, model, canEdit, generationCanSubmit, id, submit, patchNodeData]);

  // Revoke object URLs this card created when it unmounts (blobs would leak).
  const createdUrls = useRef<string[]>([]);
  useEffect(() => () => createdUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const dropPending = (field: string, refId: string) =>
    setPendingRefs((prev) => ({
      ...prev,
      [field]: (prev[field] ?? []).filter((r) => r.id !== refId),
    }));

  const addReferences = (field: string, files: File[]) => {
    const kind = refFields.find((f) => f.field === field)?.kind ?? "image";
    const layoutOrdinalBase = referenceCountForLayout(referencesForDisplay);
    for (const [fileIndex, file] of files.entries()) {
      const refId = crypto.randomUUID();
      const objectUrl = URL.createObjectURL(file);
      createdUrls.current.push(objectUrl);
      // Show an optimistic local chip immediately; upload in the background.
      setPendingRefs((prev) => ({
        ...prev,
        [field]: [
          ...(prev[field] ?? []),
          { id: refId, url: objectUrl, name: file.name, kind, uploading: true },
        ],
      }));
      Promise.all([
        uploadFileViaSignedUrl(file, { kind: UPLOAD_KIND_BY_REFERENCE[kind] }),
        kind === "video" || kind === "audio"
          ? probeMediaDurationSeconds(file, kind)
          : Promise.resolve(null as number | null),
      ])
        .then(([uploaded, durationSeconds]) => {
          URL.revokeObjectURL(objectUrl);
          const target = getNode(id);
          if (!target) {
            dropPending(field, refId);
            return;
          }
          const edgeId = crypto.randomUUID();
          const sourceNodeId = crypto.randomUUID();
          const { edge, node } = uploadedReferenceGraph({
            edgeId,
            fileName: file.name,
            kind,
            mediaAssetId: uploaded.mediaAssetId,
            ordinal: layoutOrdinalBase + fileIndex,
            sourceNodeId,
            target,
            targetNodeId: id,
            url: uploaded.url,
            durationSeconds: durationSeconds ?? undefined,
          });
          addNodesAndEdges([node], [edge]);
          addAssets([
            {
              id: uploaded.mediaAssetId,
              mediaAssetId: uploaded.mediaAssetId,
              kind: kind as CanvasAsset["kind"],
              source: "uploaded",
              url: uploaded.url,
              name: file.name,
              createdAt: Date.now(),
              category: "general",
            },
          ]);
          clearPreflightIssues(id);
          // Persist the DURABLE url (never the blob:) into the doc, drop the chip.
          // Removing the reference later removes this edge and binding together.
          patchNodeData(id, (node) => {
            const refs: CardReferences = (node.data as GenerationNodeData).references ?? {};
            return {
              references: {
                ...refs,
                [field]: [
                  ...(refs[field] ?? []),
                  {
                    id: edgeId,
                    edgeId,
                    sourceNodeId,
                    url: uploaded.url,
                    name: file.name,
                    kind,
                    assetId: uploaded.mediaAssetId,
                    ...(durationSeconds != null ? { durationSeconds } : {}),
                    bytes: file.size,
                  },
                ],
              },
            };
          });
          dropPending(field, refId);
        })
        .catch((err) => {
          dropPending(field, refId);
          URL.revokeObjectURL(objectUrl);
          if (!isUploadAbort(err)) {
            const message = err instanceof Error ? err.message : "";
            toast.error(
              message
                ? `${t("uploadFailed", { name: file.name })}: ${message}`
                : t("uploadFailed", { name: file.name })
            );
          }
        });
    }
  };

  const removeReference = (field: string, refId: string) => {
    const node = getNode(id);
    const refs: CardReferences = (node?.data as GenerationNodeData | undefined)?.references ?? {};
    const removed = (refs[field] ?? []).find((reference) => reference.id === refId);
    if (!removed) return;

    clearPreflightIssues(id);
    URL.revokeObjectURL(removed.url);
    if (removed.edgeId) {
      removeEdgeById({ getEdges: graph.getEdges, graph }, removed.edgeId, id);
      return;
    }

    patchNodeData(id, {
      references: { ...refs, [field]: (refs[field] ?? []).filter((r) => r.id !== refId) },
    });
  };

  const onSelectModel = (selected: FizzAiModel) => {
    clearPreflightIssues(id);
    patchNodeData(id, {
      modelId: selected.id,
      modelName: selected.name,
      mode: modeForSelectedModel(selected, data.mode),
      // Re-base onto the new model's defaults, keeping only prior values still
      // valid for it — a stale value (e.g. Seedance "720p" vs Wan "720P") would
      // otherwise make the request unroutable for the new model.
      settings: mergeCompatibleSettings(selected, settings),
    });
  };

  // Default to the first usable model when none is picked yet, so a card is
  // generation-ready without forcing a manual selection. Only the editor writes
  // it (viewers are read-only); idempotent — the `data.modelId` guard stops it
  // re-firing, and concurrent editors converge on the same default.
  useEffect(() => {
    if (data.modelId || !canEdit || !catalog) return;
    const def =
      canvasDefaultModel(catalog, modality) ?? usableModelsByModality(catalog, modality)[0];
    if (!def) return;
    patchNodeData(id, {
      modelId: def.id,
      modelName: def.name,
      mode: canvasDefaultMode(def),
      settings: defaultSettingsForModel(def),
    });
  }, [data.modelId, canEdit, catalog, modality, id, patchNodeData]);

  const output = generation?.outputs?.[0];
  const onDownload = async () => {
    if (!output?.url) return;
    const ext = output.type === "video" ? "mp4" : "png";
    try {
      const blob = await (await fetch(output.url)).blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${data.name ?? data.opType ?? "result"}.${ext}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(output.url, "_blank");
    }
  };

  const copyTaskId = async (jobId: string) => {
    try {
      await navigator.clipboard.writeText(jobId);
      toast.success(t("taskIdCopied"));
    } catch {
      toast.error(t("taskIdCopyFailed"));
    }
  };

  return (
    <div className="relative">
      <CanvasNodeToolbar
        nodeId={id}
        visible={(selected ?? false) && panel === null && !quickSettingsOpen && !dragging}
      >
        <CanvasMediaToolbarActions
          media={
            output?.assetId
              ? {
                  nodeId: id,
                  mediaAssetId: output.assetId,
                  kind: output.type === "video" ? "video" : "image",
                  url: output.url,
                  label: displayTitle,
                }
              : null
          }
        />
        {output?.type === "image" &&
          (isPanorama ? (
            <ToolbarButton label={t("view720")} onClick={() => setPano(true)}>
              <Icon720 className="size-4" />
            </ToolbarButton>
          ) : (
            <>
              <ToolbarButton label={t("opUpscale")} onClick={() => setPendingOp(UPSCALE_OP)}>
                <IconArrowsMaximize className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton label={t("opRemoveBg")} onClick={() => setPendingOp(REMOVE_BG_OP)}>
                <IconBackground className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton
                label={t("opRelight")}
                onClick={() => output?.url && spawnComposedOp(RELIGHT_OP, id, output.url)}
              >
                <IconBulb className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton label={t("opMultiAngle")} onClick={() => setPendingOp(MULTI_ANGLE_OP)}>
                <IconRotate3d className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton label={t("opExpand")} onClick={() => setPendingOp(EXPAND_OP)}>
                <IconArrowsDiagonal className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton label={t("opMotion")} onClick={() => setPendingOp(MOTION_OP)}>
                <IconRoute className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton
                label={t("opGeneratePanorama")}
                onClick={() => setPendingOp(PANORAMA_OP)}
              >
                <Icon720 className="size-4" />
              </ToolbarButton>
            </>
          ))}
        {output && (
          <>
            <ToolbarButton label={t("preview")} onClick={() => setViewerOpen(true)} iconOnly>
              <IconMaximize className="size-4" stroke={1.8} />
            </ToolbarButton>
            <ToolbarButton label={t("download")} onClick={onDownload} iconOnly>
              <IconDownload className="size-4" stroke={1.8} />
            </ToolbarButton>
          </>
        )}
        <ToolbarButton label={t("rename")} onClick={() => setRenaming(true)}>
          <IconPencil className="size-4" stroke={1.8} />
        </ToolbarButton>
      </CanvasNodeToolbar>
      {pano && output && <PanoramaViewer src={output.url} onClose={() => setPano(false)} />}
      {viewerOpen && output && (
        <CanvasMediaViewer
          type={output.type}
          src={output.url}
          title={displayTitle}
          alt={data.prompt ?? t("result")}
          downloadName={`${displayTitle}.${output.type === "video" ? "mp4" : "png"}`}
          onClose={() => setViewerOpen(false)}
        />
      )}

      <div
        className={cn(
          "relative w-[360px] overflow-hidden rounded-2xl bg-card",
          selected && "ring-2 ring-ring",
          busy && "generating-beam"
        )}
      >
        {/* Header: node name left, model used right — a lighter frosted strip
            distinct from the preview well below. */}
        <div
          className={cn(
            CANVAS_NODE_DRAG_HANDLE_CLASS,
            "flex items-center justify-between gap-2 bg-white/[0.12] px-3 py-2 text-xs"
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-white/80">
            <Icon className="size-3.5 shrink-0" stroke={1.8} />
            {renaming ? (
              <input
                autoFocus
                defaultValue={displayTitle}
                onBlur={(event) => {
                  // Clear → undefined so the title falls back to the dynamic
                  // (translated) label instead of baking text into the doc.
                  patchNodeData(id, { name: event.target.value.trim() || undefined });
                  setRenaming(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  else if (event.key === "Escape") setRenaming(false);
                }}
                className="nodrag w-28 bg-transparent text-white/80 outline-none"
              />
            ) : (
              <span className="truncate">{displayTitle}</span>
            )}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {data.modelName ?? t("selectModel")}
          </span>
        </div>

        {/* Result display area — content-aware aspect ratio; shows the produced
            media or the live job state (queued / generating+ETA / failed). */}
        <div
          className="relative flex flex-col items-center justify-center gap-3 overflow-hidden bg-muted"
          style={{ aspectRatio: loadedRatio ?? resultAspectRatio(modality, settings, generation) }}
          onDoubleClick={(event) => {
            if (!output?.url) return;
            event.preventDefault();
            event.stopPropagation();
            setViewerOpen(true);
          }}
        >
          {generation?.status === "done" && generation.outputs?.[0] ? (
            generation.outputs[0].type === "video" ? (
              <HoverPreviewVideo
                src={generation.outputs[0].url}
                onLoadedRatio={setLoadedRatio}
                className="size-full object-contain"
              />
            ) : (data.locked || data.modelLocked) &&
              compareBeforeUrl &&
              data.mode !== "outpainting" ? (
              // Operation result (upscale / remove-bg / relight / multi-angle):
              // before/after comparison slider — drag to compare input vs
              // output. Skipped for expand: the output is a larger canvas, so an
              // overlaid slider misaligns rather than compares.
              <ReactCompareSlider
                className="nodrag size-full"
                itemOne={
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={compareBeforeUrl}
                    alt={t("before")}
                    draggable={false}
                    className="size-full object-contain select-none"
                  />
                }
                itemTwo={
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={generation.outputs[0].url}
                    alt={t("after")}
                    draggable={false}
                    onLoad={(e) => {
                      const t = e.currentTarget;
                      if (t.naturalWidth && t.naturalHeight) {
                        setLoadedRatio(`${t.naturalWidth} / ${t.naturalHeight}`);
                      }
                    }}
                    className="size-full object-contain select-none"
                  />
                }
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={generation.outputs[0].url}
                alt={data.prompt ?? t("result")}
                draggable={false}
                onLoad={(e) => {
                  const t = e.currentTarget;
                  if (t.naturalWidth && t.naturalHeight) {
                    setLoadedRatio(`${t.naturalWidth} / ${t.naturalHeight}`);
                  }
                }}
                className="size-full object-contain select-none"
              />
            )
          ) : busy ? (
            <>
              <IconLoader2 className="size-7 animate-spin text-white/50" stroke={1.8} />
              <p className="text-sm text-white/55">
                {generation?.status === "submitting"
                  ? t("statusSubmitting")
                  : generation?.status === "queued"
                    ? generation.queuePosition != null
                      ? t("statusQueuedPosition", { position: generation.queuePosition })
                      : t("statusQueued")
                    : eta != null
                      ? t("statusGeneratingEta", { eta })
                      : t("statusGenerating")}
              </p>
            </>
          ) : generation?.status === "failed" ? (
            <>
              <IconAlertTriangle className="size-7 text-destructive" stroke={1.6} />
              <p className="max-w-full px-5 text-center text-sm leading-relaxed text-white/55 [overflow-wrap:anywhere]">
                {generationErrorMessage}
              </p>
              <button
                type="button"
                disabled={!canEdit || !generationCanSubmit}
                title={!generationCanSubmit ? (generationDisabledReason ?? undefined) : undefined}
                onClick={() => submit(id)}
                className="flex items-center gap-1.5 rounded-full bg-white/[0.1] px-3 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.16] hover:text-white disabled:opacity-45"
              >
                <IconRefresh className="size-3.5" stroke={1.8} />
                {tc("retry")}
              </button>
              {generation.jobId && (
                <div className="flex max-w-[calc(100%-2rem)] items-center gap-1.5 rounded-full bg-black/20 py-1 pr-1 pl-2.5">
                  <span className="min-w-0 select-text truncate font-mono text-[10px] text-white/38">
                    {generation.jobId}
                  </span>
                  <button
                    type="button"
                    aria-label={t("copyTaskId")}
                    onClick={() => void copyTaskId(generation.jobId as string)}
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.1] hover:text-white"
                  >
                    <IconCopy className="size-3.5" stroke={1.8} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <Icon className="size-7 text-white/30" stroke={1.5} />
              <p className="text-sm text-white/45">{t("resultsPlaceholder")}</p>
            </>
          )}
          {(output?.type === "image" || output?.type === "video") && (
            <MediaAssetReadinessControlForAsset
              mediaAssetId={output.assetId}
              capability={MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference}
              className="top-3 right-3 h-6 px-2 text-[10px]"
            />
          )}
        </div>
      </div>

      {/* Card-specific composer — slides up below the card while selected.
          Outer wrapper animates in; inner is counter-scaled by 1/zoom so it
          stays a constant, readable screen size. */}
      {pendingOp && output?.url ? (
        pendingOp.editor === "multiAngle" ? (
          <MultiAngleEditor
            sourceNodeId={id}
            sourceUrl={output.url}
            onClose={() => setPendingOp(null)}
          />
        ) : pendingOp.editor === "expand" ? (
          <ExpandEditor
            sourceNodeId={id}
            sourceUrl={output.url}
            onClose={() => setPendingOp(null)}
          />
        ) : pendingOp.editor === "motion" ? (
          <MotionEditor
            sourceNodeId={id}
            sourceUrl={output.url}
            onClose={() => setPendingOp(null)}
          />
        ) : (
          <OperationConfirmBar
            op={pendingOp}
            sourceNodeId={id}
            sourceUrl={output.url}
            onClose={() => setPendingOp(null)}
          />
        )
      ) : null}
      {canEdit &&
        selected &&
        soleSelected &&
        !dragging &&
        !isPanorama &&
        !data.locked &&
        !pendingOp && (
          <div className="absolute top-full left-1/2 z-10 mt-3 duration-200 animate-in fade-in-0 slide-in-from-bottom-3">
            <div
              style={{
                transform: `translateX(-50%) scale(${1 / zoom})`,
                transformOrigin: "top center",
              }}
            >
              <ValidationAlertDialog
                open={validationIssues.length > 0}
                onOpenChange={(open) => {
                  if (!open) clearPreflightIssues(id);
                }}
                title={t("validationBlockedTitle")}
                issues={validationIssues}
                formatIssue={t}
              />
              <GenerationPromptComposer
                ariaLabel={t("generate")}
                modality={modality}
                catalog={catalog}
                model={model}
                modelFallbackLabel={data.modelName}
                onSelectModel={onSelectModel}
                modelPickerEnabled={!data.locked && !data.modelLocked}
                prompt={data.prompt ?? ""}
                onPromptCommit={(prompt) => patchNodeData(id, { prompt })}
                promptPlaceholder={t(promptPlaceholderKey(mode))}
                promptAriaLabel={t(promptPlaceholderKey(mode))}
                promptAutoFocus
                showPrompt={!model || hasSchemaProperty(model, "prompt")}
                mentions={mentionItems}
                referenceContent={
                  refFields.length > 0 ? (
                    <ReferenceStack
                      fields={refFields}
                      references={referencesForDisplay}
                      onAdd={addReferences}
                      onRemove={removeReference}
                    />
                  ) : null
                }
                mode={mode}
                modes={modes}
                onSelectMode={(nextMode) => {
                  clearPreflightIssues(id);
                  patchNodeData(id, { mode: nextMode });
                }}
                modePickerEnabled={!data.locked && !data.modelLocked}
                settings={settings}
                onSettingsChange={(next) => patchNodeData(id, { settings: next })}
                panel={panel}
                onPanelChange={setPanel}
                onQuickSettingsOpenChange={setQuickSettingsOpen}
                cost={cost}
                canSubmit={canEdit && generationCanSubmit}
                submitting={busy}
                onSubmit={() => submit(id)}
                onCancel={() => cancel(id)}
                submitLabel={t("generate")}
                cancelLabel={t("cancelGeneration")}
                disabledReason={generationDisabledReason}
              />
            </div>
          </div>
        )}

      {/* Every card connects on both sides: "+" input on the left, "+" output on
          the right. The output port is tinted by the card's output kind. */}
      <PortPlus type="target" id="input" side="left" />
      <PortPlus type="source" id="output" side="right" dataType={modality} />
    </div>
  );
}

const GenerationCardMemo = memo(GenerationCard);

/** Image generation card (`prompt` node type). */
export const PromptNode = memo((props: NodeProps<GenerationNodeType>) => (
  <GenerationCardMemo {...props} modality="image" />
));
PromptNode.displayName = "PromptNode";

/** Video generation card (`video` node type). */
export const VideoNode = memo((props: NodeProps<GenerationNodeType>) => (
  <GenerationCardMemo {...props} modality="video" />
));
VideoNode.displayName = "VideoNode";
