import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustments,
  IconArrowBarRight,
  IconArrowsMaximize,
  IconBoxMultiple,
  IconBrush,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconDownload,
  IconEye,
  IconFileText,
  IconLayoutGrid,
  IconMaximize,
  IconMicrophone,
  IconStar,
  IconTrash,
  IconUserCircle,
  IconWalk,
  IconZoomIn,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { RichMentionEditor } from "@/components/storyboard/editor/rich-mention-editor";
import {
  ReferenceMapProvider,
  type ReferenceMap,
} from "@/components/storyboard/editor/reference-map-context";
import {
  buildReferenceMap,
  extractMentionsFromHtml,
  autoSelectReferences,
} from "@/components/storyboard/editor/build-reference-map";
import { getModeRefConfig, countAllRefs, findAvailableSlot } from "./mode-ref-config";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import type { ToolbarAction } from "@/components/ui/floating-toolbar";
import { MediaPreviewPanel } from "../media-preview-panel";
import { ResultGallery } from "../result-gallery";
import { GenerateButton } from "@/components/ui/generate-button";
import { backendApi } from "@/src/lib/api";
import { useAppDispatch, useAppSelector } from "@/src/store";
import {
  selectCurrentInstance,
  initVideoInstance,
  loadVideoHistory,
  deleteVideoItem,
  updateVideoForm,
  setVideoUploadMode,
  setVideoEditMode,
  setVideoReferences,
  setVideoModeSettings,
  setVideoPreview,
  setVideoSavedModel,
  selectVideoInstance,
  selectVideoInstanceKey,
  makeSelectAllVideoResults,
} from "@/src/store/slices/projectSlice";
import {
  addTask,
  startTask,
  completeTask,
  failTask,
  removeTask,
  makeSelectTasksByShot,
  createTaskId,
  loadServerTasks,
  pollServerTasks,
} from "@/src/store/slices/taskSlice";

import type {
  AiVideoGeneratorDialogProps,
  EditMode,
  MultiRefType,
  PickerTarget,
  ReferenceAsset,
  SimpleMode,
  VideoMode,
  VideoResultItem,
} from "./video-types";
import {
  ensureVideoReference,
  MAX_CONCURRENT,
  ossUrl,
  parseVideoGenerateResult,
  toReferenceAssets,
} from "./video-types";
import { VideoReferencePanel } from "./video-reference-group";
import { ToolbarSelect, VideoModeSettings } from "./video-mode-settings";
/** Deduplicate reference assets by url/path */
function dedupeRefs(existing: ReferenceAsset[], newItems: ReferenceAsset[]): ReferenceAsset[] {
  const urls = new Set(existing.map((r) => r.url || r.path).filter(Boolean));
  return newItems.filter((item) => {
    const key = item.url || item.path;
    if (!key || urls.has(key)) return false;
    urls.add(key);
    return true;
  });
}

import {
  getSchemaFields,
  getModeConfig,
  buildModePayload,
  resolveModeInputs,
  type AiModel,
} from "@/components/ui/schema-field/schema";
import { useAiModels } from "@/src/hooks/use-ai-models";

// ─── Multimodal: schema-driven toolbar selects ──────

function MultimodalToolbarSelects({
  formData,
  onUpdate,
  models,
}: {
  formData: { model: string; size: string; videoLength: string; [k: string]: unknown };
  onUpdate: (updates: Record<string, unknown>) => void;
  models: AiModel[];
}) {
  const selectedModel = formData.model;
  const entry = useMemo(() => models.find((m) => m.id === selectedModel), [models, selectedModel]);

  // Auto-select first multimodal model + set schema defaults
  useEffect(() => {
    if (!entry && models.length > 0) {
      const defaultModel = models.find((m) => m.isDefault) ?? models[0];
      const defaults: Record<string, unknown> = { model: defaultModel.id };
      if (defaultModel.inputSchema) {
        for (const [fieldKey, field] of Object.entries(defaultModel.inputSchema.properties)) {
          if (field.default !== undefined) defaults[fieldKey] = String(field.default);
        }
      }
      onUpdate(defaults);
    }
  }, [entry, models, onUpdate]);

  // When model changes, reset params to defaults from schema
  const handleModelChange = useCallback(
    (newModel: string) => {
      const newEntry = models.find((m) => m.id === newModel);
      const defaults: Record<string, unknown> = { model: newModel };
      if (newEntry) {
        for (const [fieldKey, field] of Object.entries(newEntry.inputSchema.properties)) {
          if (field.default !== undefined) defaults[fieldKey] = String(field.default);
        }
      }
      onUpdate(defaults);
    },
    [models, onUpdate]
  );

  // Schema-driven fields
  const schemaFields = useMemo(() => {
    if (!entry?.inputSchema) return [];
    return getSchemaFields(entry.inputSchema);
  }, [entry]);

  return (
    <>
      <ToolbarSelect
        value={selectedModel}
        options={models.map((m) => ({ label: m.name, value: m.id }))}
        onChange={handleModelChange}
      />
      {schemaFields.map(([fieldKey, field]) => {
        const enumValues = field.enum ?? [];
        if (enumValues.length === 0) return null;
        const labels = field["x-enum-labels"] ?? {};
        const options = enumValues.map((v) => ({
          label: labels[String(v)] ?? String(v),
          value: String(v),
        }));
        const currentValue = String(formData[fieldKey] ?? field.default ?? "");
        return (
          <ToolbarSelect
            key={fieldKey}
            value={currentValue}
            options={options}
            onChange={(v) => onUpdate({ [fieldKey]: v })}
          />
        );
      })}
    </>
  );
}

