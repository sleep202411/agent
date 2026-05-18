"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  AiImageGeneratorDialog,
  AiVideoGeneratorDialog,
} from "@/app/(studio)/art-studio/projects/_components/storyboard/ai-generator";
import { useStoryboardDialog } from "./storyboard-dialog-context";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  selectCurrentInstance,
  setRows,
  type ShotRow,
  type ShotValue,
  type ResultItem,
} from "@/src/store/slices/projectSlice";
import {
  buildImagePromptContext,
  buildVideoPromptContext,
  upsertShotCell,
  resolveShotValueId,
  getPreferredFilePath,
  ossUrl,
  persistTextCell,
  getPrimaryMediaPath,
  type MediaFile,
} from "./cells/cell-utils";
import { backendApi } from "@/src/lib/api";

function useShotData(shotId: string | undefined) {
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);
  const columns = useAppSelector((s) => selectCurrentInstance(s).columns);
  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);
  const rowIndex = useMemo(() => rows.findIndex((r) => r.shotId === shotId), [rows, shotId]);
  const row = rowIndex >= 0 ? rows[rowIndex] : undefined;
  const shotNumber = rowIndex >= 0 ? rowIndex + 1 : undefined;
  return { row, rows, columns, detail, shotNumber };
}

function useCellCallbacks(shotId: string, shotColumnId: string) {
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);
  const row = useMemo(() => rows.find((r) => r.shotId === shotId), [rows, shotId]);
  const cell = useMemo(
    () => row?.shotValues?.find((v) => v.shotColumnId === shotColumnId),
    [row, shotColumnId]
  );
  const files = useMemo(() => (cell?.files as MediaFile[] | undefined) ?? [], [cell?.files]);
  const appliedPaths = useMemo(() => files.map((f) => f.path ?? "").filter(Boolean), [files]);
  const preferredPath = useMemo(() => files.find((f) => f.preferred)?.path ?? "", [files]);

  const updateFilesState = useCallback(
    (nextFiles: MediaFile[], nextCellId?: string) => {
      const primaryPath = getPrimaryMediaPath(nextFiles);
      const currentRows = selectCurrentInstance(store.getState()).rows;
      store.dispatch(
        setRows(
          upsertShotCell(currentRows, shotId, shotColumnId, {
            id: nextCellId ?? cell?.id,
            files: nextFiles,
            values: nextFiles.map((f) => f.path).filter(Boolean),
            value: primaryPath,
          })
        )
      );
    },
    [cell?.id, shotColumnId, shotId]
  );

  const persistPaths = useCallback(
    async (nextPaths: string[]) => {
      const uniquePaths = Array.from(new Set(nextPaths.filter(Boolean)));
      const hasExistingPreferred =
        preferredPath &&
        uniquePaths.includes(preferredPath) &&
        files.some((f) => f.path === preferredPath && f.preferred);
      const effectivePreferredPath = hasExistingPreferred ? preferredPath : "";
      const nextFiles = uniquePaths.map((path) => {
        const existing = files.find((f) => f.path === path);
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
      } catch {
        toast.error("Save failed");
      }
    },
    [files, preferredPath, shotColumnId, shotId, updateFilesState]
  );

  const handleCollect = useCallback(
    (item: ResultItem | { id: string; url?: string; storagePath?: string }) => {
      const itemPath = (item as ResultItem).storagePath ?? "";
      if (!itemPath) return;
      const nextPaths = appliedPaths.includes(itemPath)
        ? appliedPaths.filter((p) => p !== itemPath)
        : [...appliedPaths, itemPath];
      void persistPaths(nextPaths);
    },
    [appliedPaths, persistPaths]
  );

  const handleSetPreferred = useCallback(
    async (item: { storagePath?: string; path?: string }) => {
      const targetPath = item.storagePath ?? item.path ?? "";
      if (!targetPath) return;
      if (targetPath === preferredPath) {
        // Toggle off
        const latestRows = selectCurrentInstance(store.getState()).rows;
        const latestRow = latestRows.find((r) => r.shotId === shotId);
        const latestCell = latestRow?.shotValues?.find((v) => v.shotColumnId === shotColumnId);
        const cellId = typeof latestCell?.id === "string" ? latestCell.id : cell?.id;
        if (!cellId) return;
        await backendApi.post(`/api/user/shotValue/preferred/${String(cellId)}`, {
          data: { value: targetPath, preferred: false },
        });
        const nextFiles = files.map((f) => ({ ...f, preferred: false }));
        updateFilesState(nextFiles);
        return;
      }
      if (!appliedPaths.includes(targetPath)) {
        await persistPaths([...appliedPaths, targetPath]);
      }
      const latestRows = selectCurrentInstance(store.getState()).rows;
      const latestRow = latestRows.find((r) => r.shotId === shotId);
      const latestCell = latestRow?.shotValues?.find((v) => v.shotColumnId === shotColumnId);
      const cellId = typeof latestCell?.id === "string" ? latestCell.id : cell?.id;
      if (!cellId) return;
      await backendApi.post(`/api/user/shotValue/preferred/${String(cellId)}`, {
        data: { value: targetPath, preferred: true },
      });
      const latestFiles = (latestCell?.files as MediaFile[] | undefined) ?? files;
      const nextFiles = latestFiles.map((f) => ({ ...f, preferred: f.path === targetPath }));
      updateFilesState(nextFiles);
    },
    [
      appliedPaths,
      cell?.id,
      files,
      persistPaths,
      preferredPath,
      shotColumnId,
      shotId,
      updateFilesState,
    ]
  );

  return {
    cell,
    files,
    appliedPaths,
    preferredPath,
    handleCollect,
    handleSetPreferred,
    persistPaths,
  };
}

