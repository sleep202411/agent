"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustments,
  IconArrowBarRight,
  IconArrowsMaximize,
  IconBoxMultiple,
  IconBrush,
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
  IconX,
  IconZoomIn,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import { RichMentionEditor } from "@/components/storyboard/editor/rich-mention-editor";
import { useTranslations } from "next-intl";
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
  loadVideoModels,
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
  makeSelectTasksByShot,
  createTaskId,
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
  parseModelSizes,
  parseModelVideoLengths,
  parseVideoGenerateResult,
  toReferenceAssets,
} from "./video-types";
import { VideoReferencePanel } from "./video-reference-group";
import { ToolbarSelect, VideoModeSettings } from "./video-mode-settings";

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
}: AiVideoGeneratorDialogProps) {
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
  const modelsByMode = useAppSelector((s) => selectCurrentInstance(s).aiVideoForm.modelsByMode);

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
  const activeModels = useMemo(() => modelsByMode[activeMode] ?? [], [activeMode, modelsByMode]);
  const currentModel = useMemo(
    () => activeModels.find((item) => item.serviceCode === model),
    [activeModels, model]
  );
  const sizeOptions = useMemo(() => parseModelSizes(currentModel), [currentModel]);
  const videoLengthOptions = useMemo(() => parseModelVideoLengths(currentModel), [currentModel]);
  const previewUrl = previewItem?.url ?? "";
  const isPreviewApplied = previewItem?.storagePath
    ? appliedPaths.includes(previewItem.storagePath)
    : false;
  const isPreviewPreferred = previewItem?.storagePath === preferredPath;
  const previewBadge = isPreviewPreferred ? "\u5B9A\u7A3F" : isPreviewApplied ? "\u5DF2\u7528" : "";

  const videoToolbarActions: ToolbarAction[] = [
    onCollect && {
      key: "collect",
      icon: <IconStar className="size-4" />,
      active: isPreviewApplied,
      title: isPreviewApplied ? "\u79FB\u9664" : "\u6DFB\u52A0\u5230\u955C\u5934",
      onClick: () => previewItem && onCollect(previewItem),
    },
    onSetPreferred && {
      key: "prefer",
      icon: <IconCircleCheck className="size-4" />,
      active: isPreviewPreferred,
      title: "\u8BBE\u4E3A\u5B9A\u7A3F",
      onClick: () => previewItem && onSetPreferred(previewItem),
    },
    {
      key: "download",
      icon: <IconDownload className="size-4" />,
      title: "\u4E0B\u8F7D",
      onClick: () => previewItem && handleDownload(previewItem),
    },
    {
      key: "delete",
      icon: <IconTrash className="size-4" />,
      title: "\u5220\u9664",
      onClick: () => previewItem && void handleDelete(previewItem),
    },
    {
      key: "fullscreen",
      icon: <IconArrowsMaximize className="size-4" />,
      title: "\u5168\u5C4F\u9884\u89C8",
      onClick: () => setFullscreenOpen(true),
    },
    previewItem?.other && {
      key: "meta",
      icon: <IconFileText className="size-4" />,
      title: "\u67E5\u770B\u8BE6\u60C5",
      metaContent: previewItem.other,
    },
  ].filter(Boolean) as ToolbarAction[];
  const modelOptions = activeModels.map((item) => ({
    label: item.serviceName ?? item.serviceCode ?? "",
    value: item.serviceCode ?? "",
  }));

  const cost = useMemo(() => {
    const baseCost = Math.abs(currentModel?.integralCost ?? 0);
    const sizeMultiplier =
      sizeOptions.length > 0 && size
        ? Math.max(1, sizeOptions.findIndex((item: { value: string }) => item.value === size) + 1)
        : 1;
    const baseDuration = Number(videoLengthOptions[0]?.value ?? 0);
    const currentDuration = Number(videoLength || baseDuration || 0);
    const durationMultiplier =
      baseDuration > 0 && currentDuration > 0
        ? Math.max(1, Math.ceil(currentDuration / baseDuration))
        : 1;
    return baseCost * sizeMultiplier * durationMultiplier * Math.max(1, count);
  }, [count, currentModel?.integralCost, size, sizeOptions, videoLength, videoLengthOptions]);

  const title = shotNumber
    ? `AI \u751F\u89C6\u9891 - \u955C\u5934 ${shotNumber}`
    : "AI \u751F\u89C6\u9891";
  const modeExitLabel = editMode
    ? editMode === "outpainting"
      ? "\u9000\u51FA\u753B\u9762\u6269\u5C55"
      : editMode === "extend"
        ? "\u9000\u51FA\u5EF6\u957F\u6A21\u5F0F"
        : editMode === "localEdit"
          ? "\u9000\u51FA\u5C40\u90E8\u7F16\u8F91"
          : "\u9000\u51FA\u91CD\u7ED8\u6A21\u5F0F"
    : "";

  // ─── Initialization effect ────────────────────────────

  useEffect(() => {
    if (!open) {
      initRef.current = false;
      return;
    }
    if (initRef.current) {
      // Already initialized, just reload history
      void dispatch(loadVideoHistory({ shotId, colId: shotColumnId }));
      return;
    }
    initRef.current = true;

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

  // ─── Load models when activeMode changes ──────────────

  useEffect(() => {
    if (!open) return;
    void dispatch(loadVideoModels({ mode: activeMode })).then(() => {
      // After models load, set default model if current is not in the list
      // We read from the store directly via a follow-up dispatch
    });
  }, [activeMode, dispatch, open]);

  // If models just loaded but current model is not in the list, pick default
  useEffect(() => {
    if (!open) return;
    const matched = activeModels.find((item) => item.serviceCode === model);
    if (matched) return;
    const defaultModel = activeModels.find((item) => item.isDefault) ?? activeModels[0];
    if (defaultModel?.serviceCode) {
      dispatch(updateVideoForm({ key, updates: { model: String(defaultModel.serviceCode) } }));
    }
  }, [activeModels, dispatch, key, model, open]);

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

        const videoEndpoints: Record<string, string> = {
          frames: "/api/ai/video/generate/start-end-frame",
          multiReference: "/api/ai/video/generate/multiplereference",
          repaint: "/api/ai/video/generate/videorepainting",
          localEdit: "/api/ai/video/generate/videoedit",
          extend: "/api/ai/video/generate/videoextension",
          outpainting: "/api/ai/video/generate/videooutpainting",
        };

        const modeKey = String(params.mode ?? "reference");

        const videoPayloads: Record<string, Record<string, unknown>> = {
          frames: {
            shotId,
            shotColumnId,
            prompt: params.prompt,
            startFrameImageUrl: params.startFrameImageUrl,
            endFrameImageUrl: params.endFrameImageUrl,
            model: params.model,
            size: params.size,
            videoLength: params.videoLength,
          },
          multiReference: {
            shotId,
            shotColumnId,
            prompt: params.prompt,
            model: params.model,
            refImageUrls: params.refImageUrls,
            objOrBg: params.objOrBg,
            size: params.size,
            videoLength: params.videoLength,
          },
          repaint: {
            shotId,
            shotColumnId,
            prompt: params.prompt,
            model: params.model,
            videoUrl: params.videoUrl,
            controlCondition: params.controlCondition,
            strength: params.strength,
            refImageUrl: params.refImageUrl,
            size: params.size,
            videoLength: params.videoLength,
            promptExtend: true,
          },
          localEdit: {
            shotId,
            shotColumnId,
            prompt: params.prompt,
            model: params.model,
            videoUrl: params.videoUrl,
            maskImageUrl: params.maskImageUrl,
            maskType: params.maskType,
            expandRatio: params.expandRatio,
            maskFrameId: params.maskFrameId,
            refImageUrl: params.refImageUrl,
            size: params.size,
            videoLength: params.videoLength,
            promptExtend: true,
          },
          extend: {
            shotId,
            shotColumnId,
            prompt: params.prompt,
            model: params.model,
            firstClipUrl: params.firstClipUrl,
            lastClipUrl: params.lastClipUrl,
            firstFrameUrl: params.firstFrameUrl,
            lastFrameUrl: params.lastFrameUrl,
            size: params.size,
            videoLength: params.videoLength,
            promptExtend: true,
          },
          outpainting: {
            shotId,
            shotColumnId,
            prompt: params.prompt,
            model: params.model,
            videoUrl: params.videoUrl,
            topScale: params.topScale,
            bottomScale: params.bottomScale,
            leftScale: params.leftScale,
            rightScale: params.rightScale,
            size: params.size,
            videoLength: params.videoLength,
            promptExtend: true,
          },
        };

        const endpoint = videoEndpoints[modeKey] ?? "/api/ai/video/generate/basic";
        const payload = videoPayloads[modeKey] ?? {
          shotId,
          shotColumnId,
          prompt: params.prompt,
          startImageUrl: params.referenceImageUrl,
          modelId: params.model,
          size: params.size,
          videoLength: params.videoLength,
        };

        const result = await backendApi.post<Record<string, unknown>>(endpoint, {
          data: payload,
          timeout: 360_000,
        });

        const parsed = parseVideoGenerateResult(result);
        dispatch(
          completeTask({
            taskId: nextTask.id,
            output: { storagePath: parsed.storagePath, url: parsed.url },
          })
        );
        // Set preview if none
        dispatch(
          setVideoPreview({
            key,
            item: previewItem ?? { id: nextTask.id, ...parsed, fromQueue: true },
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "\u751F\u6210\u5931\u8D25";
        dispatch(failTask({ taskId: nextTask.id, error: message }));
      }
    })();
  }, [open, videoTasks, shotId, shotColumnId, dispatch, key, previewItem]);

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

    // Load models for the base uploadMode and set default
    await dispatch(loadVideoModels({ mode: uploadMode })).unwrap();
  }, [dispatch, key, resetEditModeRefs, savedModel, uploadMode]);

  const enterEditMode = useCallback(
    async (nextMode: EditMode) => {
      if (editMode === nextMode) {
        await exitEditMode();
        return;
      }

      if (!previewItem) {
        toast.warning("\u8BF7\u5148\u9009\u62E9\u4E00\u4E2A\u89C6\u9891\u7ED3\u679C");
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

      // Load models for the new edit mode
      await dispatch(loadVideoModels({ mode: nextMode })).unwrap();
    },
    [dispatch, editMode, exitEditMode, key, model, previewItem, resetEditModeRefs]
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
      toast.warning("\u8BF7\u8F93\u5165\u89C6\u9891\u63D0\u793A\u8BCD");
      return;
    }

    onGeneratePrompt?.(prompt.trim());

    const inputBase: Record<string, unknown> = {
      prompt: fullPrompt,
      mode: activeMode,
      model: model || undefined,
      size: size || undefined,
      videoLength: videoLength ? Number(videoLength) : undefined,
    };

    if (activeMode === "reference") {
      const reference = referenceImages[0];
      if (!reference?.path) {
        toast.warning("\u8BF7\u5148\u9009\u62E9\u53C2\u8003\u56FE");
        return;
      }
      inputBase.referenceImageUrl = ossUrl(reference.path);
    } else if (activeMode === "frames") {
      const firstFrame = firstFrames[0];
      const lastFrame = lastFrames[0];
      if (!firstFrame?.path) {
        toast.warning("\u8BF7\u5148\u4E0A\u4F20\u9996\u5E27\u56FE");
        return;
      }
      if (!lastFrame?.path) {
        toast.warning("\u8BF7\u5148\u4E0A\u4F20\u5C3E\u5E27\u56FE");
        return;
      }
      inputBase.startFrameImageUrl = ossUrl(firstFrame.path);
      inputBase.endFrameImageUrl = ossUrl(lastFrame.path);
    } else if (activeMode === "multiReference") {
      if (multiRefImages.length === 0) {
        toast.warning("\u8BF7\u5148\u4E0A\u4F20\u53C2\u8003\u56FE");
        return;
      }
      inputBase.refImageUrls = multiRefImages.map((item) => ossUrl(item.path));
      inputBase.objOrBg = multiRefImages.map((item) => item.typeTag || "obj");
    } else if (activeMode === "repaint") {
      const videoRef = repaintRefVideos[0];
      if (!videoRef?.path) {
        toast.warning("\u8BF7\u5148\u9009\u62E9\u89C6\u9891");
        return;
      }
      inputBase.videoUrl = ossUrl(videoRef.path);
      inputBase.controlCondition = controlCondition;
      inputBase.strength = undefined;
      inputBase.refImageUrl = repaintRefImage[0]?.path
        ? ossUrl(repaintRefImage[0].path)
        : undefined;
    } else if (activeMode === "localEdit") {
      const videoRef = localEditRefVideo[0];
      const maskImage = localEditMaskImage[0];
      if (!videoRef?.path) {
        toast.warning("\u8BF7\u5148\u9009\u62E9\u89C6\u9891");
        return;
      }
      if (!maskImage?.path) {
        toast.warning("\u8BF7\u5148\u4E0A\u4F20\u906E\u7F69\u56FE");
        return;
      }
      inputBase.videoUrl = ossUrl(videoRef.path);
      inputBase.maskImageUrl = ossUrl(maskImage.path);
      inputBase.maskType = maskType;
      inputBase.expandRatio = maskType === "tracking" ? expandRatio : undefined;
      inputBase.maskFrameId = maskFrameId ? Number(maskFrameId) : undefined;
      inputBase.refImageUrl = localEditRefImage[0]?.path
        ? ossUrl(localEditRefImage[0].path)
        : undefined;
    } else if (activeMode === "extend") {
      const firstClip = extendFirstClip[0];
      const lastClip = extendLastClip[0];
      if (!firstClip?.path && !lastClip?.path) {
        toast.warning("\u8BF7\u81F3\u5C11\u4E0A\u4F20\u9996\u7247\u6BB5\u6216\u5C3E\u7247\u6BB5");
        return;
      }
      inputBase.firstClipUrl = firstClip?.path ? ossUrl(firstClip.path) : undefined;
      inputBase.lastClipUrl = lastClip?.path ? ossUrl(lastClip.path) : undefined;
      inputBase.firstFrameUrl = extendFirstFrame[0]?.path
        ? ossUrl(extendFirstFrame[0].path)
        : undefined;
      inputBase.lastFrameUrl = extendLastFrame[0]?.path
        ? ossUrl(extendLastFrame[0].path)
        : undefined;
    } else if (activeMode === "outpainting") {
      const videoRef = outpaintingRefVideo[0];
      if (!videoRef?.path) {
        toast.warning("\u8BF7\u5148\u9009\u62E9\u89C6\u9891");
        return;
      }
      inputBase.videoUrl = ossUrl(videoRef.path);
      inputBase.topScale = outpaintingTop;
      inputBase.bottomScale = outpaintingBottom;
      inputBase.leftScale = outpaintingLeft;
      inputBase.rightScale = outpaintingRight;
    }

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

    toast.success(
      `\u5DF2\u6DFB\u52A0 ${Math.max(1, count)} \u4E2A\u89C6\u9891\u751F\u6210\u4EFB\u52A1`
    );
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="flex w-[980px] sm:max-w-[980px] flex-col overflow-hidden p-0"
          style={{ height: "min(860px, 90vh)" }}
        >
          <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-5 py-3">
            <div>
              <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {editMode
                  ? editMode === "repaint"
                    ? "\u91CD\u7ED8\u6A21\u5F0F"
                    : editMode === "localEdit"
                      ? "\u5C40\u90E8\u7F16\u8F91\u6A21\u5F0F"
                      : editMode === "extend"
                        ? "\u5EF6\u957F\u6A21\u5F0F"
                        : "\u753B\u9762\u6269\u5C55\u6A21\u5F0F"
                  : uploadMode === "frames"
                    ? "\u9996\u5C3E\u5E27\u6A21\u5F0F"
                    : uploadMode === "multiReference"
                      ? "\u591A\u53C2\u8003\u56FE\u6A21\u5F0F"
                      : "\u53C2\u8003\u56FE\u6A21\u5F0F"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <IconX className="size-4" />
            </button>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 gap-4 overflow-hidden px-4">
            <div className="flex min-h-0 flex-[4] flex-col overflow-auto">
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
              emptyText="\u70B9\u51FB\u5DE6\u4FA7\u89C6\u9891\u9884\u89C8"
              className="flex-[6]"
              toolbarActions={videoToolbarActions}
              bottomActions={[
                {
                  key: "repaint",
                  icon: <IconBrush className="size-3.5" />,
                  label: "\u91CD\u7ED8",
                  active: editMode === "repaint",
                  onClick: () => void enterEditMode("repaint"),
                },
                {
                  key: "localEdit",
                  icon: <IconBoxMultiple className="size-3.5" />,
                  label: "\u589E\u5220\u7269\u4F53",
                  active: editMode === "localEdit",
                  onClick: () => void enterEditMode("localEdit"),
                },
                {
                  key: "adjustments",
                  icon: <IconAdjustments className="size-3.5" />,
                  label: "\u4FEE\u6539\u5C5E\u6027",
                  disabled: true,
                },
                {
                  key: "storyboard",
                  icon: <IconLayoutGrid className="size-3.5" />,
                  label: "\u81EA\u5B9A\u4E49\u5206\u955C",
                  disabled: true,
                },
                {
                  key: "extend",
                  icon: <IconArrowBarRight className="size-3.5" />,
                  label: "\u5EF6\u957F",
                  active: editMode === "extend",
                  onClick: () => void enterEditMode("extend"),
                },
                {
                  key: "outpainting",
                  icon: <IconMaximize className="size-3.5" />,
                  label: "\u753B\u9762\u6269\u5C55",
                  active: editMode === "outpainting",
                  onClick: () => void enterEditMode("outpainting"),
                },
                {
                  key: "viewSwitch",
                  icon: <IconEye className="size-3.5" />,
                  label: "\u89C6\u89D2\u5207\u6362",
                  disabled: true,
                },
                {
                  key: "faceSwap",
                  icon: <IconUserCircle className="size-3.5" />,
                  label: "\u89D2\u8272\u6362\u8138",
                  disabled: true,
                },
                {
                  key: "motionTransfer",
                  icon: <IconWalk className="size-3.5" />,
                  label: "\u52A8\u4F5C\u8FC1\u79FB",
                  disabled: true,
                },
                {
                  key: "upscale",
                  icon: <IconZoomIn className="size-3.5" />,
                  label: "\u89C6\u9891\u9AD8\u6E05",
                  disabled: true,
                },
                {
                  key: "lipsync",
                  icon: <IconMicrophone className="size-3.5" />,
                  label: "\u5BF9\u53E3\u578B",
                  disabled: true,
                },
              ]}
            />
          </div>

          <div className="m-2 overflow-hidden rounded-xl border border-white/15 bg-[#1E1E24]">
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
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
                  placeholder="\u524D\u7F6E\u63D0\u793A\u8BCD..."
                  className="flex-1 bg-transparent text-xs text-foreground/80 outline-none placeholder:text-muted-foreground/40"
                />
              </div>
            </div>

            <div className="px-4 py-2">
              <RichMentionEditor
                value={prompt}
                onChange={(v) => dispatch(updateVideoForm({ key, updates: { prompt: v } }))}
                placeholder="\u6839\u636E @ \u5F15\u7528\u89D2\u8272\u3001\u573A\u666F\uFF0C\u63CF\u8FF0\u4F60\u60F3\u751F\u6210\u7684\u89C6\u9891\u5185\u5BB9..."
                mentionTypes={["character", "scene", "prop"]}
                minHeight={96}
                maxHeight={240}
                className="[&_[contenteditable]]:text-sm [&_[contenteditable]]:leading-relaxed [&_[contenteditable]]:text-foreground [&_[contenteditable]]:outline-none"
              />
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
                  placeholder="\u540E\u7F6E\u63D0\u793A\u8BCD..."
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

            <div className="flex flex-col gap-3 border-t border-white/[0.06] px-3 py-3">
              {!editMode ? (
                <div className="flex gap-2">
                  {[
                    { label: "\u53C2\u8003\u56FE", value: "reference" as const },
                    { label: "\u9996\u5C3E\u5E27", value: "frames" as const },
                    { label: "\u591A\u53C2\u8003\u56FE", value: "multiReference" as const },
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => void handleUploadModeChange(item.value)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs transition-colors",
                        uploadMode === item.value
                          ? "bg-primary text-white"
                          : "bg-white/[0.05] text-muted-foreground hover:bg-white/[0.08]"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
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
          </div>
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

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent showCloseButton={false} className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{"\u89C6\u9891\u9884\u89C8"}</DialogTitle>
          </DialogHeader>
          {previewUrl ? (
            <video
              key={`${previewUrl}-fullscreen`}
              src={previewUrl}
              controls
              autoPlay
              playsInline
              className="max-h-[80vh] w-full rounded-lg bg-black object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
