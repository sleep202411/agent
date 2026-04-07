"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconCircleCheck,
  IconLoader2,
  IconMask,
  IconMusic,
  IconPlayerPause,
  IconPlayerPlay,
  IconSparkles,
  IconVideo,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import {
  AiAudioGeneratorDialog,
  AiBasicAudioGeneratorDialog,
  AiLipSyncGeneratorDialog,
  AiVideoGeneratorDialog,
} from "@/components/storyboard/ai-generator";
import { AudioWaveformBars } from "@/components/storyboard/ai-generator/audio-waveform-bars";
import { cn } from "@/lib/utils";
import { uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";
import { backendApi } from "@/src/lib/api";
import { getDialogueTextFromShotValues } from "@/src/lib/storyboard-dialogue";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  clearSingleBatchCompleted,
  setRows,
  selectCurrentInstance,
  type ShotColumn,
  type ShotRow,
  type ShotValue,
} from "@/src/store/slices/projectSlice";
import {
  ossUrl,
  getPreferredFilePath,
  getPreferredFileSource,
  getVideoThumbnail,
  buildVideoPromptContext,
  upsertShotCell,
  resolveShotValueId,
  persistTextCell,
  persistValueList,
  getPrimaryMediaPath,
  type MediaFile,
} from "./cell-utils";
import { MediaManagerDialog } from "./media-manager";

function VideoManagerDialog({
  open,
  onOpenChange,
  projectId,
  files,
  preferredPath,
  onUploaded,
  onDeletePath,
  onSetPreferred,
  onUnsetPreferred,
  onPromptSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  files: MediaFile[];
  preferredPath: string;
  onUploaded: (path: string) => void | Promise<void>;
  onDeletePath: (path: string) => void;
  onSetPreferred: (path: string) => Promise<void>;
  onUnsetPreferred: (path: string) => Promise<void>;
  onPromptSave: (fileId: string, prompt: string) => Promise<void>;
}) {
  return (
    <MediaManagerDialog
      open={open}
      onOpenChange={onOpenChange}
      mediaType="video"
      title="视频管理"
      projectId={projectId}
      files={files}
      preferredPath={preferredPath}
      onUploaded={onUploaded}
      onDeletePath={onDeletePath}
      onSetPreferred={onSetPreferred}
      onUnsetPreferred={onUnsetPreferred}
      onPromptSave={onPromptSave}
    />
  );
}

