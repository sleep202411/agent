"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { IconDownload, IconLoader2, IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { toast } from "sonner";
import {
  StoryboardComposition,
  type CompositionProps,
} from "@/components/player/storyboard-composition";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import {
  AiImageGeneratorDialog,
  AiLipSyncGeneratorDialog,
  AiVideoGeneratorDialog,
} from "@/app/(studio)/art-studio/projects/_components/storyboard/ai-generator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { backendApi } from "@/src/lib/api";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { store } from "@/src/store";
import {
  setActiveTab,
  setRows,
  touchStoryboard,
  selectCurrentInstance,
  type ShotValue,
} from "@/src/store/slices/projectSlice";

import { TimelineRuler, RULER_HEIGHT } from "./timeline-ruler";
import { TimelinePlayhead } from "./timeline-playhead";
import { TimelineShotCard } from "./timeline-shot-card";
import {
  FPS,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  MIN_TIMELINE_DURATION,
  TIMELINE_BUFFER,
  PLAYHEAD_OFFSET,
  PLAYHEAD_SCREEN_POSITION,
  MIN_DURATION,
  MAX_DURATION,
  ossUrl,
  formatClock,
  parseAspectRatioValue,
  getCompositionSize,
  getShotWidth,
  getCellText,
  getPreferredFile,
  getAllFilePaths,
  resolveShotValueId,
  upsertShotCell,
  moveRowBefore,
  buildPreferredFiles,
  mergeMediaFiles,
  buildImagePromptContext,
  buildVideoPromptContext,
  extractTimelineShots,
  type AssetType,
  type TimelineMenuAction,
  type TimelineFile,
  type TimelineShot,
} from "./timeline-types";
import { useTimelineExport } from "./use-timeline-export";

