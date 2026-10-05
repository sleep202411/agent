"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GenerationEstimate } from "./generation-estimate";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { CanvasVideo } from "@/components/media/canvas-video";
import type { CanvasEdgeShape, CanvasNodeShape } from "@/lib/canvas-core/types";
import { canvasNodeGeometry } from "@/lib/canvas-core/node-geometry";
import { useAiCatalog, usableModelsByModality } from "@/lib/canvas-authoring/use-ai-catalog";
import {
  removeEdgeById,
  sourceGenerationJobId,
  sourceMediaAssetId,
  sourceMediaMetadata,
  sourceMediaUrl,
} from "@/lib/canvas-authoring/canvas-wiring";
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
import { mentionLabel, type MentionItem, type SkillMarketItem } from "@/lib/prompt-mentions";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import {
  canvasDefaultMode,
  canvasDefaultModel,
  defaultSettingsForModel,
  mergeCompatibleSettings,
  normalizeModelSettings,
  estimateModelSellPoints,
  hasSchemaProperty,
  displayGenerationError,
  generationStateFromJob,
  getFizzAiJob,
  referenceFieldsForMode,
  type FizzAiReferenceFieldConstraints,
  type FizzAiModel,
  type FizzAiGenerationMode,
  type FizzAiReferenceKind,
  type GenerationState,
  type ModelSettings,
} from "@/lib/canvas-authoring/generation-api";
import { useOperationLabel } from "@/lib/canvas-authoring/use-labels";
import { ValidationAlertDialog } from "./validation-alert-dialog";
import { ProjectSkillDetailDialog } from "@/components/project-skills/project-skill-detail-dialog";
import { useCanvasMediaDownload } from "./use-canvas-media-download";
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
import { GenerationOutputGallery } from "./generation-output-gallery";
import { CanvasMediaViewer } from "./canvas-media-viewer";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import {
  compatibleProjectSkillInstallations,
  composePromptWithProjectSkills,
  extractProjectSkillSelection,
  generationSkillScope,
  isProjectSkillDefault,
  projectSkillMention,
  projectSkillVersionSupports,
  resolveEffectiveProjectSkills,
  type CanvasProjectSkillSelection,
} from "@/lib/project-skill-runtime";
import {
  installProjectSkill,
  type ProjectSkillCatalogItem,
  type ProjectSkillInstallation,
} from "@/lib/project-skills-api";
import {
  generationNodeTypeForModality,
  type GenerationModality,
  type GenerationNodeTypeId,
} from "@/lib/canvas-authoring/generation-node-types";
import { IconAudioWaveform } from "@/components/icons/icon-audio-waveform";
import { AssetSelectDialog } from "./asset-select-dialog";

/**
 * One generation card for both image and video — the card is a display
 * container for the produced media; selecting it reveals its composer below
 * (references / prompt / mode / model / schema-driven settings / submit).
 * The only thing that varies by modality is the descriptor below, so image and
 * video cards share this single component (registered as the `prompt`/`video`
 * node types via the thin wrappers at the bottom).
 */
function catalogTranslationKey(skill: ProjectSkillCatalogItem): string | null {
  if (!skill.localizedMetadata || typeof skill.localizedMetadata !== "object") return null;
  const key = (skill.localizedMetadata as { translationKey?: unknown }).translationKey;
  return typeof key === "string" && key ? key : null;
}

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
  /** Explicit per-card additions/removals relative to project Skill defaults. */
  skillSelection?: CanvasProjectSkillSelection;
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
export type GenerationNodeType = Node<GenerationNodeData, GenerationNodeTypeId>;

const MODALITY = {
  image: { icon: IconPhoto },
  video: { icon: IconVideo },
  audio: { icon: IconAudioWaveform },
} as const;

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