export function MediaCell({
  cell,
  shotId,
  shotColumnId,
  type,
  row,
  column,
  defaultPrompt,
  defaultReferenceImage,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
  type: "video" | "audio" | "lip_sync";
  row?: ShotRow;
  column?: ShotColumn;
  defaultPrompt?: string;
  defaultReferenceImage?: string;
}) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [tempPreviewUrl, setTempPreviewUrl] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [showGenerateDone, setShowGenerateDone] = useState(false);
  const dragCounterRef = useRef(0);
  const doneTimerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioProgressRafRef = useRef<number | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioPlayProgress, setAudioPlayProgress] = useState(0);

  const assetType = type === "audio" ? "audio" : "video";
  const isVideoCell = type === "video";
  const isAudioCell = type === "audio";
  const audioPresetKey = String(
    column?.presetColumnKey ?? cell?.presetColumnKey ?? ""
  ).toLowerCase();
  const isMusicAudioCell = isAudioCell && audioPresetKey === "music";
  const isVoiceAudioCell = isAudioCell && !isMusicAudioCell;
  const isDraggableCell = isVideoCell || isAudioCell;
  const columns = useAppSelector((state) => selectCurrentInstance(state).columns);
  const detail = useAppSelector((state) => selectCurrentInstance(state).detail);
  const worldId = useAppSelector((state) => selectCurrentInstance(state).worldId);
  const isBatchGeneratingCell = useAppSelector((state) =>
    Boolean(selectCurrentInstance(state).batchGeneratingCells[`${shotId}:${shotColumnId}`])
  );
  const isBatchCompletedCell = useAppSelector((state) =>
    Boolean(selectCurrentInstance(state).batchCompletedCells[`${shotId}:${shotColumnId}`])
  );
  const path = getPreferredFilePath(cell);
  const src = ossUrl(path);
  const files = useMemo(() => (cell?.files as MediaFile[] | undefined) ?? [], [cell?.files]);
  const appliedPaths = files.map((file) => file.path ?? "").filter(Boolean);
  const preferredPath = files.find((file) => file.preferred)?.path ?? "";
  const displayVideoSrc = tempPreviewUrl || src;
  const displayVideoThumbnail = isVideoCell ? getVideoThumbnail(displayVideoSrc) : "";
  const promptContext = useMemo(
    () =>
      isVideoCell && row && column
        ? buildVideoPromptContext(row, column, columns, detail as Record<string, unknown> | null)
        : { prompt: defaultPrompt ?? "", referenceFields: [] as string[], videoPromptColumnId: "" },
    [column, columns, defaultPrompt, detail, isVideoCell, row]
  );
  const defaultReferenceImagePath = useMemo(() => {
    if (!isVideoCell) return defaultReferenceImage ?? "";
    const imageCell = row?.shotValues?.find((item) => item.presetColumnKey === "image_path");
    return getPreferredFileSource(imageCell) || defaultReferenceImage || "";
  }, [defaultReferenceImage, isVideoCell, row]);

  const stopAudioPlayback = useCallback(() => {
    if (audioProgressRafRef.current) {
      window.cancelAnimationFrame(audioProgressRafRef.current);
      audioProgressRafRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsAudioPlaying(false);
    setAudioPlayProgress(0);
  }, []);

  const updateAudioProgress = useCallback(() => {
    const instance = audioRef.current;
    if (!instance) return;

    const duration = instance.duration || 1;
    setAudioPlayProgress(instance.currentTime / duration);
    audioProgressRafRef.current = window.requestAnimationFrame(updateAudioProgress);
  }, []);

  useEffect(() => {
    if (tempPreviewUrl && tempPreviewUrl.startsWith("blob:") && src && src !== tempPreviewUrl) {
      URL.revokeObjectURL(tempPreviewUrl);
      setTempPreviewUrl("");
    }
  }, [src, tempPreviewUrl]);

  useEffect(() => {
    if (!isAudioCell) return undefined;
    stopAudioPlayback();
    return undefined;
  }, [isAudioCell, src, stopAudioPlayback]);

  useEffect(() => {
    return () => {
      if (tempPreviewUrl && tempPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(tempPreviewUrl);
      }
      stopAudioPlayback();
      if (doneTimerRef.current) {
        window.clearTimeout(doneTimerRef.current);
      }
    };
  }, [stopAudioPlayback, tempPreviewUrl]);

  const updateFilesState = useCallback(
    (nextFiles: MediaFile[], nextCellId?: string) => {
      const primaryPath = getPrimaryMediaPath(nextFiles);
      const currentRows = selectCurrentInstance(store.getState()).rows;
      store.dispatch(
        setRows(
          upsertShotCell(currentRows, shotId, shotColumnId, {
            id: nextCellId ?? cell?.id,
            files: nextFiles,
            values: nextFiles.map((file) => file.path).filter(Boolean),
            value: primaryPath,
          })
        )
      );
    },
    [cell?.id, shotColumnId, shotId]
  );

  const persistMediaPaths = useCallback(
    async (nextPaths: string[]) => {
      const previousFiles = files.map((file) => ({ ...file }));
      const previousCellId = cell?.id;
      const uniquePaths = Array.from(new Set(nextPaths.filter(Boolean)));
      const hasExistingPreferred =
        preferredPath &&
        uniquePaths.includes(preferredPath) &&
        files.some((file) => file.path === preferredPath && file.preferred);
      const effectivePreferredPath = hasExistingPreferred ? preferredPath : "";
      const nextFiles = uniquePaths.map((nextPath) => {
        const existing = files.find((file) => file.path === nextPath);
        return {
          ...(existing ?? { path: nextPath }),
          path: nextPath,
          preferred: effectivePreferredPath ? nextPath === effectivePreferredPath : false,
        };
      });

      updateFilesState(nextFiles);

      try {
        const result = await backendApi.post("/api/user/shotValue/input", {
          data: { shotId, shotColumnId, value: "", values: uniquePaths },
        });
        const nextId = resolveShotValueId(result);
        updateFilesState(nextFiles, nextId || undefined);
      } catch (error) {
        console.error("[MediaCell] 保存素材失败:", error);
        updateFilesState(previousFiles, previousCellId);
        toast.error(tc("saveFailed"));
      }
    },
    [cell?.id, files, preferredPath, shotColumnId, shotId, updateFilesState]
  );

  const handleSelect = (paths: string[]) => {
    if (isVideoCell) {
      setTempPreviewUrl("");
      void persistMediaPaths(paths);
      return;
    }

    void persistValueList(shotId, shotColumnId, paths, {
      files: paths.map((selectedPath) => ({ path: selectedPath })),
    });
  };

  const handleCollect = useCallback(
    (item: { storagePath?: string }) => {
      const nextPath = item.storagePath ?? "";
      if (!nextPath) return;

      const nextPaths = appliedPaths.includes(nextPath)
        ? appliedPaths.filter((pathItem) => pathItem !== nextPath)
        : [...appliedPaths, nextPath];

      if (isVideoCell) {
        void persistMediaPaths(nextPaths);
        return;
      }

      void persistValueList(shotId, shotColumnId, nextPaths, {
        files: nextPaths.map((selectedPath) => ({ path: selectedPath })),
      });
    },
    [appliedPaths, isVideoCell, persistMediaPaths, shotColumnId, shotId]
  );

  const handleManagerAdd = useCallback(
    async (paths: string[]) => {
      const nextPaths = [...appliedPaths];
      for (const itemPath of paths) {
        if (!nextPaths.includes(itemPath)) {
          nextPaths.push(itemPath);
        }
      }
      await persistMediaPaths(nextPaths);
    },
    [appliedPaths, persistMediaPaths]
  );

  const handleDeletePath = useCallback(
    (targetPath: string) => {
      const nextPaths = appliedPaths.filter((itemPath) => itemPath !== targetPath);
      if (displayVideoSrc === ossUrl(targetPath)) {
        setTempPreviewUrl("");
      }
      void persistMediaPaths(nextPaths);
      if (nextPaths.length === 0) {
        setManagerOpen(false);
      }
    },
    [appliedPaths, displayVideoSrc, persistMediaPaths]
  );

  const handleSetPreferred = useCallback(
    async (item: { storagePath?: string; path?: string }) => {
      const targetPath = item.storagePath ?? item.path ?? "";
      if (!targetPath) return;

      const existingPaths = files.map((file) => file.path ?? "").filter(Boolean);
      if (!existingPaths.includes(targetPath)) {
        await persistMediaPaths([...existingPaths, targetPath]);
      }

      const latestRows = selectCurrentInstance(store.getState()).rows;
      const latestRow = latestRows.find((itemRow) => itemRow.shotId === shotId);
      const latestCell = latestRow?.shotValues?.find(
        (value) => value.shotColumnId === shotColumnId
      );
      const previousFiles = ((latestCell?.files as MediaFile[] | undefined) ?? files).map(
        (file) => ({
          ...file,
        })
      );
      if (!previousFiles.some((file) => file.path === targetPath)) {
        toast.error("素材加入管理失败");
        return;
      }
      const cellId = typeof latestCell?.id === "string" ? latestCell.id : cell?.id;
      if (!cellId) return;

      try {
        await backendApi.post(`/api/user/shotValue/preferred/${String(cellId)}`, {
          data: { value: targetPath, preferred: true },
        });
        const nextFiles = previousFiles.map((file) => ({
          ...file,
          preferred: file.path === targetPath,
        }));
        updateFilesState(nextFiles, typeof latestCell?.id === "string" ? latestCell.id : undefined);
      } catch (error) {
        console.error("[MediaCell] 设置定稿失败:", error);
        toast.error("设置定稿失败");
      }
    },
    [cell?.id, files, persistMediaPaths, shotColumnId, shotId, updateFilesState]
  );

  const handleUnsetPreferred = useCallback(
    async (path: string) => {
      const targetPath = path.trim();
      if (!targetPath) return;

      const latestRows = selectCurrentInstance(store.getState()).rows;
      const latestRow = latestRows.find((itemRow) => itemRow.shotId === shotId);
      const latestCell = latestRow?.shotValues?.find(
        (value) => value.shotColumnId === shotColumnId
      );
      const previousFiles = ((latestCell?.files as MediaFile[] | undefined) ?? files).map(
        (file) => ({
          ...file,
        })
      );
      const cellId = typeof latestCell?.id === "string" ? latestCell.id : cell?.id;
      if (!cellId) return;

      try {
        await backendApi.post(`/api/user/shotValue/preferred/${String(cellId)}`, {
          data: { value: targetPath, preferred: false },
        });
        const nextFiles = previousFiles.map((file) => ({
          ...file,
          preferred: false,
        }));
        updateFilesState(nextFiles, typeof latestCell?.id === "string" ? latestCell.id : undefined);
      } catch (error) {
        console.error("[MediaCell] 取消定稿失败:", error);
        toast.error("取消定稿失败");
      }
    },
    [cell?.id, files, shotColumnId, shotId, updateFilesState]
  );

  const handlePromptSave = useCallback(
    async (fileId: string, promptValue: string) => {
      await backendApi.post(`/api/user/file/updatePrompt/${fileId}`, {
        data: { prompt: promptValue },
      });
      updateFilesState(
        files.map((file) =>
          String(file.id ?? "") === String(fileId) ? { ...file, prompt: promptValue } : file
        )
      );
    },
    [files, updateFilesState]
  );

  const handleGeneratePrompt = useCallback(
    (promptValue: string) => {
      const videoPromptColumnId = promptContext.videoPromptColumnId;
      if (!videoPromptColumnId || !promptValue.trim()) return;
      void persistTextCell(shotId, videoPromptColumnId, promptValue.trim(), { richText: true });
    },
    [promptContext.videoPromptColumnId, shotId]
  );

  const handleUploadFile = useCallback(
    async (file: File) => {
      const acceptedAudioMimeTypes = new Set(["audio/mpeg", "audio/wav", "audio/x-wav"]);
      const extension = `.${String(file.name.split(".").pop() ?? "").toLowerCase()}`;
      const isAcceptedAudioFile =
        acceptedAudioMimeTypes.has(file.type) || [".mp3", ".wav"].includes(extension);

      if (isVideoCell && !file.type.startsWith("video/")) {
        toast.error("请上传视频文件");
        return;
      }

      if (isAudioCell && !isAcceptedAudioFile) {
        toast.error("请上传 mp3 或 wav 音频文件");
        return;
      }

      const localPreviewUrl = isVideoCell ? URL.createObjectURL(file) : "";
      if (localPreviewUrl) {
        setTempPreviewUrl(localPreviewUrl);
      }
      setUploading(true);

      try {
        const uploaded = await uploadWorkspaceFile(file, {
          uploadType: isAudioCell ? "SHOT_VALUE_AUDIO" : "SHOT_VALUE_VIDEO",
          sourceType: "LOCAL",
          accept: isAudioCell ? "audio/*" : "video/*",
        });
        const storagePath = uploaded.path;

        if (localPreviewUrl) {
          URL.revokeObjectURL(localPreviewUrl);
          setTempPreviewUrl(ossUrl(storagePath));
        }

        if (isVideoCell) {
          await persistMediaPaths([storagePath]);
        } else {
          await persistValueList(shotId, shotColumnId, [storagePath], {
            files: [{ path: storagePath, preferred: true }],
          });
        }
      } catch (error) {
        console.error(`[MediaCell] 上传${isAudioCell ? "音频" : "视频"}失败:`, error);
        toast.error(tc("uploadFailed"));
        if (localPreviewUrl) {
          URL.revokeObjectURL(localPreviewUrl);
          setTempPreviewUrl("");
        }
      } finally {
        setUploading(false);
      }
    },
    [isAudioCell, isVideoCell, persistMediaPaths, shotColumnId, shotId]
  );

  const handleAudioUpload = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav";
    input.onchange = (event) => {
      const target = event.target as HTMLInputElement | null;
      const file = target?.files?.[0];
      if (file) {
        void handleUploadFile(file);
      }
    };
    input.click();
  }, [handleUploadFile]);

  const handleToggleAudioPlay = useCallback(() => {
    if (!src) return;
    if (isAudioPlaying) {
      stopAudioPlayback();
      return;
    }

    stopAudioPlayback();
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.addEventListener("ended", stopAudioPlayback);
    audio.addEventListener("error", stopAudioPlayback);
    void audio
      .play()
      .then(() => {
        setIsAudioPlaying(true);
        updateAudioProgress();
      })
      .catch(() => {
        stopAudioPlayback();
      });
  }, [isAudioPlaying, src, stopAudioPlayback, updateAudioProgress]);

  const handleSelectGeneratedAudio = useCallback(
    async (selectedPath: string) => {
      await persistValueList(shotId, shotColumnId, [selectedPath], {
        files: [{ path: selectedPath, preferred: true }],
      });
    },
    [shotColumnId, shotId]
  );

  const handleSelectGeneratedAudios = useCallback(
    async (selectedPaths: string[]) => {
      const normalized = selectedPaths.map((item) => item.trim()).filter(Boolean);
      if (normalized.length === 0) return;
      await persistValueList(shotId, shotColumnId, normalized, {
        files: normalized.map((item, index) => ({ path: item, preferred: index === 0 })),
      });
    },
    [shotColumnId, shotId]
  );

  const handleAiGenerate = () => {
    if (type === "audio") {
      setShowGenerateDone(false);
      if (isBatchCompletedCell) {
        store.dispatch(clearSingleBatchCompleted({ shotId: shotId, columnId: shotColumnId }));
      }
      setAiOpen(true);
      return;
    }
    if (type === "video") {
      setShowGenerateDone(false);
      if (isBatchCompletedCell) {
        store.dispatch(clearSingleBatchCompleted({ shotId: shotId, columnId: shotColumnId }));
      }
      setAiOpen(true);
      return;
    }
    if (type === "lip_sync") {
      setShowGenerateDone(false);
      setAiOpen(true);
      return;
    }
  };

  const aiButtonIcon =
    isAiGenerating || isBatchGeneratingCell ? (
      <IconLoader2 className="size-3.5 animate-spin" />
    ) : showGenerateDone || isBatchCompletedCell ? (
      <IconCircleCheck className="size-3.5 text-green-500" />
    ) : (
      <IconSparkles className="size-3.5" />
    );

  return (
    <>
      <div
        className={cn(
          "group relative flex h-full w-full items-center justify-center overflow-hidden rounded-md",
          isDraggableCell && isDragOver && "border-2 border-dashed border-primary bg-primary/10"
        )}
        onDragEnter={(event) => {
          if (!isDraggableCell) return;
          event.preventDefault();
          dragCounterRef.current += 1;
          setIsDragOver(true);
        }}
        onDragOver={(event) => {
          if (!isDraggableCell) return;
          event.preventDefault();
        }}
        onDragLeave={() => {
          if (!isDraggableCell) return;
          dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
          if (dragCounterRef.current === 0) {
            setIsDragOver(false);
          }
        }}
        onDrop={(event) => {
          if (!isDraggableCell) return;
          event.preventDefault();
          dragCounterRef.current = 0;
          setIsDragOver(false);
          const file = event.dataTransfer?.files?.[0];
          if (file) {
            void handleUploadFile(file);
          }
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {type === "audio" ? (
          uploading ? (
            <div className="flex h-full w-full items-center justify-center px-4 py-3">
              <div className="flex w-full items-center gap-3 rounded-lg bg-white/[0.03] px-4 py-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/70">
                  <IconMusic className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <AudioWaveformBars loading />
                </div>
                <IconLoader2 className="size-4 animate-spin text-white/70" />
              </div>
            </div>
          ) : isDragOver && !src ? (
            <div className="flex h-full w-full items-center justify-center text-center text-xs text-primary">
              拖拽音频到这里
            </div>
          ) : (
            <div
              className={cn(
                "flex h-full w-full items-center gap-3 px-4 py-3",
                !src && "justify-center"
              )}
            >
              {src ? (
                <>
                  <div className="min-w-0 flex-1">
                    <AudioWaveformBars
                      audioKey={path}
                      progress={isAudioPlaying ? audioPlayProgress : 0}
                    />
                    <div
                      className={cn(
                        "mt-2 flex gap-2 transition-all",
                        "overflow-hidden",
                        isHovering || isAiGenerating ? "max-h-12 opacity-100" : "max-h-0 opacity-0"
                      )}
                    >
                      <Button
                        size="sm"
                        variant="soft"
                        color="muted"
                        disabled={isBatchGeneratingCell}
                        onClick={handleAudioUpload}
                      >
                        上传音频
                      </Button>
                      <Button
                        size="sm"
                        variant="soft"
                        color="muted"
                        disabled={isBatchGeneratingCell}
                        onClick={handleAiGenerate}
                      >
                        {aiButtonIcon}
                        AI 生成
                      </Button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleAudioPlay}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                  >
                    {isAudioPlaying ? (
                      <IconPlayerPause className="size-4" />
                    ) : (
                      <IconPlayerPlay className="ml-0.5 size-4" />
                    )}
                  </button>
                </>
              ) : isBatchGeneratingCell ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
                  <IconLoader2 className="size-5 animate-spin text-white/75" />
                  <span className="text-[11px] font-medium text-white/80">批量生成中...</span>
                </div>
              ) : (
                <div className="flex w-fit flex-col items-stretch justify-center gap-3">
                  <Button size="sm" variant="soft" color="muted" onClick={handleAudioUpload}>
                    上传音频
                  </Button>
                  <Button size="sm" variant="soft" color="muted" onClick={handleAiGenerate}>
                    {aiButtonIcon}
                    AI 生成
                  </Button>
                </div>
              )}
            </div>
          )
        ) : isVideoCell ? (
          displayVideoSrc ? (
            <div className="relative h-full w-full p-4">
              <div className="relative h-full w-full overflow-hidden rounded-md bg-black">
                {displayVideoThumbnail && !displayVideoSrc.startsWith("blob:") ? (
                  <img src={displayVideoThumbnail} alt="" className="h-full w-full object-cover" />
                ) : (
                  <video
                    src={displayVideoSrc}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                )}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white">
                    <IconPlayerPlay className="ml-0.5 size-5" />
                  </div>
                </div>
                {!isBatchGeneratingCell ? (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      size="sm"
                      variant="soft"
                      color="muted"
                      onClick={() => setManagerOpen(true)}
                    >
                      视频管理
                    </Button>
                    <Button size="sm" variant="soft" color="muted" onClick={handleAiGenerate}>
                      {aiButtonIcon}
                      {t("aiVideo")}
                    </Button>
                  </div>
                ) : (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md bg-black/55">
                    <IconLoader2 className="size-5 animate-spin text-white/75" />
                    <span className="text-[11px] font-medium text-white/80">批量生成中...</span>
                  </div>
                )}
              </div>
            </div>
          ) : isDragOver ? (
            <div className="flex h-full w-full items-center justify-center text-center text-xs text-primary">
              拖拽视频到这里
            </div>
          ) : isBatchGeneratingCell ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
              <IconLoader2 className="size-5 animate-spin text-white/75" />
              <span className="text-[11px] font-medium text-white/80">批量生成中...</span>
            </div>
          ) : (
            <div className="flex h-full w-fit flex-col items-stretch justify-center gap-3">
              <Button size="sm" variant="soft" color="muted" onClick={() => setPickerOpen(true)}>
                选择视频
              </Button>
              <Button size="sm" variant="soft" color="muted" onClick={handleAiGenerate}>
                {aiButtonIcon}
                AI 生视频
              </Button>
            </div>
          )
        ) : src ? (
          <button type="button" onClick={() => setPreviewOpen(true)} className="h-full w-full">
            <video src={src} className="h-full w-full object-cover" muted preload="metadata" />
          </button>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
            {type === "lip_sync" ? (
              <IconMask className="size-6" />
            ) : (
              <IconVideo className="size-6" />
            )}
            <span className="text-[11px]">{type === "lip_sync" ? "对口型视频" : "视频素材"}</span>
          </div>
        )}

        {!isVideoCell && !isAudioCell ? (
          <div className="absolute inset-0 flex items-end justify-center gap-2 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
            {src ? (
              <Button size="sm" variant="soft" color="muted" onClick={() => setPreviewOpen(true)}>
                <IconPlayerPlay className="size-3.5" />
                {tc("preview")}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setPickerOpen(true)}>
              <IconVideo className="size-3.5" />
              素材
            </Button>
            <Button size="sm" variant="soft" color="muted" onClick={handleAiGenerate}>
              <IconSparkles className="size-3.5" />
              {type === "lip_sync" ? t("aiLipSync") : "AI"}
            </Button>
          </div>
        ) : null}

        {isVideoCell && (uploading || (isAiGenerating && !isHovering)) ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-black/35">
            <IconLoader2 className="size-4 animate-spin text-white/90" />
            {isAiGenerating ? (
              <span className="text-[10px] font-medium text-primary">Generating...</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        assetType={assetType}
        onSelect={handleSelect}
      />

      {isVideoCell ? (
        <VideoManagerDialog
          open={managerOpen}
          onOpenChange={setManagerOpen}
          projectId={String(detail?.id ?? "")}
          files={files}
          preferredPath={preferredPath}
          onUploaded={(path) => handleManagerAdd([path])}
          onDeletePath={handleDeletePath}
          onSetPreferred={(selectedPath) => handleSetPreferred({ path: selectedPath })}
          onUnsetPreferred={(selectedPath) => handleUnsetPreferred(selectedPath)}
          onPromptSave={handlePromptSave}
        />
      ) : null}

      <MediaPreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        type={type === "audio" ? "audio" : "video"}
        src={src}
        name={type === "audio" ? "音频预览" : "视频预览"}
        link={src}
      />

      {type === "audio" && isVoiceAudioCell ? (
        <AiAudioGeneratorDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          shotId={shotId}
          shotColumnId={shotColumnId}
          row={row}
          worldId={worldId ?? ""}
          currentAudioPath={path}
          onSelectPath={handleSelectGeneratedAudio}
          onGeneratingChange={setIsAiGenerating}
          onGenerateSuccess={() => {
            setShowGenerateDone(true);
            if (doneTimerRef.current) {
              window.clearTimeout(doneTimerRef.current);
            }
            doneTimerRef.current = window.setTimeout(() => {
              setShowGenerateDone(false);
              doneTimerRef.current = null;
            }, 2200);
          }}
        />
      ) : type === "audio" && isMusicAudioCell ? (
        <AiBasicAudioGeneratorDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          shotId={shotId}
          shotColumnId={shotColumnId}
          defaultPrompt={getDialogueTextFromShotValues(row?.shotValues ?? [])}
          currentAudioPath={path}
          onSelectPaths={handleSelectGeneratedAudios}
          onGeneratingChange={setIsAiGenerating}
          onGenerateSuccess={() => {
            setShowGenerateDone(true);
            if (doneTimerRef.current) {
              window.clearTimeout(doneTimerRef.current);
            }
            doneTimerRef.current = window.setTimeout(() => {
              setShowGenerateDone(false);
              doneTimerRef.current = null;
            }, 2200);
          }}
        />
      ) : null}

      {isVideoCell ? (
        <AiVideoGeneratorDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          shotId={shotId}
          shotColumnId={shotColumnId}
          defaultPrompt={promptContext.prompt}
          defaultReferenceImage={defaultReferenceImagePath}
          referenceFields={promptContext.referenceFields}
          appliedPaths={appliedPaths}
          preferredPath={preferredPath}
          onCollect={handleCollect}
          onSetPreferred={handleSetPreferred}
          onGeneratePrompt={handleGeneratePrompt}
          onGeneratingChange={setIsAiGenerating}
          onGenerateSuccess={() => {
            setShowGenerateDone(true);
            if (doneTimerRef.current) {
              window.clearTimeout(doneTimerRef.current);
            }
            doneTimerRef.current = window.setTimeout(() => {
              setShowGenerateDone(false);
              doneTimerRef.current = null;
            }, 2200);
          }}
        />
      ) : null}

      {type === "lip_sync" ? (
        <AiLipSyncGeneratorDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          shotId={shotId}
          shotColumnId={shotColumnId}
          row={row}
          worldId={worldId ?? ""}
          defaultReferenceVideo={
            row?.shotValues?.find((item) => item.presetColumnKey === "video_path")
              ? getPreferredFileSource(
                  row?.shotValues?.find((item) => item.presetColumnKey === "video_path")
                )
              : undefined
          }
          defaultReferenceAudio={
            row?.shotValues?.find((item) => item.presetColumnKey === "sound_path")
              ? getPreferredFileSource(
                  row?.shotValues?.find((item) => item.presetColumnKey === "sound_path")
                )
              : undefined
          }
          appliedPaths={appliedPaths}
          preferredPath={preferredPath}
          onCollect={handleCollect}
          onSetPreferred={handleSetPreferred}
          onGeneratingChange={setIsAiGenerating}
          onGenerateSuccess={() => {
            setShowGenerateDone(true);
            if (doneTimerRef.current) {
              window.clearTimeout(doneTimerRef.current);
            }
            doneTimerRef.current = window.setTimeout(() => {
              setShowGenerateDone(false);
              doneTimerRef.current = null;
            }, 2200);
          }}
        />
      ) : null}
    </>
  );
}
