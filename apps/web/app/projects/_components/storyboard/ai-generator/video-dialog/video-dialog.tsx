"use client";

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
  IconLanguage,
  IconLayoutGrid,
  IconLoader2,
  IconMaximize,
  IconMicrophone,
  IconStar,
  IconTrash,
  IconUserCircle,
  IconWalk,
  IconWand,
  IconZoomIn,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { RichMentionEditor } from "@/app/projects/_components/storyboard/editor/rich-mention-editor";
import { ReferenceMapProvider } from "@/app/projects/_components/storyboard/editor/reference-map-context";
import { autoSelectReferences } from "@/app/projects/_components/storyboard/editor/build-reference-map";
import { useVideoReferences } from "./use-video-references";

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
import { stripNonMentionTags } from "@/app/projects/_components/storyboard/cells/cell-utils";
import {
  buildExpandPayload,
  detectPromptLanguage,
  expandVideoPrompt,
  translateVideoPrompt,
} from "./expand-video-prompt";

import type {
  AiVideoGeneratorDialogProps,
  EditMode,
  MultiRefType,
  PickerTarget,
  ReferenceAsset,
  SimpleMode,
  VideoMode,
  VideoResultItem,
} from "@/src/lib/video-types";
import {
  ensureVideoReference,
  MAX_CONCURRENT,
  ossUrl,
  parseVideoGenerateResult,
} from "@/src/lib/video-types";
import { VideoReferencePanel } from "./video-reference-group";
import { ToolbarSelect, VideoModeSettings } from "./video-mode-settings";

