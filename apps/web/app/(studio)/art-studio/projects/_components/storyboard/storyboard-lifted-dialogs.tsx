"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  AiImageGeneratorDialog,
  AiVideoGeneratorDialog,
} from "@/app/(studio)/art-studio/projects/_components/storyboard/ai-generator";
import { useStoryboardDialog } from "./storyboard-dialog-context";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import { selectCurrentInstance, setRows, type ResultItem } from "@/src/store/slices/projectSlice";
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

export function useCellCallbacks(shotId: string, shotColumnId: string) {
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);
  const episodeId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const versionRef = useRef(0);
  const lifetime = useMemo(
    () => ({ projectId, detail, episodeId, shotId, shotColumnId }),
    [projectId, detail, episodeId, shotId, shotColumnId]
  );
  const activeRef = useRef<typeof lifetime | null>(null);
  useLayoutEffect(() => {
    activeRef.current = lifetime;
    return () => {
      if (activeRef.current === lifetime) activeRef.current = null;
    };
  }, [lifetime]);
  const owns = useCallback(
    (version?: number) => {
      const current = store.getState();
      const instance = selectCurrentInstance(current);
      return (
        activeRef.current === lifetime &&
        (version === undefined || version === versionRef.current) &&
        current.project.currentProjectId === lifetime.projectId &&
        instance.detail === lifetime.detail &&
        instance.activeEpisodeId === lifetime.episodeId &&
        instance.rows.some((row) => row.shotId === lifetime.shotId)
      );
    },
    [lifetime]
  );
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
    (nextFiles: MediaFile[], nextCellId?: string, version?: number) => {
      if (!owns(version)) return;
      const primaryPath = getPrimaryMediaPath(nextFiles);
      const currentRows = selectCurrentInstance(store.getState()).rows;
      store.dispatch(
        setRows(
          upsertShotCell(currentRows, shotId, shotColumnId, {
            id:
              nextCellId ??
              currentRows
                .find((row) => row.shotId === shotId)
                ?.shotValues?.find((value) => value.shotColumnId === shotColumnId)?.id,
            files: nextFiles,
            values: nextFiles.map((f) => f.path).filter(Boolean),
            value: primaryPath,
          })
        )
      );
    },
    [shotColumnId, shotId, owns]
  );

  const persistPaths = useCallback(
    async (nextPaths: string[], inheritedVersion?: number) => {
      if (!owns()) return false;
      const version = inheritedVersion ?? ++versionRef.current;
      if (!owns(version)) return false;
      const currentCell = selectCurrentInstance(store.getState())
        .rows.find((row) => row.shotId === shotId)
        ?.shotValues?.find((value) => value.shotColumnId === shotColumnId);
      const files = (currentCell?.files as MediaFile[] | undefined) ?? [];
      const preferredPath = files.find((file) => file.preferred)?.path ?? "";
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
      updateFilesState(nextFiles, undefined, version);
      try {
        const result = await backendApi.post("/api/user/shotValue/input", {
          data: { shotId, shotColumnId, value: "", values: uniquePaths },
        });
        const nextId = resolveShotValueId(result);
        updateFilesState(nextFiles, nextId || undefined, version);
        return owns(version);
      } catch {
        if (!owns(version)) return false;
        updateFilesState(
          files,
          typeof currentCell?.id === "string" ? currentCell.id : undefined,
          version
        );
        toast.error("Save failed");
        return false;
      }
    },
    [shotColumnId, shotId, updateFilesState, owns]
  );

  const handleCollect = useCallback(
    (item: ResultItem | { id: string; url?: string; storagePath?: string }) => {
      if (!owns()) return;
      const latestCell = selectCurrentInstance(store.getState())
        .rows.find((row) => row.shotId === shotId)
        ?.shotValues?.find((value) => value.shotColumnId === shotColumnId);
      const appliedPaths = ((latestCell?.files as MediaFile[] | undefined) ?? [])
        .map((file) => file.path ?? "")
        .filter(Boolean);
      const itemPath = (item as ResultItem).storagePath ?? "";
      if (!itemPath) return;
      const nextPaths = appliedPaths.includes(itemPath)
        ? appliedPaths.filter((p) => p !== itemPath)
        : [...appliedPaths, itemPath];
      void persistPaths(nextPaths);
    },
    [persistPaths, owns, shotId, shotColumnId]
  );

  const handleSetPreferred = useCallback(
    async (item: { storagePath?: string; path?: string }) => {
      if (!owns()) return;
      const targetPath = item.storagePath ?? item.path ?? "";
      if (!targetPath) return;
      const version = ++versionRef.current;
      const originCell = selectCurrentInstance(store.getState())
        .rows.find((row) => row.shotId === shotId)
        ?.shotValues?.find((value) => value.shotColumnId === shotColumnId);
      const files = (originCell?.files as MediaFile[] | undefined) ?? [];
      const appliedPaths = files.map((file) => file.path ?? "").filter(Boolean);
      const preferredPath = files.find((file) => file.preferred)?.path ?? "";
      try {
        if (targetPath === preferredPath) {
          // Toggle off
          const latestRows = selectCurrentInstance(store.getState()).rows;
          const latestRow = latestRows.find((r) => r.shotId === shotId);
          const latestCell = latestRow?.shotValues?.find((v) => v.shotColumnId === shotColumnId);
          const cellId = latestCell?.id;
          if (!cellId) return;
          await backendApi.post(`/api/user/shotValue/preferred/${String(cellId)}`, {
            data: { value: targetPath, preferred: false },
          });
          const nextFiles = files.map((f) => ({ ...f, preferred: false }));
          updateFilesState(nextFiles, undefined, version);
          return;
        }
        if (!appliedPaths.includes(targetPath)) {
          if (!(await persistPaths([...appliedPaths, targetPath], version))) return;
        }
        if (!owns(version)) return;
        const latestRows = selectCurrentInstance(store.getState()).rows;
        const latestRow = latestRows.find((r) => r.shotId === shotId);
        const latestCell = latestRow?.shotValues?.find((v) => v.shotColumnId === shotColumnId);
        const cellId = latestCell?.id;
        if (!cellId) return;
        await backendApi.post(`/api/user/shotValue/preferred/${String(cellId)}`, {
          data: { value: targetPath, preferred: true },
        });
        const latestFiles = (latestCell?.files as MediaFile[] | undefined) ?? files;
        const nextFiles = latestFiles.map((f) => ({ ...f, preferred: f.path === targetPath }));
        updateFilesState(nextFiles, undefined, version);
      } catch {
        if (owns(version)) toast.error("Save failed");
      }
    },
    [persistPaths, shotColumnId, shotId, updateFilesState, owns]
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

  // Debounced autosave from the dialog. Silent (network-only): no toast spam
  // while typing and no store churn. Allows empty so clearing the prompt sticks.
  const handleAutoSavePrompt = useCallback(
    (prompt: string) => {
      const imagePromptColumnId = promptContext.imagePromptColumnId;
      if (!imagePromptColumnId) return;
      void persistTextCell(shotId, imagePromptColumnId, prompt.trim(), {
        richText: true,
        silent: true,
      });
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
      onAutoSavePrompt={handleAutoSavePrompt}
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

  // Debounced autosave from the dialog (silent: network-only). Allows empty.
  const handleAutoSavePrompt = useCallback(
    (prompt: string) => {
      const videoPromptColumnId = promptContext.videoPromptColumnId;
      if (!videoPromptColumnId) return;
      void persistTextCell(shotId, videoPromptColumnId, prompt.trim(), {
        richText: true,
        silent: true,
      });
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
      onAutoSavePrompt={handleAutoSavePrompt}
      onPrevShot={onPrevShot}
      onNextShot={onNextShot}
    />
  );
}