function ActionChip({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : disabled
            ? "cursor-not-allowed border-border/50 text-muted-foreground/40"
            : "border-border/70 text-muted-foreground hover:border-primary/30 hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function AiVideoGeneratorDialog({
  open,
  onOpenChange,
  shotId,
  shotColumnId,
  shotNumber,
  defaultPrompt,
  defaultReferenceImage,
  referenceFields = [],
  appliedPaths = [],
  preferredPath,
  onCollect,
  onSetPreferred,
  onGeneratePrompt,
  onGeneratingChange,
  onGenerateSuccess,
  onPrevShot,
  onNextShot,
}: AiVideoGeneratorDialogProps) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const dispatch = useAppDispatch();
  const episodes = useAppSelector((s) => selectCurrentInstance(s).episodes);
  const activeEpisodeId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const activeEpisode = useMemo(
    () => episodes.find((episode) => String(episode.id) === String(activeEpisodeId)),
    [episodes, activeEpisodeId]
  );

  const key = selectVideoInstanceKey(shotId, shotColumnId);
  const instance = useAppSelector((s) => selectVideoInstance(s, shotId, shotColumnId));
  const selectResults = useMemo(() => makeSelectAllVideoResults(), []);
  const allResults = useAppSelector((s) => selectResults(s, shotId, shotColumnId));

  // Destructure instance state
  const {
    uploadMode,
    editMode,
    formData,
    references,
    modeSettings,
    history,
    historyLoading,
    previewItem,
    savedModel,
  } = instance;

  const { prompt, prefixPrompt, suffixPrompt, model, size, videoLength, count } = formData;

  const {
    referenceImages,
    firstFrames,
    lastFrames,
    multiRefImages,
    repaintRefVideos,
    repaintRefImage,
    localEditRefVideo,
    localEditMaskImage,
    localEditRefImage,
    extendFirstClip,
    extendLastClip,
    extendFirstFrame,
    extendLastFrame,
    outpaintingRefVideo,
  } = references;

  const {
    controlCondition,
    maskType,
    expandRatio,
    maskFrameId,
    outpaintingTop,
    outpaintingBottom,
    outpaintingLeft,
    outpaintingRight,
  } = modeSettings;

  // Local-only state
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const previousGeneratingRef = useRef(false);
  const previousSuccessCountRef = useRef(0);
  const initRef = useRef(false);

  // Queue: read pending/running video tasks from taskSlice
  const selectShotTasks = useMemo(() => makeSelectTasksByShot(), []);
  const allShotTasks = useAppSelector((s) => selectShotTasks(s, shotId, shotColumnId));
  const videoTasks = useMemo(() => allShotTasks.filter((t) => t.type === "video"), [allShotTasks]);
  const isGenerating = videoTasks.some((t) => t.status === "pending" || t.status === "running");
  const successCount = videoTasks.filter((t) => t.status === "completed").length;

  const activeMode = editMode ?? uploadMode;

  // Models from backend cache (keyed by mode's endpoint)
  const modeConfig = useMemo(() => getModeConfig(activeMode), [activeMode]);
  const { models: modeModels } = useAiModels(modeConfig?.endpoint ?? "");
  const currentModel = useMemo(() => modeModels.find((m) => m.id === model), [modeModels, model]);

  const sizeOptions = useMemo(() => {
    const sizeField = currentModel?.inputSchema?.properties?.size;
    if (!sizeField?.enum) return [];
    const labels = sizeField["x-enum-labels"] ?? {};
    return sizeField.enum.map((v) => ({ label: labels[String(v)] ?? String(v), value: String(v) }));
  }, [currentModel]);

  const videoLengthOptions = useMemo(() => {
    const vlField = currentModel?.inputSchema?.properties?.videoLength;
    if (!vlField?.enum) return [];
    const labels = vlField["x-enum-labels"] ?? {};
    return vlField.enum.map((v) => ({ label: labels[String(v)] ?? `${v}s`, value: String(v) }));
  }, [currentModel]);
  const previewUrl = previewItem?.url ?? "";
  const isPreviewApplied = previewItem?.storagePath
    ? appliedPaths.includes(previewItem.storagePath)
    : false;
  const isPreviewPreferred = previewItem?.storagePath === preferredPath;
  const previewBadge = isPreviewPreferred ? t("finalized") : isPreviewApplied ? t("used") : "";

  const videoToolbarActions: ToolbarAction[] = [
    onCollect && {
      key: "collect",
      icon: <IconStar className="size-4" />,
      active: isPreviewApplied,
      title: isPreviewApplied ? t("removeAction") : t("addToShotTitle"),
      onClick: () => previewItem && onCollect(previewItem),
    },
    onSetPreferred && {
      key: "prefer",
      icon: <IconCircleCheck className="size-4" />,
      active: isPreviewPreferred,
      title: t("setFinalize"),
      onClick: () => previewItem && onSetPreferred(previewItem),
    },
    {
      key: "download",
      icon: <IconDownload className="size-4" />,
      title: tc("download"),
      onClick: () => previewItem && handleDownload(previewItem),
    },
    {
      key: "delete",
      icon: <IconTrash className="size-4" />,
      title: tc("delete"),
      onClick: () => previewItem && void handleDelete(previewItem),
    },
    {
      key: "fullscreen",
      icon: <IconArrowsMaximize className="size-4" />,
      title: t("fullscreenPreview"),
      onClick: () => setFullscreenOpen(true),
    },
    previewItem?.other && {
      key: "meta",
      icon: <IconFileText className="size-4" />,
      title: t("viewDetails"),
      metaContent: previewItem.other,
    },
  ].filter(Boolean) as ToolbarAction[];
  const modelOptions = useMemo(
    () => modeModels.map((m) => ({ label: m.name, value: m.id })),
    [modeModels]
  );

  // Base cost from backend model data (full pricing TBD — backend will add pricing field)
  const cost = useMemo(() => {
    return (currentModel?.cost ?? 0) * (count || 1);
  }, [currentModel, count]);

  const title = shotNumber ? t("aiVideoTitle", { number: shotNumber }) : t("aiVideoTitleDefault");
  const modeExitLabel = editMode
    ? editMode === "outpainting"
      ? t("exitOutpainting")
      : editMode === "extend"
        ? t("exitExtend")
        : editMode === "localEdit"
          ? t("exitLocalEdit")
          : t("exitRepaint")
    : "";

  // ─── Initialization effect ────────────────────────────

  useEffect(() => {
    if (!open) {
      initRef.current = false;
      return;
    }
    if (initRef.current) {
      // Already initialized, just reload history + server tasks
      void dispatch(loadVideoHistory({ shotId, colId: shotColumnId }));
      void dispatch(loadServerTasks({ shotColumnId }));
      // Sync defaultReferenceImage if cell image changed since last open
      if (defaultReferenceImage) {
        const refs = instance?.references?.referenceImages ?? [];
        const alreadyHas = refs.some((r) => r.path === defaultReferenceImage);
        if (!alreadyHas) {
          dispatch(
            setVideoReferences({
              key,
              field: "referenceImages",
              value: [
                { url: ossUrl(defaultReferenceImage) ?? "", path: defaultReferenceImage },
                ...refs,
              ],
            })
          );
        }
      }
      return;
    }
    initRef.current = true;

    void dispatch(loadServerTasks({ shotColumnId }));
    void dispatch(
      initVideoInstance({
        shotId,
        colId: shotColumnId,
        opts: {
          defaultPrompt,
          defaultReferenceImage,
          prefixPrompt: String(activeEpisode?.frontPrompt ?? ""),
          suffixPrompt: String(activeEpisode?.behindPrompt ?? ""),
        },
      })
    );
  }, [
    open,
    dispatch,
    shotId,
    shotColumnId,
    defaultPrompt,
    defaultReferenceImage,
    activeEpisode?.frontPrompt,
    activeEpisode?.behindPrompt,
  ]);

  // ─── Load/select models when activeMode changes ────────

  useEffect(() => {
    if (!open) return;
    // Auto-select default model + schema defaults when mode changes
    const matched = modeModels.find((m) => m.id === model);
    if (!matched) {
      const defaultModel = modeModels.find((m) => m.isDefault) ?? modeModels[0];
      if (defaultModel) {
        const updates: Record<string, unknown> = { model: defaultModel.id };
        for (const [fieldKey, field] of Object.entries(defaultModel.inputSchema.properties)) {
          if (field.default !== undefined) updates[fieldKey] = String(field.default);
        }
        dispatch(updateVideoForm({ key, updates }));
      }
    }
  }, [activeMode, dispatch, key, model, open, modeModels]);

  // ─── Queue processing: pick up pending tasks and run them ──

  useEffect(() => {
    if (!open && videoTasks.length === 0) return;

    const runningCount = videoTasks.filter((t) => t.status === "running").length;
    if (runningCount >= MAX_CONCURRENT) return;

    const nextTask = videoTasks.find((t) => t.status === "pending");
    if (!nextTask) return;

    dispatch(startTask(nextTask.id));

    void (async () => {
      try {
        const params = nextTask.input as Record<string, unknown>;
        const modeKey = String(params.mode ?? "reference");
        const modeConfig = getModeConfig(modeKey);
        if (!modeConfig) {
          console.error(`[VideoDialog] Unknown video mode: ${modeKey}`);
          dispatch(failTask({ taskId: nextTask.id, error: `Unknown mode: ${modeKey}` }));
          return;
        }

        const endpoint = modeConfig.endpoint;
        const payload = buildModePayload(modeConfig, params, shotId, shotColumnId);

        // All modes are async: POST returns taskId
        const result = await backendApi.post<unknown>(endpoint, {
          data: payload,
          timeout: 60_000,
        });
        const remoteId = String(result);

        // Replace local task with server-tracked task
        dispatch(removeTask(nextTask.id));
        dispatch(
          addTask({
            id: remoteId,
            source: "server",
            type: "video",
            shotId,
            shotColumnId,
            input: nextTask.input,
          })
        );
        dispatch(startTask(remoteId));
      } catch (error) {
        const message = error instanceof Error ? error.message : "\u751F\u6210\u5931\u8D25";
        dispatch(failTask({ taskId: nextTask.id, error: message }));
      }
    })();
  }, [open, videoTasks, shotId, shotColumnId, dispatch, key, previewItem]);

  // ─── Poll server tasks while dialog is open & tasks are generating ──

  const hasServerGenerating = videoTasks.some(
    (t) => t.source === "server" && (t.status === "pending" || t.status === "running")
  );

  useEffect(() => {
    if (!open || !hasServerGenerating) return;

    const interval = setInterval(() => {
      void dispatch(pollServerTasks());
    }, 5000);

    return () => clearInterval(interval);
  }, [open, hasServerGenerating, dispatch]);

  // When server tasks finish generating, refresh history once
  const prevServerGenerating = useRef(hasServerGenerating);
  useEffect(() => {
    if (prevServerGenerating.current && !hasServerGenerating && open) {
      void dispatch(loadVideoHistory({ shotId, colId: shotColumnId }));
    }
    prevServerGenerating.current = hasServerGenerating;
  }, [hasServerGenerating, open, dispatch, shotId, shotColumnId]);

  // ─── Sync size/videoLength with available options ─────

  useEffect(() => {
    if (!sizeOptions.length) {
      if (size) dispatch(updateVideoForm({ key, updates: { size: "" } }));
      return;
    }
    if (!size || !sizeOptions.some((item: { value: string }) => item.value === size)) {
      dispatch(updateVideoForm({ key, updates: { size: sizeOptions[0]?.value ?? "" } }));
    }
  }, [dispatch, key, size, sizeOptions]);

  useEffect(() => {
    if (!videoLengthOptions.length) {
      if (videoLength) dispatch(updateVideoForm({ key, updates: { videoLength: "" } }));
      return;
    }
    if (
      !videoLength ||
      !videoLengthOptions.some((item: { value: string }) => item.value === videoLength)
    ) {
      dispatch(
        updateVideoForm({ key, updates: { videoLength: videoLengthOptions[0]?.value ?? "" } })
      );
    }
  }, [dispatch, key, videoLength, videoLengthOptions]);

  // ─── Notify parent about generating state ─────────────

  useEffect(() => {
    onGeneratingChange?.(isGenerating);

    if (
      previousGeneratingRef.current &&
      !isGenerating &&
      successCount > previousSuccessCountRef.current
    ) {
      onGenerateSuccess?.();
    }

    previousGeneratingRef.current = isGenerating;
    previousSuccessCountRef.current = successCount;
  }, [isGenerating, onGenerateSuccess, onGeneratingChange, successCount]);

  // ─── Handlers ─────────────────────────────────────────

  const handleDelete = async (item: VideoResultItem) => {
    try {
      await dispatch(deleteVideoItem({ shotId, colId: shotColumnId, item })).unwrap();
    } catch (error) {
      console.error("[AiVideoGeneratorDialog] \u5220\u9664\u5931\u8D25:", error);
      toast.error(tc("deleteFailed"));
    }
  };

  const handleRetry = (item: VideoResultItem) => {
    // For task-based items, we could re-dispatch. For now we rely on the task's
    // built-in retry mechanism (retryTask).
    if (item.fromQueue) {
      const task = videoTasks.find((t) => t.id === item.id);
      if (task) {
        // Remove old task and re-add as pending
        dispatch(
          addTask({
            type: "video",
            shotId,
            shotColumnId,
            input: task.input,
          })
        );
      }
    }
  };

  const handleDownload = (item: VideoResultItem) => {
    const url = item.url;
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "";
    anchor.click();
  };

  const resetEditModeRefs = useCallback(() => {
    dispatch(setVideoReferences({ key, field: "repaintRefVideos", value: [] }));
    dispatch(setVideoReferences({ key, field: "repaintRefImage", value: [] }));
    dispatch(setVideoReferences({ key, field: "localEditRefVideo", value: [] }));
    dispatch(setVideoReferences({ key, field: "localEditMaskImage", value: [] }));
    dispatch(setVideoReferences({ key, field: "localEditRefImage", value: [] }));
    dispatch(setVideoReferences({ key, field: "extendFirstClip", value: [] }));
    dispatch(setVideoReferences({ key, field: "extendLastClip", value: [] }));
    dispatch(setVideoReferences({ key, field: "extendFirstFrame", value: [] }));
    dispatch(setVideoReferences({ key, field: "extendLastFrame", value: [] }));
    dispatch(setVideoReferences({ key, field: "outpaintingRefVideo", value: [] }));
    dispatch(
      setVideoModeSettings({
        key,
        updates: {
          controlCondition: "posebodyface",
          maskType: "tracking",
          expandRatio: 0.5,
          maskFrameId: "",
          outpaintingTop: 1,
          outpaintingBottom: 1,
          outpaintingLeft: 1,
          outpaintingRight: 1,
        },
      })
    );
  }, [dispatch, key]);

  const exitEditMode = useCallback(async () => {
    resetEditModeRefs();
    dispatch(setVideoEditMode({ key, mode: null }));

    if (savedModel) {
      dispatch(updateVideoForm({ key, updates: { model: savedModel } }));
      dispatch(setVideoSavedModel({ key, model: "" }));
      return;
    }

    // Model selection handled by the mode-change effect
  }, [dispatch, key, resetEditModeRefs, savedModel, uploadMode]);

  const enterEditMode = useCallback(
    async (nextMode: EditMode) => {
      if (editMode === nextMode) {
        await exitEditMode();
        return;
      }

      if (!previewItem) {
        toast.warning(t("selectVideoResult"));
        return;
      }

      const previewRef = ensureVideoReference(previewItem);

      // Save current model so we can restore on exit
      dispatch(setVideoSavedModel({ key, model }));

      // Reset edit-mode references and settings
      resetEditModeRefs();

      dispatch(setVideoEditMode({ key, mode: nextMode }));

      // Set the preview video as the reference for the new edit mode
      if (nextMode === "repaint") {
        dispatch(setVideoReferences({ key, field: "repaintRefVideos", value: previewRef }));
      } else if (nextMode === "localEdit") {
        dispatch(setVideoReferences({ key, field: "localEditRefVideo", value: previewRef }));
      } else if (nextMode === "extend") {
        dispatch(setVideoReferences({ key, field: "extendFirstClip", value: previewRef }));
      } else if (nextMode === "outpainting") {
        dispatch(setVideoReferences({ key, field: "outpaintingRefVideo", value: previewRef }));
      }

      // Model selection handled by the mode-change effect
    },
    [dispatch, editMode, exitEditMode, key, model, previewItem, resetEditModeRefs, t]
  );

  const handleUploadModeChange = useCallback(
    async (nextMode: SimpleMode) => {
      if (editMode) {
        await exitEditMode();
      }
      dispatch(setVideoUploadMode({ key, mode: nextMode }));
    },
    [dispatch, editMode, exitEditMode, key]
  );

  const handlePickerSelect = useCallback(
    (paths: string[]) => {
      const target = pickerTarget;
      setPickerTarget(null);
      if (!target || paths.length === 0) return;

      switch (target) {
        case "referenceImages":
          dispatch(
            setVideoReferences({
              key,
              field: "referenceImages",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        case "firstFrames":
          dispatch(
            setVideoReferences({
              key,
              field: "firstFrames",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        case "lastFrames":
          dispatch(
            setVideoReferences({
              key,
              field: "lastFrames",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        case "multimodalImages": {
          const newRefs = dedupeRefs(referenceImages, toReferenceAssets(paths));
          dispatch(
            setVideoReferences({
              key,
              field: "referenceImages",
              value: [...referenceImages, ...newRefs].slice(0, 9),
            })
          );
          break;
        }
        case "multimodalVideos": {
          const newVids = dedupeRefs(firstFrames, toReferenceAssets(paths));
          dispatch(
            setVideoReferences({
              key,
              field: "firstFrames",
              value: [...firstFrames, ...newVids].slice(0, 3),
            })
          );
          break;
        }
        case "multiRefSubject":
          dispatch(
            setVideoReferences({
              key,
              field: "multiRefImages",
              value: [
                ...multiRefImages.filter((item) => item.typeTag === "bg"),
                ...(toReferenceAssets(paths.slice(0, 1), "obj") as (ReferenceAsset & {
                  typeTag: MultiRefType;
                })[]),
              ],
            })
          );
          break;
        case "multiRefBg":
          dispatch(
            setVideoReferences({
              key,
              field: "multiRefImages",
              value: [
                ...multiRefImages.filter((item) => item.typeTag !== "bg"),
                ...(toReferenceAssets(paths.slice(0, 2), "bg") as (ReferenceAsset & {
                  typeTag: MultiRefType;
                })[]),
              ],
            })
          );
          break;
        case "repaintVideo":
          dispatch(
            setVideoReferences({
              key,
              field: "repaintRefVideos",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        case "repaintImage":
          dispatch(
            setVideoReferences({
              key,
              field: "repaintRefImage",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        case "localEditVideo":
          dispatch(
            setVideoReferences({
              key,
              field: "localEditRefVideo",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        case "localEditMask":
          dispatch(
            setVideoReferences({
              key,
              field: "localEditMaskImage",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        case "localEditRefImage":
          dispatch(
            setVideoReferences({
              key,
              field: "localEditRefImage",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        case "extendFirstClip":
          dispatch(
            setVideoReferences({
              key,
              field: "extendFirstClip",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        case "extendLastClip":
          dispatch(
            setVideoReferences({
              key,
              field: "extendLastClip",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        case "extendFirstFrame":
          dispatch(
            setVideoReferences({
              key,
              field: "extendFirstFrame",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        case "extendLastFrame":
          dispatch(
            setVideoReferences({
              key,
              field: "extendLastFrame",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        case "outpaintingVideo":
          dispatch(
            setVideoReferences({
              key,
              field: "outpaintingRefVideo",
              value: toReferenceAssets(paths.slice(0, 1)),
            })
          );
          break;
        default:
          break;
      }
    },
    [dispatch, key, multiRefImages, pickerTarget]
  );

  const pickerConfig = useMemo(() => {
    switch (pickerTarget) {
      case "referenceImages":
      case "firstFrames":
      case "lastFrames":
      case "repaintImage":
      case "localEditMask":
      case "localEditRefImage":
      case "extendFirstFrame":
      case "extendLastFrame":
        return { assetType: "img" as const, multiple: false };
      case "multiRefBg":
        return { assetType: "img" as const, multiple: true };
      case "multiRefSubject":
        return { assetType: "img" as const, multiple: false };
      case "multimodalImages":
        return { assetType: ["img", "video", "audio"] as const, multiple: true };
      case "multimodalVideos":
        return { assetType: "video" as const, multiple: true };
      case "multimodalAudios":
        return { assetType: "audio" as const, multiple: true };
      case "repaintVideo":
      case "localEditVideo":
      case "extendFirstClip":
      case "extendLastClip":
      case "outpaintingVideo":
        return { assetType: "video" as const, multiple: false };
      default:
        return null;
    }
  }, [pickerTarget]);

  const handleGenerate = () => {
    const fullPrompt = [prefixPrompt.trim(), prompt.trim(), suffixPrompt.trim()]
      .filter(Boolean)
      .join("\n");
    if (!fullPrompt) {
      toast.warning(t("enterVideoPrompt"));
      return;
    }

    const modeConfig = getModeConfig(activeMode);
    if (!modeConfig) return;

    // Resolve mode-specific inputs from state via schema config
    const { params: modeParams, error } = resolveModeInputs(
      modeConfig,
      references as Record<string, { path: string; url?: string; typeTag?: string }[]>,
      formData as Record<string, unknown>,
      modeSettings as Record<string, unknown>,
      ossUrl
    );

    if (error) {
      toast.warning(t(error.errorKey));
      return;
    }

    onGeneratePrompt?.(prompt.trim());

    const inputBase: Record<string, unknown> = {
      prompt: fullPrompt,
      mode: activeMode,
      model: model || undefined,
      size: size || undefined,
      videoLength: videoLength ? Number(videoLength) : undefined,
      ...modeParams,
    };

    for (let i = 0; i < Math.max(1, count); i++) {
      dispatch(
        addTask({
          type: "video",
          shotId,
          shotColumnId,
          input: { ...inputBase },
        })
      );
    }

    toast.success(t("addedVideoTasks", { count: Math.max(1, count) }));
  };

  // ─── Reference setter callbacks for VideoReferencePanel ──

  const onSetReferenceImages = useCallback(
    (v: ReferenceAsset[]) =>
      dispatch(setVideoReferences({ key, field: "referenceImages", value: v })),
    [dispatch, key]
  );
  const onSetFirstFrames = useCallback(
    (v: ReferenceAsset[]) => dispatch(setVideoReferences({ key, field: "firstFrames", value: v })),
    [dispatch, key]
  );
  const onSetLastFrames = useCallback(
    (v: ReferenceAsset[]) => dispatch(setVideoReferences({ key, field: "lastFrames", value: v })),
    [dispatch, key]
  );
  const onSetMultiRefImages = useCallback(
    (v: (ReferenceAsset & { typeTag: MultiRefType })[]) =>
      dispatch(setVideoReferences({ key, field: "multiRefImages", value: v })),
    [dispatch, key]
  );
  const onSetRepaintRefVideos = useCallback(
    (v: ReferenceAsset[]) =>
      dispatch(setVideoReferences({ key, field: "repaintRefVideos", value: v })),
    [dispatch, key]
  );
  const onSetRepaintRefImage = useCallback(
    (v: ReferenceAsset[]) =>
      dispatch(setVideoReferences({ key, field: "repaintRefImage", value: v })),
    [dispatch, key]
  );
  const onSetLocalEditRefVideo = useCallback(
    (v: ReferenceAsset[]) =>
      dispatch(setVideoReferences({ key, field: "localEditRefVideo", value: v })),
    [dispatch, key]
  );
  const onSetLocalEditMaskImage = useCallback(
    (v: ReferenceAsset[]) =>
      dispatch(setVideoReferences({ key, field: "localEditMaskImage", value: v })),
    [dispatch, key]
  );
  const onSetLocalEditRefImage = useCallback(
    (v: ReferenceAsset[]) =>
      dispatch(setVideoReferences({ key, field: "localEditRefImage", value: v })),
    [dispatch, key]
  );
  const onSetExtendFirstClip = useCallback(
    (v: ReferenceAsset[]) =>
      dispatch(setVideoReferences({ key, field: "extendFirstClip", value: v })),
    [dispatch, key]
  );
  const onSetExtendLastClip = useCallback(
    (v: ReferenceAsset[]) =>
      dispatch(setVideoReferences({ key, field: "extendLastClip", value: v })),
    [dispatch, key]
  );
  const onSetExtendFirstFrame = useCallback(
    (v: ReferenceAsset[]) =>
      dispatch(setVideoReferences({ key, field: "extendFirstFrame", value: v })),
    [dispatch, key]
  );
  const onSetExtendLastFrame = useCallback(
    (v: ReferenceAsset[]) =>
      dispatch(setVideoReferences({ key, field: "extendLastFrame", value: v })),
    [dispatch, key]
  );
  const onSetOutpaintingRefVideo = useCallback(
    (v: ReferenceAsset[]) =>
      dispatch(setVideoReferences({ key, field: "outpaintingRefVideo", value: v })),
    [dispatch, key]
  );

  // ─── Mode-aware reference config ──
  const modeRefConfig = useMemo(() => getModeRefConfig(activeMode), [activeMode]);
  const refTotalCount = useMemo(
    () => countAllRefs(references as unknown as Record<string, unknown[]>, modeRefConfig),
    [references, modeRefConfig]
  );
  const refIsFull = refTotalCount >= modeRefConfig.totalMax;

  // ─── Auto-add @mentioned character images to available slot ──
  const handleMentionInserted = useCallback(
    (item: { imgUrl?: string; name: string; mentionType: string }) => {
      if (!item.imgUrl) return;

      // Check duplicates across all slots
      const allRefs = modeRefConfig.slots.flatMap((slot) => {
        const arr = (references as Record<string, ReferenceAsset[]>)[slot.field];
        return Array.isArray(arr) ? arr : [];
      });
      if (allRefs.some((r) => (r.url || ossUrl(r.path)) === item.imgUrl)) return;

      // Find available slot for this media type
      const mediaType = /\.(mp4|webm|mov)(\?|$)/i.test(item.imgUrl)
        ? ("video" as const)
        : /\.(mp3|wav|ogg|aac)(\?|$)/i.test(item.imgUrl)
          ? ("audio" as const)
          : ("image" as const);
      const slot = findAvailableSlot(
        references as unknown as Record<string, unknown[]>,
        modeRefConfig,
        mediaType
      );
      if (!slot) {
        toast.warning(t("referenceGroupFull"));
        return;
      }

      const existing = (references as Record<string, ReferenceAsset[]>)[slot.field] ?? [];
      dispatch(
        setVideoReferences({
          key,
          field: slot.field,
          value: [...existing, { url: item.imgUrl, path: item.imgUrl, label: item.name }],
        })
      );
    },
    [dispatch, key, references, modeRefConfig, t]
  );

  // ─── Backfill: prompt → reference group (on open + mode switch) ──
  const backfillRefsFromPrompt = useCallback(() => {
    const mentionRegex = /<mention\s+[^>]*imgUrl="([^"]+)"[^>]*>([^<]*)<\/mention>/gi;
    let match: RegExpExecArray | null;
    const existing = new Set(referenceImages.map((r) => r.url || ossUrl(r.path)));
    const newItems: { url: string; path: string; label: string }[] = [];
    const available = modeRefConfig.totalMax - refTotalCount;

    while ((match = mentionRegex.exec(prompt)) !== null && newItems.length < available) {
      const url = match[1];
      const label = match[2] || url.split("/").pop() || "media";
      if (url && !existing.has(url)) {
        existing.add(url);
        newItems.push({ url, path: url, label });
      }
    }

    if (newItems.length > 0) {
      dispatch(
        setVideoReferences({
          key,
          field: "referenceImages",
          value: [...referenceImages, ...newItems],
        })
      );
    }
  }, [dispatch, key, prompt, referenceImages, uploadMode]);

  // ─── Backfill reference group from prompt mentions on open + mode switch ──
  // Also truncate reference group when maxCount decreases on mode switch
  const backfillKeyRef = useRef("");
  useEffect(() => {
    if (!open) {
      backfillKeyRef.current = "";
      return;
    }
    const backfillKey = `${activeMode}`;
    if (backfillKeyRef.current === backfillKey) return;
    backfillKeyRef.current = backfillKey;

    // Only backfill for modes that have referenceImages slot
    const refSlot = modeRefConfig.slots.find((s) => s.field === "referenceImages");
    if (!refSlot) return;

    // Truncate if over limit
    if (referenceImages.length > refSlot.maxCount) {
      dispatch(
        setVideoReferences({
          key,
          field: "referenceImages",
          value: referenceImages.slice(0, refSlot.maxCount),
        })
      );
      return;
    }

    // Backfill from prompt mentions
    if (prompt && prompt.includes("<mention")) {
      backfillRefsFromPrompt();
    }
  }, [
    open,
    prompt,
    activeMode,
    uploadMode,
    referenceImages,
    backfillRefsFromPrompt,
    dispatch,
    key,
  ]);

  // ─── Reference map: sync prompt chips ↔ reference group ──
  const promptMentions = useMemo(() => extractMentionsFromHtml(prompt), [prompt]);
  const allActiveRefs = useMemo(() => {
    return modeRefConfig.slots.flatMap((slot) => {
      const arr = (references as Record<string, ReferenceAsset[]>)[slot.field];
      return Array.isArray(arr) ? arr : [];
    });
  }, [references, modeRefConfig]);
  const referenceMap: ReferenceMap = useMemo(
    () => buildReferenceMap(allActiveRefs, promptMentions),
    [allActiveRefs, promptMentions]
  );
  const referenceMapCtx = useMemo(
    () => ({ map: referenceMap, isFull: refIsFull }),
    [referenceMap, refIsFull]
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex w-245 sm:max-w-245 flex-col overflow-visible p-0"
          style={{ height: "min(860px, 90vh)" }}
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
            <div className="flex min-h-0 flex-4 flex-col overflow-auto">
              <ResultGallery
                items={allResults}
                loading={historyLoading}
                showActions={false}
                appliedPaths={appliedPaths}
                preferredPath={preferredPath}
                previewItemId={previewItem?.id}
                onPreview={(item) =>
                  dispatch(setVideoPreview({ key, item: item as VideoResultItem }))
                }
                onDelete={(item) => void handleDelete(item as VideoResultItem)}
                onCollect={onCollect}
                onSetPreferred={onSetPreferred}
                onDownload={(item) => handleDownload(item as VideoResultItem)}
                onRetry={(item) => handleRetry(item as VideoResultItem)}
                mediaType="video"
                columns={2}
                aspectRatio="video"
              />
            </div>

            <MediaPreviewPanel
              type="video"
              previewUrl={previewUrl}
              badge={previewBadge}
              emptyText={t("videoClickPreview")}
              className="min-h-0 flex-[6]"
              toolbarActions={videoToolbarActions}
              bottomActions={[
                {
                  key: "repaint",
                  icon: <IconBrush className="size-3.5" />,
                  label: t("videoRepaint"),
                  active: editMode === "repaint",
                  onClick: () => void enterEditMode("repaint"),
                },
                {
                  key: "localEdit",
                  icon: <IconBoxMultiple className="size-3.5" />,
                  label: t("videoLocalEdit"),
                  active: editMode === "localEdit",
                  onClick: () => void enterEditMode("localEdit"),
                },
                {
                  key: "adjustments",
                  icon: <IconAdjustments className="size-3.5" />,
                  label: t("videoChangeAttribute"),
                  disabled: true,
                },
                {
                  key: "storyboard",
                  icon: <IconLayoutGrid className="size-3.5" />,
                  label: t("videoCustomShot"),
                  disabled: true,
                },
                {
                  key: "extend",
                  icon: <IconArrowBarRight className="size-3.5" />,
                  label: t("videoExtend"),
                  active: editMode === "extend",
                  onClick: () => void enterEditMode("extend"),
                },
                {
                  key: "outpainting",
                  icon: <IconMaximize className="size-3.5" />,
                  label: t("videoOutpainting"),
                  active: editMode === "outpainting",
                  onClick: () => void enterEditMode("outpainting"),
                },
                {
                  key: "viewSwitch",
                  icon: <IconEye className="size-3.5" />,
                  label: t("videoAngleSwitch"),
                  disabled: true,
                },
                {
                  key: "faceSwap",
                  icon: <IconUserCircle className="size-3.5" />,
                  label: t("videoFaceSwap"),
                  disabled: true,
                },
                {
                  key: "motionTransfer",
                  icon: <IconWalk className="size-3.5" />,
                  label: t("videoMotionTransfer"),
                  disabled: true,
                },
                {
                  key: "upscale",
                  icon: <IconZoomIn className="size-3.5" />,
                  label: t("videoSuperRes"),
                  disabled: true,
                },
                {
                  key: "lipsync",
                  icon: <IconMicrophone className="size-3.5" />,
                  label: t("videoLipSync"),
                  disabled: true,
                },
              ]}
            />
          </div>

          <div className="overflow-visible rounded-xl bg-muted/50">
            <div className="relative z-10 flex items-start justify-between gap-3 px-4 py-3 -mt-6">
              <div className="flex flex-wrap items-center gap-2">
                <VideoReferencePanel
                  uploadMode={uploadMode}
                  editMode={editMode}
                  referenceImages={referenceImages}
                  firstFrames={firstFrames}
                  lastFrames={lastFrames}
                  multiRefImages={multiRefImages}
                  repaintRefVideos={repaintRefVideos}
                  repaintRefImage={repaintRefImage}
                  localEditRefVideo={localEditRefVideo}
                  localEditMaskImage={localEditMaskImage}
                  localEditRefImage={localEditRefImage}
                  extendFirstClip={extendFirstClip}
                  extendLastClip={extendLastClip}
                  extendFirstFrame={extendFirstFrame}
                  extendLastFrame={extendLastFrame}
                  outpaintingRefVideo={outpaintingRefVideo}
                  onOpenPicker={setPickerTarget}
                  onSetReferenceImages={onSetReferenceImages}
                  onSetFirstFrames={onSetFirstFrames}
                  onSetLastFrames={onSetLastFrames}
                  onSetMultiRefImages={onSetMultiRefImages}
                  onSetRepaintRefVideos={onSetRepaintRefVideos}
                  onSetRepaintRefImage={onSetRepaintRefImage}
                  onSetLocalEditRefVideo={onSetLocalEditRefVideo}
                  onSetLocalEditMaskImage={onSetLocalEditMaskImage}
                  onSetLocalEditRefImage={onSetLocalEditRefImage}
                  onSetExtendFirstClip={onSetExtendFirstClip}
                  onSetExtendLastClip={onSetExtendLastClip}
                  onSetExtendFirstFrame={onSetExtendFirstFrame}
                  onSetExtendLastFrame={onSetExtendLastFrame}
                  onSetOutpaintingRefVideo={onSetOutpaintingRefVideo}
                />
              </div>
              {editMode ? (
                <button
                  type="button"
                  onClick={() => void exitEditMode()}
                  className="shrink-0 rounded-full bg-white/[0.06] px-3 py-2 text-xs text-white/75 transition-colors hover:bg-white/[0.1] hover:text-white"
                >
                  {modeExitLabel}
                </button>
              ) : null}
            </div>

            {referenceFields.length > 0 ? (
              <div className="flex flex-wrap gap-1 px-4 pt-2">
                {referenceFields.map((name) => (
                  <span
                    key={name}
                    className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                  >
                    {name}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="px-4 pt-2">
              <div className="flex items-center">
                <div className="mr-2 h-4 w-0.5 rounded-full bg-primary/40" />
                <input
                  type="text"
                  value={prefixPrompt}
                  onChange={(event) =>
                    dispatch(
                      updateVideoForm({ key, updates: { prefixPrompt: event.target.value } })
                    )
                  }
                  placeholder={t("prefixPromptPlaceholder")}
                  className="flex-1 bg-transparent text-xs text-foreground/80 outline-none placeholder:text-muted-foreground/40"
                />
              </div>
            </div>

            <div className="px-4 py-2">
              <ReferenceMapProvider value={referenceMapCtx}>
                <RichMentionEditor
                  value={prompt}
                  onChange={(v) => dispatch(updateVideoForm({ key, updates: { prompt: v } }))}
                  placeholder={t("videoPromptEditorPlaceholder")}
                  mentionTypes={["character", "scene", "prop"]}
                  minHeight={96}
                  maxHeight={240}
                  className="[&_[contenteditable]]:text-sm [&_[contenteditable]]:leading-relaxed [&_[contenteditable]]:text-foreground [&_[contenteditable]]:outline-none"
                  referenceMedia={referenceImages.map((r) => ({
                    url: r.url || ossUrl(r.path),
                    path: r.path,
                    label: r.label || r.path.split("/").pop() || "media",
                  }))}
                  onMentionInserted={handleMentionInserted}
                  mentionDisabled={refIsFull}
                />
              </ReferenceMapProvider>
            </div>

            <div className="px-4 pb-2">
              <div className="flex items-center">
                <div className="mr-2 h-4 w-0.5 rounded-full bg-primary/40" />
                <input
                  type="text"
                  value={suffixPrompt}
                  onChange={(event) =>
                    dispatch(
                      updateVideoForm({ key, updates: { suffixPrompt: event.target.value } })
                    )
                  }
                  placeholder={t("suffixPromptPlaceholder")}
                  className="flex-1 bg-transparent text-xs text-foreground/80 outline-none placeholder:text-muted-foreground/40"
                />
              </div>
            </div>

            <VideoModeSettings
              editMode={editMode}
              controlCondition={controlCondition}
              onControlConditionChange={(v) =>
                dispatch(setVideoModeSettings({ key, updates: { controlCondition: v } }))
              }
              maskType={maskType}
              onMaskTypeChange={(v) =>
                dispatch(setVideoModeSettings({ key, updates: { maskType: v } }))
              }
              expandRatio={expandRatio}
              onExpandRatioChange={(v) =>
                dispatch(setVideoModeSettings({ key, updates: { expandRatio: v } }))
              }
              maskFrameId={maskFrameId}
              onMaskFrameIdChange={(v) =>
                dispatch(setVideoModeSettings({ key, updates: { maskFrameId: v } }))
              }
              outpaintingTop={outpaintingTop}
              outpaintingBottom={outpaintingBottom}
              outpaintingLeft={outpaintingLeft}
              outpaintingRight={outpaintingRight}
              onOutpaintingChange={(direction, value) => {
                switch (direction) {
                  case "top":
                    dispatch(setVideoModeSettings({ key, updates: { outpaintingTop: value } }));
                    break;
                  case "bottom":
                    dispatch(setVideoModeSettings({ key, updates: { outpaintingBottom: value } }));
                    break;
                  case "left":
                    dispatch(setVideoModeSettings({ key, updates: { outpaintingLeft: value } }));
                    break;
                  case "right":
                    dispatch(setVideoModeSettings({ key, updates: { outpaintingRight: value } }));
                    break;
                }
              }}
            />

            <div className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {!editMode && (
                  <ToolbarSelect
                    value={uploadMode}
                    options={[
                      { label: t("referenceImageUpload"), value: "reference" },
                      { label: t("framesTab"), value: "frames" },
                      { label: t("multiReferenceTab"), value: "multiReference" },
                      { label: t("multimodalTab"), value: "multimodal" },
                    ]}
                    onChange={(v) => void handleUploadModeChange(v as SimpleMode)}
                  />
                )}
                {uploadMode === "multimodal" && !editMode ? (
                  <MultimodalToolbarSelects
                    formData={formData}
                    onUpdate={(updates) => dispatch(updateVideoForm({ key, updates }))}
                    models={modeModels}
                  />
                ) : (
                  <>
                    <ToolbarSelect
                      value={model}
                      options={modelOptions}
                      onChange={(v) => dispatch(updateVideoForm({ key, updates: { model: v } }))}
                    />
                    <ToolbarSelect
                      value={size}
                      options={sizeOptions}
                      onChange={(v) => dispatch(updateVideoForm({ key, updates: { size: v } }))}
                    />
                    <ToolbarSelect
                      value={videoLength}
                      options={videoLengthOptions}
                      onChange={(v) =>
                        dispatch(updateVideoForm({ key, updates: { videoLength: v } }))
                      }
                    />
                  </>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <ToolbarSelect
                  value={String(count)}
                  options={[
                    { label: "1x", value: "1" },
                    { label: "2x", value: "2" },
                    { label: "4x", value: "4" },
                  ]}
                  onChange={(value) =>
                    dispatch(updateVideoForm({ key, updates: { count: Number(value) } }))
                  }
                />

                <GenerateButton onClick={handleGenerate} cost={cost > 0 ? cost : undefined} />
              </div>
            </div>
          </div>
          {onPrevShot ? (
            <button
              type="button"
              onClick={onPrevShot}
              className="fixed top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-white/20"
              style={{ left: "calc(50% - 554px)" }}
            >
              <IconChevronLeft className="size-5" />
            </button>
          ) : null}
          {onNextShot ? (
            <button
              type="button"
              onClick={onNextShot}
              className="fixed top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-white/20"
              style={{ right: "calc(50% - 554px)" }}
            >
              <IconChevronRight className="size-5" />
            </button>
          ) : null}
        </DialogContent>
      </Dialog>

      {pickerConfig ? (
        <AssetPickerDialog
          open={Boolean(pickerTarget)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setPickerTarget(null);
          }}
          assetType={pickerConfig.assetType}
          multiple={pickerConfig.multiple}
          onSelect={handlePickerSelect}
        />
      ) : null}

      <MediaPreviewModal
        open={fullscreenOpen}
        onOpenChange={setFullscreenOpen}
        type="video"
        src={previewUrl}
        name={previewItem?.storagePath?.split("/").pop()}
        link={previewUrl}
      />
    </>
  );
}