export function StoryboardLiftedDialogs() {
  const { imageTarget, videoTarget, closeImageDialog, closeVideoDialog, navigateShot } =
    useStoryboardDialog();
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);

  const hasPrev = useMemo(() => {
    const target = imageTarget ?? videoTarget;
    if (!target) return false;
    const idx = rows.findIndex((r) => r.shotId === target.shotId);
    return idx > 0;
  }, [imageTarget, videoTarget, rows]);

  const hasNext = useMemo(() => {
    const target = imageTarget ?? videoTarget;
    if (!target) return false;
    const idx = rows.findIndex((r) => r.shotId === target.shotId);
    return idx >= 0 && idx < rows.length - 1;
  }, [imageTarget, videoTarget, rows]);

  const handlePrev = useCallback(() => navigateShot(-1), [navigateShot]);
  const handleNext = useCallback(() => navigateShot(1), [navigateShot]);

  return (
    <>
      {imageTarget ? (
        <LiftedImageDialog
          shotId={imageTarget.shotId}
          shotColumnId={imageTarget.shotColumnId}
          onClose={closeImageDialog}
          onPrevShot={hasPrev ? handlePrev : undefined}
          onNextShot={hasNext ? handleNext : undefined}
        />
      ) : null}
      {videoTarget ? (
        <LiftedVideoDialog
          shotId={videoTarget.shotId}
          shotColumnId={videoTarget.shotColumnId}
          onClose={closeVideoDialog}
          onPrevShot={hasPrev ? handlePrev : undefined}
          onNextShot={hasNext ? handleNext : undefined}
        />
      ) : null}
    </>
  );
}