import {
  getSchemaFields,
  getModeConfig,
  buildModePayload,
  resolveModeInputs,
  calcModelCost,
  classifyAsset,
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

  // Row + columns are read from the current project instance so the
  // "扩写镜头" button can assemble the structured expand-prompt payload
  // without the parent having to pass them through as props.
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);
  const columns = useAppSelector((s) => selectCurrentInstance(s).columns);
  const shotRow = useMemo(() => rows.find((r) => r.shotId === shotId), [rows, shotId]);
  const [isExpandingPrompt, setIsExpandingPrompt] = useState(false);
  const [isTranslatingPrompt, setIsTranslatingPrompt] = useState(false);

  // Seedance-2.0 forbids non-Seedream-generated photorealistic reference
  // images. Warn the user the first time they pick it per device; the
  // dismissal is sticky in localStorage (key below) so the alert never
  // reappears on the same machine.
  const [seedanceAlertOpen, setSeedanceAlertOpen] = useState(false);

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

  const dismissSeedanceAlert = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("seedance2-ref-warning-dismissed", "1");
    }
    setSeedanceAlertOpen(false);
  }, []);

  const handleExpandPrompt = useCallback(async () => {
    if (isExpandingPrompt) return;
    if (!shotRow) {
      toast.error(t("expandPromptNoRow"));
      return;
    }
    setIsExpandingPrompt(true);
    try {
      const payload = buildExpandPayload(shotRow, columns, shotNumber);
      // The textarea binds to redux `formData.prompt`, which isn't
      // written back to the row cell until the user submits. Override
      // with what the user is actually typing right now — otherwise
      // expand would see the stale cell value. Strip non-mention HTML
      // tags but keep `<mention>` intact so the LLM sees the entity
      // references and can preserve them in the rewrite.
      const typed = stripNonMentionTags(prompt).trim();
      payload.currentPrompt = typed || undefined;
      const expanded = await expandVideoPrompt(payload);
      dispatch(updateVideoForm({ key, updates: { prompt: expanded } }));
      toast.success(t("expandPromptSuccess"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t("expandPromptFailed")}: ${msg}`);
    } finally {
      setIsExpandingPrompt(false);
    }
  }, [columns, dispatch, isExpandingPrompt, key, prompt, shotNumber, shotRow, t]);

  const handleTranslatePrompt = useCallback(async () => {
    if (isTranslatingPrompt) return;
    const typed = stripNonMentionTags(prompt).trim();
    if (!typed) {
      toast.error(t("translatePromptEmpty"));
      return;
    }
    setIsTranslatingPrompt(true);
    try {
      const sourceLang = detectPromptLanguage(typed);
      const targetLang = sourceLang === "zh" ? "en" : "zh";
      const translated = await translateVideoPrompt({
        prompt: typed,
        sourceLang,
        targetLang,
      });
      dispatch(updateVideoForm({ key, updates: { prompt: translated } }));
      toast.success(
        t(targetLang === "en" ? "translatePromptSuccessToEn" : "translatePromptSuccessToZh")
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t("translatePromptFailed")}: ${msg}`);
    } finally {
      setIsTranslatingPrompt(false);
    }
  }, [dispatch, isTranslatingPrompt, key, prompt, t]);

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

  // ─── Reference group management ──
  const videoRefs = useVideoReferences({
    open,
    key,
    prompt,
    defaultPrompt,
    defaultReferenceImage,
    references,
    currentModel,
    modeModels,
    activeMode,
  });

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

  // Watch the active video model (covers manual picker change, mode-switch
  // auto-select, multimodal auto-default, dialog-reopen) and raise the
  // Seedance-2.0 alert once per device. Dismissal is persisted in
  // localStorage so the effect no-ops on future renders.
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("seedance2-ref-warning-dismissed") === "1") return;
    if (!model) return;
    const matched = modeModels.find((m) => m.id === model);
    const name = String(matched?.name ?? model).toLowerCase();
    if (/seedance[\s\-_]*2/.test(name)) setSeedanceAlertOpen(true);
  }, [model, modeModels, open]);

  const cost = useMemo(
    () => calcModelCost(currentModel, { size, videoLength, count }),
    [currentModel, size, videoLength, count]
  );

  // Per-kind labels for mention popover (参考图 N / 参考视频 N / 参考音频 N)
  const referenceMediaItems = useMemo(() => {
    const counts = { image: 0, video: 0, audio: 0 } as Record<"image" | "video" | "audio", number>;
    return referenceImages.map((r) => {
      const kind = classifyAsset(r);
      counts[kind] += 1;
      const prefix =
        kind === "video"
          ? t("referenceVideo")
          : kind === "audio"
            ? t("referenceAudio")
            : t("referenceImage");
      return {
        url: r.url || ossUrl(r.path),
        path: r.path,
        label: r.label || `${prefix} ${counts[kind]}`,
        kind,
      };
    });
  }, [referenceImages, t]);

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
      videoRefs.handlePickerSelect(target, paths);
    },
    [pickerTarget, videoRefs]
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
        return { assetType: "img" as const, multiple: true };
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

    // Enforce per-kind minimums on the shared referenceImages bucket.
    // Skip frames-mode etc. — those have no min requirement on this bucket.
    const refBucket = references.referenceImages ?? [];
    const kindCounts = { image: 0, video: 0, audio: 0 } as Record<
      "image" | "video" | "audio",
      number
    >;
    for (const item of refBucket) {
      kindCounts[classifyAsset(item)] += 1;
    }
    const minChecks: Array<["image" | "video" | "audio", number, string]> = [
      ["image", videoRefs.minImages, "uploadAtLeastImages"],
      ["video", videoRefs.minVideos, "uploadAtLeastVideos"],
      ["audio", videoRefs.minAudios, "uploadAtLeastAudios"],
    ];
    for (const [kind, min, key] of minChecks) {
      if (min > 0 && kindCounts[kind] < min) {
        toast.warning(t(key, { count: min }));
        return;
      }
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
                  onSetReferenceImages={videoRefs.onSetReferenceImages}
                  onSetFirstFrames={videoRefs.onSetFirstFrames}
                  onSetLastFrames={videoRefs.onSetLastFrames}
                  onSetMultiRefImages={videoRefs.onSetMultiRefImages}
                  onSetRepaintRefVideos={videoRefs.onSetRepaintRefVideos}
                  onSetRepaintRefImage={videoRefs.onSetRepaintRefImage}
                  onSetLocalEditRefVideo={videoRefs.onSetLocalEditRefVideo}
                  onSetLocalEditMaskImage={videoRefs.onSetLocalEditMaskImage}
                  onSetLocalEditRefImage={videoRefs.onSetLocalEditRefImage}
                  onSetExtendFirstClip={videoRefs.onSetExtendFirstClip}
                  onSetExtendLastClip={videoRefs.onSetExtendLastClip}
                  onSetExtendFirstFrame={videoRefs.onSetExtendFirstFrame}
                  onSetExtendLastFrame={videoRefs.onSetExtendLastFrame}
                  onSetOutpaintingRefVideo={videoRefs.onSetOutpaintingRefVideo}
                  maxImages={videoRefs.maxImages}
                  maxVideos={videoRefs.maxVideos}
                  maxAudios={videoRefs.maxAudios}
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
              <div className="flex items-center gap-2">
                <div className="h-4 w-0.5 rounded-full bg-primary/40" />
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
                <button
                  type="button"
                  onClick={() => void handleTranslatePrompt()}
                  disabled={isTranslatingPrompt}
                  title={t("translatePromptTooltip")}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/40 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isTranslatingPrompt ? (
                    <IconLoader2 className="size-3 animate-spin" />
                  ) : (
                    <IconLanguage className="size-3" />
                  )}
                  {t("translatePromptButton")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleExpandPrompt()}
                  disabled={isExpandingPrompt || !shotRow}
                  title={t("expandPromptTooltip")}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isExpandingPrompt ? (
                    <IconLoader2 className="size-3 animate-spin" />
                  ) : (
                    <IconWand className="size-3" />
                  )}
                  {t("expandPromptButton")}
                </button>
              </div>
            </div>

            <div className="px-4 py-2">
              <ReferenceMapProvider value={videoRefs.referenceMapCtx}>
                <RichMentionEditor
                  value={prompt}
                  onChange={(v) => dispatch(updateVideoForm({ key, updates: { prompt: v } }))}
                  placeholder={t("videoPromptEditorPlaceholder")}
                  mentionTypes={["character", "scene", "prop"]}
                  minHeight={96}
                  maxHeight={240}
                  className="[&_[contenteditable]]:text-sm [&_[contenteditable]]:leading-relaxed [&_[contenteditable]]:text-foreground [&_[contenteditable]]:outline-none"
                  referenceMedia={referenceMediaItems}
                  onMentionInserted={videoRefs.handleMentionInserted}
                  mentionDisabled={videoRefs.refIsFull}
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
                      { label: t("multimodalTab"), value: "multimodal" },
                      { label: t("multiReferenceTab"), value: "multiReference" },
                      { label: t("referenceImageUpload"), value: "reference" },
                      { label: t("framesTab"), value: "frames" },
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

      <AlertDialog
        open={seedanceAlertOpen}
        onOpenChange={(next) => {
          // Closing via overlay / Esc behaves the same as clicking "我知道了"
          // (persist dismissal) — the warning is informational, no
          // reason to keep nagging on the same device.
          if (!next) dismissSeedanceAlert();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("seedanceWarningTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("seedanceWarningDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={dismissSeedanceAlert}>
              {t("seedanceWarningConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