export function TimelineView() {
  const ts = useTranslations("storyboard");
  const tc = useTranslations("common");
  const tt = useTranslations("timeline");
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((state) => state.project.currentProjectId);
  const detail = useAppSelector((state) => selectCurrentInstance(state).detail);
  const worldId = useAppSelector((state) => selectCurrentInstance(state).worldId);
  const activeTab = useAppSelector((state) => selectCurrentInstance(state).activeTab);
  const activeEpisodeId = useAppSelector((state) => selectCurrentInstance(state).activeEpisodeId);
  const columns = useAppSelector((state) => selectCurrentInstance(state).columns);
  const rows = useAppSelector((state) => selectCurrentInstance(state).rows);
  const isLoading = useAppSelector((state) => selectCurrentInstance(state).isStoryboardLoading);

  const playerRef = useRef<PlayerRef>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [pxPerSecond, setPxPerSecond] = useState(50);

  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetPickerType, setAssetPickerType] = useState<AssetType>("image");
  const [durationDialogOpen, setDurationDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [durationInput, setDurationInput] = useState("3");
  const [actionShotId, setActionShotId] = useState<string>("");
  const [showAiImage, setShowAiImage] = useState(false);
  const [showAiVideo, setShowAiVideo] = useState(false);
  const [showLipSync, setShowLipSync] = useState(false);

  const [dragState, setDragState] = useState({
    isDragging: false,
    dragIndex: -1,
    hoverIndex: -1,
    dragId: "",
  });

  const columnMap = useMemo(() => {
    const durationColumn = columns.find((column) => column.presetColumnKey === "duration");
    const imageColumn = columns.find((column) => column.presetColumnKey === "image_path");
    const imagePromptColumn = columns.find((column) => column.presetColumnKey === "image_prompt");
    const videoColumn = columns.find((column) => column.presetColumnKey === "video_path");
    const videoPromptColumn = columns.find((column) => column.presetColumnKey === "video_prompt");
    const lipSyncColumn = columns.find(
      (column) => column.presetColumnKey === "video_path_lip_sync"
    );
    return {
      durationColumn,
      imageColumn,
      imagePromptColumn,
      videoColumn,
      videoPromptColumn,
      lipSyncColumn,
    };
  }, [columns]);

  const shots = useMemo(() => extractTimelineShots(rows, columns), [columns, rows]);
  const contentDuration = useMemo(
    () => shots.reduce((sum, shot) => sum + shot.duration, 0),
    [shots]
  );
  const totalDuration = useMemo(
    () => Math.max(contentDuration + TIMELINE_BUFFER, MIN_TIMELINE_DURATION),
    [contentDuration]
  );
  const previewDuration = useMemo(() => Math.max(contentDuration, 0.1), [contentDuration]);
  const timelineMinWidth = useMemo(
    () => totalDuration * pxPerSecond + PLAYHEAD_OFFSET * 2,
    [pxPerSecond, totalDuration]
  );

  const aspectRatio = useMemo(
    () => parseAspectRatioValue(String(detail?.aspectRatioType ?? detail?.aspectRatio ?? "")),
    [detail?.aspectRatio, detail?.aspectRatioType]
  );
  const compositionSize = useMemo(() => getCompositionSize(aspectRatio), [aspectRatio]);

  const previewShots = useMemo(() => {
    return shots.map((shot) => ({
      id: shot.id,
      shotNumber: shot.shotNo,
      description: shot.description,
      dialogue: shot.dialogue,
      narration: shot.narration,
      duration: shot.duration,
      imageUrl: shot.imageUrl || undefined,
      videoUrl: shot.videoUrl || undefined,
    }));
  }, [shots]);

  const compositionProps = useMemo<CompositionProps>(
    () => ({ shots: previewShots as CompositionProps["shots"] }),
    [previewShots]
  );

  const currentShotIndex = useMemo(() => {
    let accumulated = 0;
    for (let index = 0; index < shots.length; index += 1) {
      accumulated += shots[index].duration;
      if (currentTime < accumulated) {
        return index;
      }
    }
    return Math.max(0, shots.length - 1);
  }, [currentTime, shots]);

  const actionShot = useMemo(
    () => shots.find((shot) => shot.id === actionShotId) ?? null,
    [actionShotId, shots]
  );

  const actionShotIndex = useMemo(
    () => shots.findIndex((shot) => shot.id === actionShotId),
    [actionShotId, shots]
  );
  const handlePrevShot =
    actionShotIndex > 0 ? () => setActionShotId(shots[actionShotIndex - 1].id) : undefined;
  const handleNextShot =
    actionShotIndex >= 0 && actionShotIndex < shots.length - 1
      ? () => setActionShotId(shots[actionShotIndex + 1].id)
      : undefined;

  const imagePromptContext = useMemo(() => {
    if (!actionShot) return { prompt: "", referenceFields: [], imagePromptColumnId: "" };
    return buildImagePromptContext(actionShot.row, columnMap.imageColumn, columns, detail);
  }, [actionShot, columnMap.imageColumn, columns, detail]);

  const videoPromptContext = useMemo(() => {
    if (!actionShot) return { prompt: "", referenceFields: [], videoPromptColumnId: "" };
    return buildVideoPromptContext(actionShot.row, columnMap.videoColumn, columns, detail);
  }, [actionShot, columnMap.videoColumn, columns, detail]);

  const syncCell = useCallback(
    (shotId: string, shotColumnId: string, patch: Partial<ShotValue>) => {
      const currentRows = selectCurrentInstance(store.getState()).rows;
      dispatch(setRows(upsertShotCell(currentRows, shotId, shotColumnId, patch)));
    },
    [dispatch]
  );

  const persistTextCell = useCallback(
    async (shotId: string, shotColumnId: string, value: string) => {
      syncCell(shotId, shotColumnId, {
        value,
        richText: { content: value },
      });

      try {
        const result = await backendApi.post("/api/user/shotValue/input", {
          data: { shotId, shotColumnId, value },
        });
        const nextId = resolveShotValueId(result);
        if (nextId) {
          syncCell(shotId, shotColumnId, {
            id: nextId,
            value,
            richText: { content: value },
          });
        }
      } catch (error) {
        console.error("[TimelineView] 保存提示词失败:", error);
        toast.error(ts("saveMaterialFailed"));
        dispatch(touchStoryboard());
      }
    },
    [dispatch, syncCell, ts]
  );

  const persistPreferredMedia = useCallback(
    async (shotId: string, shotColumnId: string, targetPath: string) => {
      const latestRows = selectCurrentInstance(store.getState()).rows;
      const row = latestRows.find((item) => String(item.shotId ?? "") === shotId);
      const currentCell = row?.shotValues?.find(
        (value) => String(value.shotColumnId ?? "") === shotColumnId
      );
      const existingFiles = Array.isArray(currentCell?.files)
        ? (currentCell?.files as TimelineFile[])
        : [];
      const uniquePaths = Array.from(
        new Set([
          targetPath,
          ...existingFiles.map((file) => String(file.path ?? file.url ?? "")).filter(Boolean),
        ])
      );

      const optimisticFiles = buildPreferredFiles(existingFiles, targetPath);
      syncCell(shotId, shotColumnId, {
        id: currentCell?.id,
        files: optimisticFiles,
        value: targetPath,
      });

      try {
        const result = await backendApi.post("/api/user/shotValue/input", {
          data: { shotId, shotColumnId, value: "", values: uniquePaths },
        });
        const nextId = resolveShotValueId(result) || String(currentCell?.id ?? "");
        if (nextId) {
          await backendApi.post(`/api/user/shotValue/preferred/${nextId}`, {
            data: { value: targetPath, preferred: true },
          });
        }
        syncCell(shotId, shotColumnId, {
          id: nextId || currentCell?.id,
          files: optimisticFiles,
          value: targetPath,
        });
      } catch (error) {
        console.error("[TimelineView] 更新素材失败:", error);
        toast.error(ts("updateMaterialFailed"));
        dispatch(touchStoryboard());
      }
    },
    [dispatch, syncCell, ts]
  );

  const persistMediaPaths = useCallback(
    async (
      shotId: string,
      shotColumnId: string,
      nextPaths: string[],
      options?: { preferredPath?: string }
    ) => {
      const latestRows = selectCurrentInstance(store.getState()).rows;
      const row = latestRows.find((item) => String(item.shotId ?? "") === shotId);
      const currentCell = row?.shotValues?.find(
        (value) => String(value.shotColumnId ?? "") === shotColumnId
      );
      const existingFiles = Array.isArray(currentCell?.files)
        ? (currentCell?.files as TimelineFile[])
        : [];
      const uniqueMediaPaths = Array.from(new Set(nextPaths.filter(Boolean)));
      const preferredCandidate =
        options?.preferredPath ??
        String(existingFiles.find((file) => file.preferred)?.path ?? currentCell?.value ?? "");
      const currentPreferredPath = uniqueMediaPaths.includes(preferredCandidate)
        ? preferredCandidate
        : "";
      const optimisticFiles = mergeMediaFiles(
        existingFiles,
        uniqueMediaPaths,
        currentPreferredPath
      );
      const nextValue = currentPreferredPath || uniqueMediaPaths[0] || "";

      syncCell(shotId, shotColumnId, {
        id: currentCell?.id,
        files: optimisticFiles,
        values: uniqueMediaPaths,
        value: nextValue,
      });

      try {
        const result = await backendApi.post("/api/user/shotValue/input", {
          data: { shotId, shotColumnId, value: "", values: uniqueMediaPaths },
        });
        const nextId = resolveShotValueId(result) || String(currentCell?.id ?? "");
        if (nextId && options?.preferredPath) {
          await backendApi.post(`/api/user/shotValue/preferred/${nextId}`, {
            data: { value: options.preferredPath, preferred: true },
          });
        }
        syncCell(shotId, shotColumnId, {
          id: nextId || currentCell?.id,
          files: optimisticFiles,
          values: uniqueMediaPaths,
          value: nextValue,
        });
      } catch (error) {
        console.error("[TimelineView] 保存素材列表失败:", error);
        toast.error(ts("saveMaterialFailed"));
        dispatch(touchStoryboard());
      }
    },
    [dispatch, syncCell, ts]
  );

  const handleSeek = useCallback(
    (nextTime: number) => {
      const clamped = Math.max(0, Math.min(totalDuration, nextTime));
      setCurrentTime(clamped);
      playerRef.current?.seekTo(Math.round(Math.min(clamped, previewDuration) * FPS));
    },
    [previewDuration, totalDuration]
  );

  const handleTogglePlay = useCallback(() => {
    if (!playerRef.current) return;
    if (playerRef.current.isPlaying()) {
      playerRef.current.pause();
    } else {
      playerRef.current.play();
    }
  }, []);

  // Browser-side timeline → MP4 export. Stitches all shots that have
  // a videoUrl into a single file via Mediabunny + WebCodecs (no
  // round-trip to the server). On error, surfaces the message in a
  // toast so the user gets at least the same diagnostic the lipsync
  // dialog now provides; deeper "View error" UX is intentionally
  // deferred until we know whether this PoC sticks.
  const { isExporting, exportProgress, handleExportMp4 } = useTimelineExport(
    previewShots,
    projectId,
    activeEpisodeId
  );

  const handleShotResize = useCallback(
    async (shotId: string, nextDuration: number) => {
      if (!columnMap.durationColumn?.id) return;
      const value = String(nextDuration);

      syncCell(shotId, String(columnMap.durationColumn.id), { value });

      try {
        const result = await backendApi.post("/api/user/shotValue/input", {
          data: { shotId, shotColumnId: String(columnMap.durationColumn.id), value },
        });
        const nextId = resolveShotValueId(result);
        if (nextId) {
          syncCell(shotId, String(columnMap.durationColumn.id), { id: nextId, value });
        }
      } catch (error) {
        console.error("[TimelineView] 保存时长失败:", error);
        toast.error(ts("saveDurationFailed"));
        dispatch(touchStoryboard());
      }
    },
    [columnMap.durationColumn?.id, dispatch, syncCell, ts]
  );

  const handleDownload = useCallback((shot: TimelineShot, type: AssetType) => {
    const preferred =
      type === "video"
        ? (getPreferredFile(shot.lipSyncCell) ?? getPreferredFile(shot.videoCell))
        : getPreferredFile(shot.imageCell);
    const path =
      String(preferred?.path ?? preferred?.url ?? "") ||
      (type === "video"
        ? getAllFilePaths(shot.lipSyncCell)[0] || getAllFilePaths(shot.videoCell)[0]
        : getAllFilePaths(shot.imageCell)[0]) ||
      "";
    const url = ossUrl(path);
    if (!url) return;

    const link = document.createElement("a");
    link.href = url;
    link.download =
      type === "video" ? `shot_${shot.shotNo}_video.mp4` : `shot_${shot.shotNo}_image.jpg`;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleCreateShot = useCallback(
    async (position: "before" | "after", shotId: string) => {
      if (!projectId || !activeEpisodeId) return;
      try {
        let beforeTheShotId: string | undefined;
        const currentIndex = rows.findIndex((row) => String(row.shotId ?? "") === shotId);
        if (position === "before") {
          beforeTheShotId = shotId;
        } else {
          beforeTheShotId =
            currentIndex >= 0 && rows[currentIndex + 1]?.shotId
              ? String(rows[currentIndex + 1]?.shotId ?? "")
              : undefined;
        }

        const result = await backendApi.post<Record<string, unknown>>("/api/user/shot/create", {
          data: { projectId, storyBoardId: activeEpisodeId, beforeTheShotId, enable: true },
        });
        const nextShotId = resolveShotValueId(result);
        if (!nextShotId) {
          throw new Error("Failed to create shot");
        }

        const nextRows = [...rows];
        const insertIndex =
          position === "before"
            ? Math.max(currentIndex, 0)
            : currentIndex >= 0
              ? currentIndex + 1
              : nextRows.length;
        nextRows.splice(insertIndex, 0, { shotId: nextShotId, shotValues: [] });
        dispatch(setRows(nextRows));
        // Stay on the timeline tab — the user just added a shot here, so
        // jumping back to the storyboard table is disorienting. The
        // workspace:focus-shot event is still dispatched in case any
        // listener (e.g. a timeline scroll-into-view handler) wants it.
        requestAnimationFrame(() => {
          window.dispatchEvent(
            new CustomEvent("workspace:focus-shot", { detail: { shotId: nextShotId } })
          );
        });
        toast.success(ts("insertedEmptyShot"));
      } catch (error) {
        console.error("[TimelineView] 创建镜头失败:", error);
        toast.error(ts("createShotFailed"));
      }
    },
    [activeEpisodeId, dispatch, projectId, rows, ts]
  );

  const handleShotAction = useCallback(
    (shot: TimelineShot, action: TimelineMenuAction) => {
      setSelectedShotId(shot.id);
      setActionShotId(shot.id);

      switch (action) {
        case "replaceImage":
          setAssetPickerType("image");
          setAssetPickerOpen(true);
          break;
        case "replaceVideo":
          setAssetPickerType("video");
          setAssetPickerOpen(true);
          break;
        case "aiImage":
          setShowAiImage(true);
          break;
        case "aiVideo":
          setShowAiVideo(true);
          break;
        case "lipSync":
          setShowLipSync(true);
          break;
        case "downloadImage":
          handleDownload(shot, "image");
          break;
        case "downloadVideo":
          handleDownload(shot, "video");
          break;
        case "setDuration":
          setDurationInput(String(shot.duration));
          setDurationDialogOpen(true);
          break;
        case "delete":
          setDeleteDialogOpen(true);
          break;
        case "insertBefore":
          void handleCreateShot("before", shot.id);
          break;
        case "insertAfter":
          void handleCreateShot("after", shot.id);
          break;
      }
    },
    [handleCreateShot, handleDownload]
  );

  const handleReplaceAsset = useCallback(
    async (paths: string[]) => {
      const targetPath = paths[0];
      if (!targetPath || !actionShot) return;

      const columnId =
        assetPickerType === "video"
          ? String(columnMap.videoColumn?.id ?? "")
          : String(columnMap.imageColumn?.id ?? "");
      if (!columnId) return;

      await persistPreferredMedia(actionShot.id, columnId, targetPath);
    },
    [
      actionShot,
      assetPickerType,
      columnMap.imageColumn?.id,
      columnMap.videoColumn?.id,
      persistPreferredMedia,
    ]
  );

  const handleDeleteShot = useCallback(async () => {
    if (!actionShotId) return;
    try {
      await backendApi.post(`/api/user/shot/delete/${actionShotId}`);
      dispatch(setRows(rows.filter((row) => String(row.shotId ?? "") !== actionShotId)));
      if (selectedShotId === actionShotId) {
        setSelectedShotId(null);
      }
      setDeleteDialogOpen(false);
    } catch (error) {
      console.error("[TimelineView] 删除镜头失败:", error);
      toast.error(ts("deleteShotFailed"));
    }
  }, [actionShotId, dispatch, rows, selectedShotId, ts]);

  const handleConfirmDuration = useCallback(async () => {
    if (!actionShotId) return;
    const parsed = Number(durationInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.warning(ts("enterValidDuration"));
      return;
    }
    await handleShotResize(actionShotId, Math.max(MIN_DURATION, Math.min(MAX_DURATION, parsed)));
    setDurationDialogOpen(false);
  }, [actionShotId, durationInput, handleShotResize, ts]);

  const handleDoubleClick = useCallback(
    (shotId: string) => {
      setSelectedShotId(shotId);
      dispatch(setActiveTab("storyboard"));
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("workspace:focus-shot", { detail: { shotId } }));
      });
    },
    [dispatch]
  );

  const handleDragEnd = useCallback(async () => {
    const { dragId, dragIndex, hoverIndex, isDragging } = dragState;
    if (!isDragging || dragIndex < 0 || hoverIndex < 0 || dragIndex === hoverIndex) {
      setDragState({ isDragging: false, dragIndex: -1, hoverIndex: -1, dragId: "" });
      return;
    }
    if (!activeEpisodeId) {
      setDragState({ isDragging: false, dragIndex: -1, hoverIndex: -1, dragId: "" });
      return;
    }

    const visibleIds = shots.map((shot) => shot.id);
    const nextVisibleIds = [...visibleIds];
    const [movedId] = nextVisibleIds.splice(dragIndex, 1);
    nextVisibleIds.splice(hoverIndex, 0, movedId);

    const movedIndex = nextVisibleIds.findIndex((id) => id === dragId);
    const beforeShotId = nextVisibleIds[movedIndex + 1];
    const optimisticRows = moveRowBefore(rows, dragId, beforeShotId);
    dispatch(setRows(optimisticRows));
    setDragState({ isDragging: false, dragIndex: -1, hoverIndex: -1, dragId: "" });

    try {
      await backendApi.post("/api/user/shot/updateSort", {
        data: {
          storyBoardId: activeEpisodeId,
          currentTheShotId: dragId,
          beforeTheShotId: beforeShotId,
        },
      });
    } catch (error) {
      console.error("[TimelineView] 更新镜头顺序失败:", error);
      toast.error(ts("updateOrderFailed"));
      dispatch(touchStoryboard());
    }
  }, [activeEpisodeId, dispatch, dragState, rows, shots, ts]);

  useEffect(() => {
    setSelectedShotId(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setIsDraggingPlayhead(false);
    setActionShotId("");
    setAssetPickerOpen(false);
    setShowAiImage(false);
    setShowAiVideo(false);
    setShowLipSync(false);
    setDurationDialogOpen(false);
    setDeleteDialogOpen(false);
    setDragState({ isDragging: false, dragIndex: -1, hoverIndex: -1, dragId: "" });
    playerRef.current?.pause();
    playerRef.current?.seekTo(0);
  }, [activeEpisodeId]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const handleTimeUpdate = ({ detail }: { detail: { frame: number } }) => {
      setCurrentTime(detail.frame / FPS);
    };
    const handleEnded = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    player.addEventListener("timeupdate", handleTimeUpdate);
    player.addEventListener("ended", handleEnded);
    player.addEventListener("play", handlePlay);
    player.addEventListener("pause", handlePause);

    return () => {
      player.removeEventListener("timeupdate", handleTimeUpdate);
      player.removeEventListener("ended", handleEnded);
      player.removeEventListener("play", handlePlay);
      player.removeEventListener("pause", handlePause);
    };
  }, [compositionProps]);

  useEffect(() => {
    if (activeTab !== "timeline") {
      playerRef.current?.pause();
    }
  }, [activeTab]);

  useEffect(() => {
    if (currentTime > totalDuration) {
      handleSeek(Math.max(0, totalDuration));
    }
  }, [currentTime, handleSeek, totalDuration]);

  useEffect(() => {
    if (!isPlaying || !scrollAreaRef.current) return;

    const scrollArea = scrollAreaRef.current;
    const visibleWidth = scrollArea.clientWidth;
    const playheadScreenX = visibleWidth * PLAYHEAD_SCREEN_POSITION;
    const playheadTimelineX = currentTime * pxPerSecond + PLAYHEAD_OFFSET;
    const targetScroll = playheadTimelineX - playheadScreenX;
    scrollArea.scrollLeft = Math.max(0, targetScroll);
  }, [currentTime, isPlaying, pxPerSecond]);

  const handleTrackClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-shot-card='true']")) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left - PLAYHEAD_OFFSET;
      handleSeek(x / pxPerSecond);
    },
    [handleSeek, pxPerSecond]
  );

  const handleRulerClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      handleSeek((x - PLAYHEAD_OFFSET) / pxPerSecond);
    },
    [handleSeek, pxPerSecond]
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      const nextZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, pxPerSecond + (event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP))
      );

      if (!scrollAreaRef.current) {
        setPxPerSecond(nextZoom);
        return;
      }

      const rect = scrollAreaRef.current.getBoundingClientRect();
      const mouseX = event.clientX - rect.left + scrollAreaRef.current.scrollLeft;
      const timeAtMouse = mouseX / pxPerSecond;

      setPxPerSecond(nextZoom);

      requestAnimationFrame(() => {
        if (!scrollAreaRef.current) return;
        const nextMouseX = timeAtMouse * nextZoom;
        scrollAreaRef.current.scrollLeft += nextMouseX - mouseX;
      });
    },
    [pxPerSecond]
  );

  if (!activeEpisodeId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{ts("episodeNotSelected")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden" onWheel={handleWheel}>
        <div
          data-tour-step="timeline-preview"
          className="flex min-min-h-100 flex-1 flex-col items-center justify-center overflow-auto p-4"
        >
          {isLoading ? (
            <div className="flex h-[383px] w-[680px] flex-col items-center justify-center gap-4 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]">
              <IconLoader2 className="size-10 animate-spin text-[#4A94FF]" />
              <span className="text-sm text-[#888]">{tc("loading")}</span>
            </div>
          ) : shots.length === 0 ? (
            <div className="flex h-[383px] w-[680px] flex-col items-center justify-center gap-3 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] text-center">
              <div className="text-[#444]">
                <svg
                  width="64"
                  height="64"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
              <span className="text-base font-medium text-[#888]">{tt("noPreviewShots")}</span>
              <span className="text-[13px] text-[#555]">{tt("noPreviewShotsHint")}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="overflow-hidden rounded bg-black">
                <Player
                  ref={playerRef}
                  component={StoryboardComposition}
                  inputProps={compositionProps}
                  durationInFrames={Math.max(Math.round(previewDuration * FPS), 1)}
                  fps={FPS}
                  compositionWidth={compositionSize.width}
                  compositionHeight={compositionSize.height}
                  style={{
                    width: 680,
                    aspectRatio: `${compositionSize.width}/${compositionSize.height}`,
                  }}
                  controls={false}
                  autoPlay={false}
                  loop={false}
                  clickToPlay={false}
                  doubleClickToFullscreen={false}
                  spaceKeyToPlayOrPause={false}
                  showPosterWhenPaused={false}
                  showPosterWhenUnplayed={false}
                  moveToBeginningWhenEnded={false}
                  acknowledgeRemotionLicense
                />
              </div>
              <div className="text-sm text-muted-foreground">
                {tt("shotProgress", {
                  current: Math.min(currentShotIndex + 1, Math.max(shots.length, 1)),
                  total: shots.length,
                })}
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0">
          <div className="flex items-center gap-3 border-b border-[#2A2A2A] bg-[#1A1A1A] px-3 py-3">
            <Button
              variant="ghost"
              color="muted"
              size="icon-sm"
              className="text-[#E0E0E0] hover:bg-white/10 hover:text-white"
              onClick={handleTogglePlay}
              disabled={shots.length === 0}
            >
              {isPlaying ? (
                <IconPlayerPause className="size-4.5" />
              ) : (
                <IconPlayerPlay className="size-4.5" />
              )}
            </Button>

            <div className="flex items-baseline font-mono text-sm">
              <span className="font-medium text-[#E0E0E0]">{formatClock(currentTime)}</span>
              <span className="mx-2 text-[#666]">/</span>
              <span className="text-[#888]">{formatClock(contentDuration)}</span>
            </div>

            {/* Client-side MP4 export via Mediabunny. Sits in the
                play-bar so it reads as "what to do with this preview"
                next to playhead controls. While exporting, swap to a
                spinner + percent label and disable the click. */}
            <Button
              variant="ghost"
              color="muted"
              size="sm"
              className="ml-auto gap-1.5 text-[#E0E0E0] hover:bg-white/10 hover:text-white"
              onClick={() => void handleExportMp4()}
              disabled={shots.length === 0 || isExporting}
              title={tt("exportMp4")}
            >
              {isExporting ? (
                <>
                  <IconLoader2 className="size-4 animate-spin" />
                  <span className="font-mono text-xs tabular-nums">
                    {Math.round(exportProgress * 100)}%
                  </span>
                </>
              ) : (
                <>
                  <IconDownload className="size-4" />
                  <span className="text-xs">{tt("exportMp4")}</span>
                </>
              )}
            </Button>
          </div>

          <div ref={scrollAreaRef} className="overflow-x-auto overflow-y-hidden">
            <div
              className="relative min-w-max"
              style={{ minWidth: timelineMinWidth, paddingTop: RULER_HEIGHT }}
            >
              {/* Single canvas: ruler (top 32px) + track grid background */}
              <TimelineRuler duration={totalDuration} pxPerSecond={pxPerSecond} trackHeight={160} />

              {/* Ruler click zone */}
              <div
                data-tour-step="timeline-ruler"
                className="absolute left-0 right-0 top-0 z-10 cursor-pointer"
                style={{ height: RULER_HEIGHT }}
                onClick={handleRulerClick}
              />

              {/* Track area (DOM layer on top of canvas grid) */}
              <div
                data-tour-step="timeline-track"
                className="relative z-10 h-40 shrink-0"
                onClick={handleTrackClick}
              >
                {isLoading ? (
                  <div className="flex h-full items-center justify-center px-3 text-sm text-[#666]">
                    {tt("loadingShots")}
                  </div>
                ) : shots.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-3 text-sm text-[#666]">
                    {tt("noShots")}
                  </div>
                ) : (
                  <div
                    className={cn(
                      "flex h-full items-stretch px-3 py-3",
                      dragState.isDragging && "cursor-grabbing"
                    )}
                  >
                    {shots.map((shot, index) => {
                      const showLeftIndicator =
                        dragState.isDragging &&
                        dragState.hoverIndex === index &&
                        dragState.dragIndex > index;
                      const showRightIndicator =
                        dragState.isDragging &&
                        dragState.hoverIndex === index &&
                        dragState.dragIndex < index;

                      return (
                        <div key={shot.id} className="flex h-full items-stretch">
                          {showLeftIndicator ? (
                            <div className="mx-1 w-[3px] rounded-full bg-primary" />
                          ) : null}

                          <div data-shot-card="true">
                            <TimelineShotCard
                              shot={shot}
                              width={getShotWidth(shot.duration, pxPerSecond)}
                              selected={selectedShotId === shot.id}
                              playing={isPlaying && currentShotIndex === index}
                              canLipSync={Boolean(columnMap.lipSyncColumn?.id)}
                              pxPerSecond={pxPerSecond}
                              onClick={() => setSelectedShotId(shot.id)}
                              onDoubleClick={() => handleDoubleClick(shot.id)}
                              onAction={(action) => handleShotAction(shot, action)}
                              onDragStart={() =>
                                setDragState({
                                  isDragging: true,
                                  dragIndex: index,
                                  hoverIndex: index,
                                  dragId: shot.id,
                                })
                              }
                              onDragOver={() =>
                                setDragState((state) =>
                                  state.isDragging && state.dragId !== shot.id
                                    ? { ...state, hoverIndex: index }
                                    : state
                                )
                              }
                              onDragEnd={() => void handleDragEnd()}
                              onResize={(nextDuration) =>
                                void handleShotResize(shot.id, nextDuration)
                              }
                            />
                          </div>

                          {showRightIndicator ? (
                            <div className="mx-1 w-[3px] rounded-full bg-primary" />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}

                <TimelinePlayhead
                  currentTime={currentTime}
                  pxPerSecond={pxPerSecond}
                  maxTime={totalDuration}
                  showTime={isDraggingPlayhead}
                  onSeek={handleSeek}
                  onSeekStart={() => setIsDraggingPlayhead(true)}
                  onSeekEnd={() => setIsDraggingPlayhead(false)}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[#2A2A2A] bg-[#111] px-4 py-2">
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded bg-[#1A1A1A] text-[#B0B0B0] transition-colors hover:bg-[#242424] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => setPxPerSecond((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))}
              disabled={pxPerSecond <= MIN_ZOOM}
            >
              -
            </button>
            <span className="min-w-16 text-center text-xs text-[#888]">
              {Math.round(pxPerSecond)} px/s
            </span>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded bg-[#1A1A1A] text-[#B0B0B0] transition-colors hover:bg-[#242424] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => setPxPerSecond((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))}
              disabled={pxPerSecond >= MAX_ZOOM}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <AssetPickerDialog
        open={assetPickerOpen}
        onOpenChange={setAssetPickerOpen}
        assetType={assetPickerType === "image" ? "img" : "video"}
        multiple={false}
        onSelect={(paths) => void handleReplaceAsset(paths)}
      />

      {actionShot && columnMap.imageColumn?.id ? (
        <AiImageGeneratorDialog
          open={showAiImage}
          onOpenChange={setShowAiImage}
          shotId={actionShot.id}
          shotColumnId={String(columnMap.imageColumn.id)}
          shotNumber={actionShot.shotNo}
          defaultPrompt={imagePromptContext.prompt}
          defaultRefImage={actionShot.imageUrl || undefined}
          referenceFields={imagePromptContext.referenceFields}
          appliedPaths={getAllFilePaths(actionShot.imageCell)}
          preferredPath={getPreferredFile(actionShot.imageCell)?.path ?? ""}
          onPrevShot={handlePrevShot}
          onNextShot={handleNextShot}
          onGeneratePrompt={(prompt) => {
            if (imagePromptContext.imagePromptColumnId) {
              void persistTextCell(actionShot.id, imagePromptContext.imagePromptColumnId, prompt);
            }
          }}
          onSetPreferred={(item) => {
            const path = item.storagePath ?? "";
            if (!path) return;
            void persistPreferredMedia(
              actionShot.id,
              String(columnMap.imageColumn?.id ?? ""),
              path
            );
          }}
        />
      ) : null}

      {actionShot && columnMap.videoColumn?.id ? (
        <AiVideoGeneratorDialog
          open={showAiVideo}
          onOpenChange={setShowAiVideo}
          shotId={actionShot.id}
          shotColumnId={String(columnMap.videoColumn.id)}
          shotNumber={actionShot.shotNo}
          defaultPrompt={videoPromptContext.prompt}
          defaultReferenceImage={actionShot.imageUrl || undefined}
          referenceFields={videoPromptContext.referenceFields}
          appliedPaths={getAllFilePaths(actionShot.videoCell)}
          preferredPath={getPreferredFile(actionShot.videoCell)?.path ?? ""}
          onPrevShot={handlePrevShot}
          onNextShot={handleNextShot}
          onGeneratePrompt={(prompt) => {
            if (videoPromptContext.videoPromptColumnId) {
              void persistTextCell(actionShot.id, videoPromptContext.videoPromptColumnId, prompt);
            }
          }}
          onSetPreferred={(item) => {
            const path = item.storagePath ?? "";
            if (!path) return;
            void persistPreferredMedia(
              actionShot.id,
              String(columnMap.videoColumn?.id ?? ""),
              path
            );
          }}
        />
      ) : null}

      {actionShot && columnMap.lipSyncColumn?.id ? (
        <AiLipSyncGeneratorDialog
          open={showLipSync}
          onOpenChange={setShowLipSync}
          shotId={actionShot.id}
          shotColumnId={String(columnMap.lipSyncColumn.id)}
          shotNumber={actionShot.shotNo}
          row={actionShot.row}
          worldId={worldId ?? ""}
          defaultReferenceVideo={
            String(getPreferredFile(actionShot.videoCell)?.path ?? actionShot.baseVideoUrl ?? "") ||
            undefined
          }
          defaultReferenceAudio={
            String(
              getPreferredFile(actionShot.audioCell)?.path ??
                getPreferredFile(actionShot.audioCell)?.url ??
                actionShot.audioCell?.value ??
                ""
            ) || undefined
          }
          appliedPaths={getAllFilePaths(actionShot.lipSyncCell)}
          preferredPath={getPreferredFile(actionShot.lipSyncCell)?.path ?? ""}
          onCollect={(item) => {
            const path = item.storagePath ?? "";
            if (!path) return;
            const nextPaths = Array.from(
              new Set([...getAllFilePaths(actionShot.lipSyncCell), path].filter(Boolean))
            );
            void persistMediaPaths(
              actionShot.id,
              String(columnMap.lipSyncColumn?.id ?? ""),
              nextPaths
            );
          }}
          onSetPreferred={(item) => {
            const path = item.storagePath ?? "";
            if (!path) return;
            const nextPaths = Array.from(
              new Set([...getAllFilePaths(actionShot.lipSyncCell), path].filter(Boolean))
            );
            void persistMediaPaths(
              actionShot.id,
              String(columnMap.lipSyncColumn?.id ?? ""),
              nextPaths,
              {
                preferredPath: path,
              }
            );
          }}
        />
      ) : null}

      <Dialog open={durationDialogOpen} onOpenChange={setDurationDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{ts("shotDuration")}</DialogTitle>
            <DialogDescription className="sr-only">{tt("setDurationDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">{tt("enterSeconds")}</div>
            <Input
              type="number"
              min={MIN_DURATION}
              max={MAX_DURATION}
              step={0.5}
              value={durationInput}
              onChange={(event) => setDurationInput(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" color="muted" onClick={() => setDurationDialogOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => void handleConfirmDuration()}>{tc("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tc("delete")}</AlertDialogTitle>
            <AlertDialogDescription>{tt("confirmDeleteShot")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="soft"
              color="destructive"
              onClick={() => void handleDeleteShot()}
            >
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