function createReferenceSourceGraph({
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
  bytes,
  width,
  height,
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
  bytes?: number;
  width?: number;
  height?: number;
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
        ...(bytes != null ? { bytes } : {}),
        ...(width != null ? { width } : {}),
        ...(height != null ? { height } : {}),
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
  if (modality === "video") return "16 / 9";
  return "1 / 1";
}

function outputExtension(type: GenerationModality): "png" | "mp4" | "mp3" {
  if (type === "video") return "mp4";
  if (type === "audio") return "mp3";
  return "png";
}

function AudioPreview({ src, title }: { src: string; title: string }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-4 px-5">
      <span className="flex size-11 items-center justify-center rounded-xl bg-white/[0.07] text-white/70">
        <IconAudioWaveform className="size-5" stroke={1.7} />
      </span>
      <p className="max-w-full truncate text-sm text-white/72">{title}</p>
      <audio
        src={src}
        controls
        preload="metadata"
        className="nodrag nowheel h-9 w-full [color-scheme:dark]"
      />
    </div>
  );
}

/** Mode-specific prompt hints — generic prompt placeholder gives no guidance
 *  for ops where the prompt has a particular job (e.g. relight = the lighting).
 *  Maps a mode to the translation key for its placeholder. */
const PROMPT_PLACEHOLDER_KEYS: Record<string, string> = {
  relight: "promptPlaceholderRelight",
};
function promptPlaceholderKey(mode: string | undefined, modality: GenerationModality): string {
  if (modality === "audio") return "promptPlaceholderAudio";
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
  const downloadCanvasMedia = useCanvasMediaDownload();
  const t = useTranslations("canvasOps");
  const tc = useTranslations("common");
  const ts = useTranslations("project.skills");
  const ol = useOperationLabel();
  const graph = useCanvasGraphContext();
  const { owner, projectSkills, projectSkillCatalog } = useProjectContext();
  const { addNodesAndEdges, getNode, patchNodeData, canEdit, nodes } = graph;
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
    statusUnavailable,
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
  const [assetPickerField, setAssetPickerField] = useState<FizzAiReferenceFieldConstraints | null>(
    null
  );
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [detailSkillIntent, setDetailSkillIntent] = useState<"inspect" | "use" | null>(null);
  const pendingSkillApplyRef = useRef<((item: MentionItem) => void) | null>(null);
  // The install response is authoritative before the catalog refetch reaches
  // React. Keep it available to the prompt commit fired by mention insertion,
  // so the new installation id is never discarded during that short window.
  const justInstalledSkillsRef = useRef(new Map<string, ProjectSkillInstallation>());
  const queryClient = useQueryClient();
  const openSkills = useProjectUIStore((state) => state.openSkills);
  // Actual rendered-output aspect ratio (e.g. Topaz upscale returns no width/
  // height metadata) so the card hugs its content instead of the size default.
  const [loadedRatio, setLoadedRatio] = useState<string | null>(null);
  // Keep the composer at a constant screen size (don't shrink/grow with zoom).
  const zoom = useStore((s) => s.transform[2]);

  const descriptor = MODALITY[modality];
  const Icon = descriptor.icon;
  const modalityLabel =
    modality === "video"
      ? t("modalityVideo")
      : modality === "audio"
        ? t("modalityAudio")
        : t("modalityImage");
  // Node title: a user-set name wins; else the translated operation label (for
  // op-result nodes); else the modality default. Never bakes a locale into the doc.
  const opTitle = ol(data.opType);
  const displayTitle = data.name ?? opTitle ?? modalityLabel;
  const generation = data.generation;
  // Older canvas snapshots lost errors containing provider request IDs. Fetch
  // the authoritative failure once; completed failures need no polling.
  const failureJobId = generation?.jobId;
  const failureDetails = useQuery({
    queryKey: ["canvas-job-error", failureJobId],
    queryFn: () => getFizzAiJob(failureJobId!),
    enabled: generation?.status === "failed" && !generation.error?.trim() && !!failureJobId,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const generationErrorMessage = displayGenerationError(
    failureDetails.data?.status === "failed"
      ? generationStateFromJob(failureDetails.data)
      : generation,
    {
      fallback: t("generationFailed"),
      providerUnavailable: t("generationProviderUnavailable"),
      referenceAudioRequiresVisual: t("generationReferenceAudioRequiresVisual"),
    }
  );
  const busy =
    generation?.status === "submitting" ||
    generation?.status === "queued" ||
    generation?.status === "generating";

  const model = useMemo(
    () => catalog?.models.find((m) => m.id === data.modelId),
    [catalog, data.modelId]
  );
  const rawSettings = useMemo(() => data.settings ?? {}, [data.settings]);
  const settings = useMemo(() => normalizeModelSettings(model, rawSettings), [model, rawSettings]);
  useEffect(() => {
    if (!canEdit || settings === rawSettings) return;
    patchNodeData(id, { settings });
  }, [canEdit, id, patchNodeData, rawSettings, settings]);
  const cardCanSubmit = generationCanSubmit && Boolean(model);
  const cardDisabledReason = model ? generationDisabledReason : t("chooseModelFirst");
  const references = useMemo(() => data.references ?? {}, [data.references]);
  // First bound input image — the "before" for an op's before/after comparison.
  const compareBeforeUrl = useMemo(() => {
    for (const list of Object.values(references)) {
      const hit = (list ?? []).find((r) => r.kind === "image" && /^https?:/i.test(r.url));
      if (hit) return hit.url;
    }
    return null;
  }, [references]);
  const hydratedReferences = useMemo<CardReferences>(() => {
    let changed = false;
    const next: CardReferences = {};
    for (const [field, list] of Object.entries(references)) {
      next[field] = list.map((reference) => {
        if (!reference.sourceNodeId) return reference;
        const metadata = sourceMediaMetadata(getNode, reference.sourceNodeId);
        const hydrated = { ...metadata, ...reference };
        if (
          hydrated.name !== reference.name ||
          hydrated.durationSeconds !== reference.durationSeconds ||
          hydrated.bytes !== reference.bytes ||
          hydrated.width !== reference.width ||
          hydrated.height !== reference.height
        ) {
          changed = true;
          return hydrated;
        }
        return reference;
      });
    }
    return changed ? next : references;
  }, [getNode, references]);
  const referencesForDisplay = hydratedReferences;
  const mode = data.mode ?? canvasDefaultMode(model);
  const modes = model?.generationModes ?? [];
  const refFields = useMemo(() => referenceFieldsForMode(model, mode), [model, mode]);
  const skillScope = generationSkillScope(modality);
  const skillSourceSurface =
    owner.kind === "platform_project" ? "fizzstudio-canvas" : "story-studio-workbench";
  const skillLabelFor = useCallback(
    (installation: ProjectSkillInstallation) =>
      installation.translationKey
        ? ts(`items.${installation.translationKey}.name`)
        : (installation.name ?? installation.slug ?? ts("title")),
    [ts]
  );
  const compatibleSkills = useMemo(
    () => compatibleProjectSkillInstallations(projectSkills.data, skillScope),
    [projectSkills.data, skillScope]
  );
  const skillMarketOptions = useMemo<SkillMarketItem[]>(() => {
    const installationBySkillId = new Map(
      compatibleSkills.map((installation) => [installation.skillId, installation])
    );
    return (projectSkillCatalog.data?.items ?? [])
      .filter(
        (skill) =>
          (!skill.installation || skill.installation.status === "active") &&
          projectSkillVersionSupports(
            skill.installation?.version ?? skill.latestVersion,
            skillScope,
            owner.kind === "platform_project" ? "platform" : "story"
          )
      )
      .map((skill) => {
        const installation = installationBySkillId.get(skill.id) ?? skill.installation;
        const translationKey = catalogTranslationKey(skill);
        const label = translationKey ? ts(`items.${translationKey}.name`) : skill.name;
        return {
          id: installation?.id ?? `catalog:${skill.id}`,
          catalogId: skill.id,
          installed: Boolean(installation),
          kind: "skill" as const,
          label,
          name: label,
          previewUrl: skill.previewUrl ?? undefined,
          previewVideoUrl: skill.previewVideoUrl ?? undefined,
        };
      });
  }, [compatibleSkills, projectSkillCatalog.data?.items, skillScope, owner.kind, ts]);
  const defaultSkillIds = useMemo(
    () =>
      new Set(
        compatibleSkills
          .filter((installation) =>
            isProjectSkillDefault({
              installation,
              scope: skillScope,
              sourceSurface: skillSourceSurface,
            })
          )
          .map((installation) => installation.id)
      ),
    [compatibleSkills, skillScope, skillSourceSurface]
  );
  const effectiveSkills = useMemo(
    () =>
      resolveEffectiveProjectSkills({
        projectSkills: projectSkills.data,
        scope: skillScope,
        sourceSurface: skillSourceSurface,
        selection: data.skillSelection,
        labelFor: skillLabelFor,
        promptLength: (data.prompt ?? "").length,
      }),
    [
      data.prompt,
      data.skillSelection,
      projectSkills.data,
      skillLabelFor,
      skillScope,
      skillSourceSurface,
    ]
  );
  const promptWithSkills = useMemo(
    () => composePromptWithProjectSkills(data.prompt ?? "", effectiveSkills),
    [data.prompt, effectiveSkills]
  );
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
          assetId: ref.assetId,
          durationSeconds: ref.durationSeconds,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
        });
      }
    }
    for (const installation of compatibleSkills) {
      items.push(projectSkillMention(installation, skillLabelFor(installation)));
    }
    return items;
  }, [compatibleSkills, referencesForDisplay, refFields, skillLabelFor]);
  const detailSkill = useMemo(
    () =>
      projectSkillCatalog.data?.items.find(
        (skill) => skill.id === detailSkillId || skill.installation?.id === detailSkillId
      ) ?? null,
    [detailSkillId, projectSkillCatalog.data?.items]
  );
  const installSkillMutation = useMutation({
    mutationFn: (skill: ProjectSkillCatalogItem) =>
      installProjectSkill({
        ownerKind: owner.kind === "platform_project" ? "platform" : "story",
        projectId: owner.projectId,
        skillId: skill.id,
        expectedProjectRevision:
          projectSkills.data?.projectRevision ?? projectSkillCatalog.data?.projectRevision ?? 0,
      }),
    onSuccess: async (response, skill) => {
      const translationKey = catalogTranslationKey(skill);
      const label = translationKey ? ts(`items.${translationKey}.name`) : skill.name;
      justInstalledSkillsRef.current.set(response.installation.id, response.installation);
      pendingSkillApplyRef.current?.(projectSkillMention(response.installation, label));
      justInstalledSkillsRef.current.delete(response.installation.id);
      toast.success(ts("detail.installAndUseSuccess", { name: label }));
      pendingSkillApplyRef.current = null;
      setDetailSkillIntent(null);
      setDetailSkillId(null);
      await queryClient.invalidateQueries({ queryKey: ["project-skills"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : ts("errors.install")),
  });
  const useDetailSkill = useCallback(
    (skill: ProjectSkillCatalogItem) => {
      const applySkill = pendingSkillApplyRef.current;
      if (!applySkill) return;
      if (!skill.installation) {
        installSkillMutation.mutate(skill);
        return;
      }
      const translationKey = catalogTranslationKey(skill);
      const label = translationKey ? ts(`items.${translationKey}.name`) : skill.name;
      applySkill(projectSkillMention(skill.installation, label));
      pendingSkillApplyRef.current = null;
      setDetailSkillIntent(null);
      setDetailSkillId(null);
    },
    [installSkillMutation, ts]
  );

  // Live compute-point estimate for the current model + settings + wired/uploaded
  // references — mirrors the model-settings panel and the standalone studio
  // composer so the same run is priced identically everywhere. Null when the
  // model has no pricing policy.
  const cost = useMemo(() => {
    if (!model) return null;
    const uploadedReferenceCount = refFields
      .filter((field) => field.kind === "image")
      .reduce((n, field) => n + (references[field.field]?.length ?? 0), 0);
    const referenceVideoSeconds = refFields
      .filter((field) => field.kind === "video")
      .reduce(
        (seconds, field) =>
          seconds +
          (references[field.field] ?? []).reduce(
            (fieldSeconds, reference) =>
              fieldSeconds +
              (typeof reference.durationSeconds === "number" &&
              Number.isFinite(reference.durationSeconds)
                ? reference.durationSeconds
                : 0),
            0
          ),
        0
      );
    return (
      estimateModelSellPoints(model, {
        text: data.prompt,
        numOutputs: Number(settings.numOutputs ?? settings.n ?? 1) || 1,
        resolution: settings.resolution != null ? String(settings.resolution) : undefined,
        quality: settings.quality != null ? String(settings.quality) : undefined,
        duration: settings.duration != null ? String(settings.duration) : undefined,
        durationSeconds:
          typeof settings.durationSeconds === "number" ? settings.durationSeconds : undefined,
        generateAudio:
          typeof settings.generateAudio === "boolean" ? settings.generateAudio : undefined,
        referenceMedia: {
          images: refFields
            .filter((field) => field.kind === "image" && field.field === "referenceImages")
            .flatMap((field) => references?.[field.field] ?? []),
          videos: refFields
            .filter((field) => field.kind === "video")
            .flatMap((field) => references?.[field.field] ?? []),
          audios: refFields
            .filter((field) => field.kind === "audio")
            .flatMap((field) => references?.[field.field] ?? []),
        },
        referenceImageCount: uploadedReferenceCount || undefined,
        referenceVideoSeconds: referenceVideoSeconds || undefined,
        // Seedance 2.5 edit keeps the source video's duration — the auto
        // quote follows the combined reference-video length (mirrors the
        // server hold).
        outputDurationFollowsReferenceVideos: settings.omniReferenceTaskType === "edit",
      })?.sellPoints ?? null
    );
  }, [model, settings, refFields, references, data.prompt]);
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

  const addAssetReference = useCallback(
    (field: FizzAiReferenceFieldConstraints, item: MentionItem) => {
      if (item.kind === "skill" || item.kind !== field.kind || !item.previewUrl) return;
      const target = getNode(id);
      if (!target) return;
      const currentReferences =
        ((target.data as GenerationNodeData).references ?? {})[field.field] ?? [];
      if (currentReferences.length >= field.maxItems) return;
      if (
        currentReferences.some(
          (reference) =>
            (Boolean(item.assetId) && reference.assetId === item.assetId) ||
            reference.url === item.previewUrl ||
            reference.id === item.id
        )
      ) {
        return;
      }

      const existingSource = nodes.find((candidate) => {
        if (candidate.id === id) return false;
        const candidateAssetId = sourceMediaAssetId(getNode, candidate.id);
        if (item.assetId && candidateAssetId === item.assetId) return true;
        return !item.assetId && sourceMediaUrl(getNode, candidate.id) === item.previewUrl;
      });
      const edgeId = crypto.randomUUID();
      const sourceNodeId = existingSource?.id ?? crypto.randomUUID();
      if (existingSource) {
        addNodesAndEdges(
          [],
          [
            {
              id: edgeId,
              source: sourceNodeId,
              target: id,
              sourceHandle: "output",
              targetHandle: "input",
            },
          ]
        );
      } else {
        const { edge, node } = createReferenceSourceGraph({
          edgeId,
          fileName: item.name ?? item.label,
          kind: field.kind,
          mediaAssetId: item.assetId ?? item.id,
          ordinal: referenceCountForLayout((target.data as GenerationNodeData).references ?? {}),
          sourceNodeId,
          target,
          targetNodeId: id,
          url: item.previewUrl,
          durationSeconds: item.durationSeconds ?? undefined,
          bytes: item.bytes ?? undefined,
          width: item.width ?? undefined,
          height: item.height ?? undefined,
        });
        addNodesAndEdges([node], [edge]);
      }
      const sourceJobId = sourceGenerationJobId(getNode, sourceNodeId);
      clearPreflightIssues(id);
      patchNodeData(id, (generationNode) => {
        const refs = (generationNode.data as GenerationNodeData).references ?? {};
        return {
          references: {
            ...refs,
            [field.field]: [
              ...(refs[field.field] ?? []),
              {
                id: edgeId,
                edgeId,
                sourceNodeId,
                url: item.previewUrl as string,
                name: item.name,
                kind: field.kind,
                ...(item.assetId ? { assetId: item.assetId } : {}),
                ...(sourceJobId ? { sourceJobId } : {}),
                ...(item.durationSeconds != null ? { durationSeconds: item.durationSeconds } : {}),
                ...(item.bytes != null ? { bytes: item.bytes } : {}),
                ...(item.width != null ? { width: item.width } : {}),
                ...(item.height != null ? { height: item.height } : {}),
              },
            ],
          },
        };
      });
    },
    [addNodesAndEdges, clearPreflightIssues, getNode, id, nodes, patchNodeData]
  );

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
    await downloadCanvasMedia(
      output.url,
      `${data.name ?? data.opType ?? "result"}.${outputExtension(output.type)}`,
      output.type === "video" || output.type === "audio" ? output.type : "image"
    );
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
                  kind: output.type,
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
          assetId={output.assetId}
          title={displayTitle}
          alt={data.prompt ?? t("result")}
          downloadName={`${displayTitle}.${outputExtension(output.type)}`}
          onClose={() => setViewerOpen(false)}
        />
      )}

      <div
        className={cn(
          "relative overflow-hidden rounded-2xl bg-card",
          selected && "ring-2 ring-ring",
          busy && "generating-beam"
        )}
        style={{
          width: canvasNodeGeometry({ type: generationNodeTypeForModality(modality) }).width,
        }}
      >
        {/* Header: node name left, model used right — a lighter frosted strip
            distinct from the preview well below. */}
        <div className="flex items-center justify-between gap-2 bg-white/[0.12] px-3 py-2 text-xs">
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
          style={
            modality === "audio"
              ? { height: canvasNodeGeometry({ type: "audio" }).minHeight }
              : { aspectRatio: loadedRatio ?? resultAspectRatio(modality, settings, generation) }
          }
          onDoubleClick={(event) => {
            if (!output?.url) return;
            event.preventDefault();
            event.stopPropagation();
            setViewerOpen(true);
          }}
        >
          {generation?.status === "done" && generation.outputs?.[0] ? (
            generation.outputs[0].type === "audio" ? (
              <AudioPreview src={generation.outputs[0].url} title={displayTitle} />
            ) : generation.outputs[0].type === "video" ? (
              <CanvasVideo
                src={generation.outputs[0].url}
                assetId={generation.outputs[0].assetId}
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
              <p role="status" className="px-4 text-center text-sm text-white/55">
                {statusUnavailable(generation?.jobId) ? (
                  t("statusReadUnavailable")
                ) : generation?.status === "submitting" ? (
                  t("statusSubmitting")
                ) : generation?.status === "queued" ? (
                  generation.queuePosition != null ? (
                    t("statusQueuedPosition", { position: generation.queuePosition })
                  ) : (
                    t("statusQueued")
                  )
                ) : (
                  <GenerationEstimate seconds={generation?.etaSeconds} />
                )}
              </p>
            </>
          ) : generation?.status === "failed" || generation?.status === "uncertain" ? (
            <>
              <IconAlertTriangle className="size-7 text-destructive" stroke={1.6} />
              <p className="max-w-full px-5 text-center text-sm leading-relaxed text-white/55 [overflow-wrap:anywhere]">
                {generationErrorMessage}
              </p>
              <button
                type="button"
                disabled={!canEdit || !cardCanSubmit}
                title={!cardCanSubmit ? (cardDisabledReason ?? undefined) : undefined}
                onClick={() => submit(id)}
                className="nodrag flex items-center gap-1.5 rounded-full bg-white/[0.1] px-3 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.16] hover:text-white disabled:opacity-45"
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
                    className="nodrag flex size-6 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.1] hover:text-white"
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
        {generation?.status === "done" && generation.outputs && (
          <GenerationOutputGallery
            key={generation.jobId}
            outputs={generation.outputs}
            title={displayTitle}
          />
        )}
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
                prompt={promptWithSkills}
                onPromptCommit={(prompt) => {
                  const skillsForCommit = [...compatibleSkills];
                  for (const installation of justInstalledSkillsRef.current.values()) {
                    if (!skillsForCommit.some((candidate) => candidate.id === installation.id)) {
                      skillsForCommit.push(installation);
                    }
                  }
                  const extracted = extractProjectSkillSelection({
                    value: prompt,
                    mentions: skillsForCommit.map((installation) =>
                      projectSkillMention(installation, skillLabelFor(installation))
                    ),
                    defaultInstallationIds: defaultSkillIds,
                  });
                  patchNodeData(id, {
                    prompt: extracted.prompt,
                    skillSelection: extracted.selection,
                  });
                }}
                promptPlaceholder={t(promptPlaceholderKey(mode, modality))}
                promptAriaLabel={t(promptPlaceholderKey(mode, modality))}
                promptAutoFocus
                showPrompt={!model || hasSchemaProperty(model, "prompt")}
                mentions={mentionItems}
                skillMarketOptions={skillScope ? skillMarketOptions : undefined}
                skillMarketLoading={skillScope ? projectSkillCatalog.loading : false}
                skillMarketError={skillScope ? projectSkillCatalog.error : false}
                onMentionActivate={(mention) => {
                  if (mention.kind === "skill") {
                    pendingSkillApplyRef.current = null;
                    setDetailSkillIntent("inspect");
                    setDetailSkillId(mention.id);
                  }
                }}
                onSkillMarketRetry={projectSkillCatalog.retry}
                onOpenSkillMarket={(catalogId, applySkill) => {
                  pendingSkillApplyRef.current = applySkill;
                  setDetailSkillIntent("use");
                  setDetailSkillId(catalogId);
                }}
                referenceContent={
                  refFields.length > 0 ? (
                    <ReferenceStack
                      fields={refFields}
                      references={referencesForDisplay}
                      onOpenPicker={setAssetPickerField}
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
                canSubmit={canEdit && cardCanSubmit}
                submitting={busy}
                onSubmit={() => submit(id)}
                onCancel={() => cancel(id)}
                submitLabel={t("generate")}
                cancelLabel={t("cancelGeneration")}
                disabledReason={cardDisabledReason}
              />
            </div>
          </div>
        )}

      {/* Every card connects on both sides: "+" input on the left, "+" output on
          the right. The output port is tinted by the card's output kind. */}
      <PortPlus type="target" id="input" side="left" />
      <PortPlus type="source" id="output" side="right" dataType={modality} />
      <ProjectSkillDetailDialog
        open={detailSkillId !== null}
        skill={detailSkill}
        loading={projectSkillCatalog.loading}
        error={projectSkillCatalog.error}
        activeForGeneration={detailSkillIntent === "inspect" && Boolean(detailSkill)}
        actionPending={installSkillMutation.isPending}
        canInstall={projectSkillCatalog.data?.canManage ?? false}
        onRetry={projectSkillCatalog.retry}
        onOpenChange={(open) => {
          if (!open) {
            if (installSkillMutation.isPending) return;
            pendingSkillApplyRef.current = null;
            setDetailSkillIntent(null);
            setDetailSkillId(null);
          }
        }}
        onUse={detailSkillIntent === "use" ? useDetailSkill : undefined}
        onManage={(skillId) => {
          pendingSkillApplyRef.current = null;
          setDetailSkillIntent(null);
          setDetailSkillId(null);
          openSkills(skillId);
        }}
      />
      {assetPickerField ? (
        <AssetSelectDialog
          open
          projectId={owner.projectId}
          acceptedKinds={[assetPickerField.kind]}
          maxSelection={Math.max(
            1,
            assetPickerField.maxItems - (referencesForDisplay[assetPickerField.field]?.length ?? 0)
          )}
          onClose={() => setAssetPickerField(null)}
          onSelect={(item) => addAssetReference(assetPickerField, item)}
        />
      ) : null}
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

/** Audio generation card (`audio` node type). */
export const AudioNode = memo((props: NodeProps<GenerationNodeType>) => (
  <GenerationCardMemo {...props} modality="audio" />
));
AudioNode.displayName = "AudioNode";
