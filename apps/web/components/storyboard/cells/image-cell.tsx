import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { IconCircleCheck, IconLoader2, IconSparkles } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import { useStoryboardDialog } from "@/components/storyboard/storyboard-dialog-context";
import { cn } from "@/lib/utils";
import { buildOssImageUrl, uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";
import { backendApi } from "@/src/lib/api";
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
import { type ResultItem } from "@/src/store/slices/projectSlice";
import {
  ossUrl,
  getPreferredFilePath,
  buildImagePromptContext,
  upsertShotCell,
  resolveShotValueId,
  persistTextCell,
  getPrimaryMediaPath,
  type MediaFile,
} from "./cell-utils";
import { MediaManagerDialog } from "./media-manager";

function ImageManagerDialog({
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
  const t = useTranslations("storyboard");
  return (
    <MediaManagerDialog
      open={open}
      onOpenChange={onOpenChange}
      mediaType="image"
      title={t("imageManagement")}
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

export function ImageCell({
  cell,
  shotId,
  shotColumnId,
  row,
  column,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
  row: ShotRow;
  column: ShotColumn;
}) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const { openImageDialog } = useStoryboardDialog();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [tempPreviewUrl, setTempPreviewUrl] = useState("");
  const [showGenerateDone, setShowGenerateDone] = useState(false);
  const dragCounterRef = useRef(0);
  const doneTimerRef = useRef<number | null>(null);
  const previousGeneratingRef = useRef(false);
  const previousSuccessCountRef = useRef(0);

  const columns = useAppSelector((state) => selectCurrentInstance(state).columns);
  const detail = useAppSelector((state) => selectCurrentInstance(state).detail);
  const isBatchGeneratingCell = useAppSelector((state) =>
    Boolean(selectCurrentInstance(state).batchGeneratingCells[`${shotId}:${shotColumnId}`])
  );
  const isBatchCompletedCell = useAppSelector((state) =>
    Boolean(selectCurrentInstance(state).batchCompletedCells[`${shotId}:${shotColumnId}`])
  );
  const tasks = useAppSelector((state) => state.task.tasks);
  const aiTasks = useMemo(
    () =>
      Object.values(tasks).filter(
        (t) => t.type === "image" && t.shotId === shotId && t.shotColumnId === shotColumnId
      ),
    [tasks, shotId, shotColumnId]
  );

  const files = useMemo(() => (cell?.files as MediaFile[] | undefined) ?? [], [cell?.files]);
  const appliedPaths = files.map((file) => file.path ?? "").filter(Boolean);
  const preferredPath = files.find((file) => file.preferred)?.path ?? "";
  const src = ossUrl(getPreferredFilePath(cell));
  const thumbnailSrc = buildOssImageUrl(src, { width: 400, height: 300, mode: "fill" });
  const displayImageUrl = tempPreviewUrl || thumbnailSrc;
  const promptContext = useMemo(
    () => buildImagePromptContext(row, column, columns, detail as Record<string, unknown> | null),
    [column, columns, detail, row]
  );
  const isAiGenerating = aiTasks.some(
    (task) => task.status === "pending" || task.status === "running"
  );
  const successCount = aiTasks.filter((task) => task.status === "completed").length;

  useEffect(() => {
    if (
      previousGeneratingRef.current &&
      !isAiGenerating &&
      successCount > previousSuccessCountRef.current
    ) {
      setShowGenerateDone(true);
      if (doneTimerRef.current) {
        window.clearTimeout(doneTimerRef.current);
      }
      doneTimerRef.current = window.setTimeout(() => {
        setShowGenerateDone(false);
        doneTimerRef.current = null;
      }, 2200);
    }

    previousGeneratingRef.current = isAiGenerating;
    previousSuccessCountRef.current = successCount;
  }, [isAiGenerating, successCount]);

  useEffect(() => {
    if (tempPreviewUrl && tempPreviewUrl.startsWith("blob:") && src && src !== tempPreviewUrl) {
      URL.revokeObjectURL(tempPreviewUrl);
      setTempPreviewUrl("");
    }
  }, [src, tempPreviewUrl]);

  useEffect(() => {
    return () => {
      if (tempPreviewUrl && tempPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(tempPreviewUrl);
      }
      if (doneTimerRef.current) {
        window.clearTimeout(doneTimerRef.current);
      }
    };
  }, [tempPreviewUrl]);

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

  const persistImagePaths = useCallback(
    async (nextPaths: string[]) => {
      const previousFiles = files.map((file) => ({ ...file }));
      const previousCellId = cell?.id;
      const uniquePaths = Array.from(new Set(nextPaths.filter(Boolean)));
      const hasExistingPreferred =
        preferredPath &&
        uniquePaths.includes(preferredPath) &&
        files.some((file) => file.path === preferredPath && file.preferred);
      const effectivePreferredPath = hasExistingPreferred ? preferredPath : "";
      const nextFiles = uniquePaths.map((path) => {
        const existing = files.find((file) => file.path === path);
        return {
          ...(existing ?? { path }),
          path,
          preferred: effectivePreferredPath ? path === effectivePreferredPath : false,
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
        console.error("[ImageCell] 保存图片失败:", error);
        updateFilesState(previousFiles, previousCellId);
        toast.error(tc("saveFailed"));
      }
    },
    [cell?.id, files, preferredPath, shotColumnId, shotId, updateFilesState]
  );

  const handleCollect = useCallback(
    (item: ResultItem) => {
      const itemPath = item.storagePath ?? "";
      if (!itemPath) return;

      const nextPaths = appliedPaths.includes(itemPath)
        ? appliedPaths.filter((path) => path !== itemPath)
        : [...appliedPaths, itemPath];

      void persistImagePaths(nextPaths);
    },
    [appliedPaths, persistImagePaths]
  );

  const handleSelect = (paths: string[]) => {
    setTempPreviewUrl(paths[0] ? ossUrl(paths[0]) : "");
    void persistImagePaths(paths);
  };

  const handleManagerAdd = async (paths: string[]) => {
    const nextPaths = [...appliedPaths];
    for (const path of paths) {
      if (!nextPaths.includes(path)) {
        nextPaths.push(path);
      }
    }
    await persistImagePaths(nextPaths);
  };

  const handleDeletePath = useCallback(
    (path: string) => {
      const nextPaths = appliedPaths.filter((item) => item !== path);
      if (displayImageUrl === ossUrl(path)) {
        setTempPreviewUrl("");
      }
      void persistImagePaths(nextPaths);
      if (nextPaths.length === 0) {
        setManagerOpen(false);
      }
    },
    [appliedPaths, displayImageUrl, persistImagePaths]
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
        console.error("[ImageCell] 取消定稿失败:", error);
        toast.error(t("cancelFinalizedFailed"));
      }
    },
    [cell?.id, files, shotColumnId, shotId, updateFilesState]
  );

  const handleSetPreferred = useCallback(
    async (item: { storagePath?: string; path?: string }) => {
      const targetPath = item.storagePath ?? item.path ?? "";
      if (!targetPath) return;

      // Toggle: if already preferred, unset it
      if (targetPath === preferredPath) {
        await handleUnsetPreferred(targetPath);
        return;
      }

      const existingPaths = files.map((file) => file.path ?? "").filter(Boolean);
      if (!existingPaths.includes(targetPath)) {
        await persistImagePaths([...existingPaths, targetPath]);
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
        toast.error(t("addToManageFailed"));
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
        console.error("[ImageCell] 设置定稿失败:", error);
        toast.error(t("setFinalizedFailed"));
      }
    },
    [
      cell?.id,
      files,
      handleUnsetPreferred,
      persistImagePaths,
      preferredPath,
      shotColumnId,
      shotId,
      updateFilesState,
    ]
  );

  const handlePromptSave = useCallback(
    async (fileId: string, prompt: string) => {
      await backendApi.post(`/api/user/file/updatePrompt/${fileId}`, { data: { prompt } });
      updateFilesState(
        files.map((file) => (String(file.id ?? "") === String(fileId) ? { ...file, prompt } : file))
      );
    },
    [files, updateFilesState]
  );

  const handleGeneratePrompt = useCallback(
    (prompt: string) => {
      const imagePromptColumnId = promptContext.imagePromptColumnId;
      if (!imagePromptColumnId || !prompt.trim()) return;
      void persistTextCell(shotId, imagePromptColumnId, prompt.trim(), { richText: true });
    },
    [promptContext.imagePromptColumnId, shotId]
  );

  const handleUploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error(tc("selectImageFile"));
        return;
      }

      const localPreviewUrl = URL.createObjectURL(file);
      setTempPreviewUrl(localPreviewUrl);
      setUploading(true);

      try {
        const uploaded = await uploadWorkspaceFile(file, {
          uploadType: "SHOT_VALUE_IMAGE",
          sourceType: "LOCAL",
          accept: "image/*",
        });
        const storagePath = uploaded.path;

        URL.revokeObjectURL(localPreviewUrl);
        setTempPreviewUrl(ossUrl(storagePath));
        await persistImagePaths([storagePath]);
      } catch (error) {
        console.error("[ImageCell] 上传失败:", error);
        toast.error(tc("uploadFailed"));
        URL.revokeObjectURL(localPreviewUrl);
        setTempPreviewUrl("");
      } finally {
        setUploading(false);
      }
    },
    [persistImagePaths]
  );

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
          "group relative flex h-full w-full items-center justify-center overflow-hidden rounded-md p-4",
          isDragOver && "border-2 border-dashed border-primary bg-primary/10"
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          dragCounterRef.current += 1;
          setIsDragOver(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
          if (dragCounterRef.current === 0) {
            setIsDragOver(false);
          }
        }}
        onDrop={(event) => {
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
        {displayImageUrl ? (
          <div className="relative h-full w-full">
            <img src={displayImageUrl} alt="" className="h-full w-full rounded-md object-cover" />
            {!isBatchGeneratingCell ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                <Button size="sm" variant="soft" color="muted" onClick={() => setManagerOpen(true)}>
                  {t("imageManagement")}
                </Button>
                <Button
                  size="sm"
                  variant="soft"
                  color="muted"
                  onClick={() => {
                    setShowGenerateDone(false);
                    if (isBatchCompletedCell) {
                      store.dispatch(
                        clearSingleBatchCompleted({ shotId: shotId, columnId: shotColumnId })
                      );
                    }
                    openImageDialog(shotId, shotColumnId);
                  }}
                >
                  {aiButtonIcon}
                  {t("aiImage")}
                </Button>
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-black/55">
                <IconLoader2 className="size-5 animate-spin text-white/75" />
                <span className="text-[11px] font-medium text-white/80">
                  {t("batchGenerating")}
                </span>
              </div>
            )}
          </div>
        ) : isDragOver ? (
          <div className="flex h-full w-full items-center justify-center text-center text-xs text-primary">
            {t("dragImageHere")}
          </div>
        ) : isBatchGeneratingCell ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
            <IconLoader2 className="size-5 animate-spin text-white/75" />
            <span className="text-[11px] font-medium text-white/80">{t("batchGenerating")}</span>
          </div>
        ) : (
          <div className="flex h-full w-fit flex-col items-stretch justify-center gap-3">
            <Button size="sm" variant="soft" color="muted" onClick={() => setPickerOpen(true)}>
              {t("selectImage")}
            </Button>
            <Button
              size="sm"
              variant="soft"
              color="muted"
              onClick={() => {
                setShowGenerateDone(false);
                if (isBatchCompletedCell) {
                  store.dispatch(
                    clearSingleBatchCompleted({ shotId: shotId, columnId: shotColumnId })
                  );
                }
                openImageDialog(shotId, shotColumnId);
              }}
            >
              {aiButtonIcon}
              {t("aiGenerateImage")}
            </Button>
          </div>
        )}

        {(uploading || (isAiGenerating && !isHovering)) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-black/35">
            <IconLoader2 className="size-4 animate-spin text-white/90" />
            {isAiGenerating ? (
              <span className="text-[10px] font-medium text-primary">Generating...</span>
            ) : null}
          </div>
        )}
      </div>

      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        assetType="img"
        onSelect={handleSelect}
      />

      <ImageManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        projectId={String(detail?.id ?? "")}
        files={files}
        preferredPath={preferredPath}
        onUploaded={(path) => handleManagerAdd([path])}
        onDeletePath={handleDeletePath}
        onSetPreferred={(path) => handleSetPreferred({ path })}
        onUnsetPreferred={(path) => handleUnsetPreferred(path)}
        onPromptSave={handlePromptSave}
      />
    </>
  );
}