function LiftedImageDialog({
  shotId,
  shotColumnId,
  onClose,
  onPrevShot,
  onNextShot,
}: {
  shotId: string;
  shotColumnId: string;
  onClose: () => void;
  onPrevShot?: () => void;
  onNextShot?: () => void;
}) {
  const { row, columns, detail, shotNumber } = useShotData(shotId);
  const column = useMemo(
    () => columns.find((c) => String(c.id) === shotColumnId),
    [columns, shotColumnId]
  );
  const { appliedPaths, preferredPath, handleCollect, handleSetPreferred } = useCellCallbacks(
    shotId,
    shotColumnId
  );

  const promptContext = useMemo(
    () =>
      row && column
        ? buildImagePromptContext(row, column, columns, detail as Record<string, unknown> | null)
        : { prompt: "", referenceFields: [], imagePromptColumnId: "" },
    [row, column, columns, detail]
  );

  const src = ossUrl(
    row && column
      ? getPreferredFilePath(row.shotValues?.find((v) => v.shotColumnId === shotColumnId))
      : undefined
  );

  const handleGeneratePrompt = useCallback(
    (prompt: string) => {
      const imagePromptColumnId = promptContext.imagePromptColumnId;
      if (!imagePromptColumnId || !prompt.trim()) return;
      void persistTextCell(shotId, imagePromptColumnId, prompt.trim(), { richText: true });
    },
    [promptContext.imagePromptColumnId, shotId]
  );

  return (
    <AiImageGeneratorDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      shotId={shotId}
      shotColumnId={shotColumnId}
      shotNumber={shotNumber}
      defaultPrompt={promptContext.prompt}
      referenceFields={promptContext.referenceFields}
      defaultRefImage={src || undefined}
      appliedPaths={appliedPaths}
      preferredPath={preferredPath}
      onCollect={handleCollect}
      onSetPreferred={handleSetPreferred}
      onGeneratePrompt={handleGeneratePrompt}
      onPrevShot={onPrevShot}
      onNextShot={onNextShot}
    />
  );
}

function LiftedVideoDialog({
  shotId,
  shotColumnId,
  onClose,
  onPrevShot,
  onNextShot,
}: {
  shotId: string;
  shotColumnId: string;
  onClose: () => void;
  onPrevShot?: () => void;
  onNextShot?: () => void;
}) {
  const { row, columns, detail, shotNumber } = useShotData(shotId);
  const column = useMemo(
    () => columns.find((c) => String(c.id) === shotColumnId),
    [columns, shotColumnId]
  );
  const { appliedPaths, preferredPath, handleCollect, handleSetPreferred } = useCellCallbacks(
    shotId,
    shotColumnId
  );

  const promptContext = useMemo(
    () =>
      row && column
        ? buildVideoPromptContext(row, column, columns, detail as Record<string, unknown> | null)
        : { prompt: "", referenceFields: [], videoPromptColumnId: "" },
    [row, column, columns, detail]
  );

  const imageColumn = columns.find(
    (c) =>
      c.presetColumnKey === "image_path" || String(c.columnType ?? "").toUpperCase() === "IMAGE"
  );
  const imageCell = imageColumn
    ? row?.shotValues?.find((v) => String(v.shotColumnId) === String(imageColumn.id))
    : undefined;
  const defaultReferenceImagePath = getPreferredFilePath(imageCell) ?? "";

  const handleGeneratePrompt = useCallback(
    (prompt: string) => {
      const videoPromptColumnId = promptContext.videoPromptColumnId;
      if (!videoPromptColumnId || !prompt.trim()) return;
      void persistTextCell(shotId, videoPromptColumnId, prompt.trim(), { richText: true });
    },
    [promptContext.videoPromptColumnId, shotId]
  );

  return (
    <AiVideoGeneratorDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      shotId={shotId}
      shotColumnId={shotColumnId}
      shotNumber={shotNumber}
      defaultPrompt={promptContext.prompt}
      defaultReferenceImage={defaultReferenceImagePath}
      referenceFields={promptContext.referenceFields}
      appliedPaths={appliedPaths}
      preferredPath={preferredPath}
      onCollect={handleCollect}
      onSetPreferred={handleSetPreferred}
      onGeneratePrompt={handleGeneratePrompt}
      onPrevShot={onPrevShot}
      onNextShot={onNextShot}
    />
  );
}
