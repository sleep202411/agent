"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppSelector } from "@/src/store";
import { selectCurrentInstance } from "@/src/store/slices/projectSlice";
import { makeSelectTasksByShot } from "@/src/store/slices/taskSlice";
import { submitLipSyncTask, retryLipSyncTask } from "@/src/lib/ai-lipsync-queue";
import { persistDialogueText } from "@/app/projects/_components/storyboard/cells/cell-utils";
import { AssetPickerDialog } from "@/components/assets/asset-picker-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations } from "@/src/i18n/i18n";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { RawAiModel, VoiceOptionItem } from "@/src/types/workspace";
import { useRawAiModels } from "@/src/hooks/use-ai-models";
import { AI_MODEL_PATHS } from "@/components/ui/schema-field/paths";
import {
  getDialogueTextFromShotValues,
  resolveDialogueVoicePreset,
} from "@/src/lib/storyboard-dialogue";
import { LipsyncAudioPanel } from "./lipsync-audio-panel";
import { LipsyncVideoPanel } from "./lipsync-video-panel";
import {
  ossUrl,
  getPreferredFilePath,
  uniquePaths,
  parseMediaResultPath,
  toAudioHistoryItem,
  buildVideoHistory,
  type AiLipSyncGeneratorDialogProps,
  type AudioResultItem,
  type VideoResultItem,
  type PickerTarget,
  type AssetRecord,
} from "./lipsync-types";

export function AiLipSyncGeneratorDialog({
  open,
  onOpenChange,
  shotId,
  shotColumnId,
  shotNumber,
  row,
  worldId,
  defaultReferenceVideo,
  defaultReferenceAudio,
  defaultReferenceFace,
  appliedPaths = [],
  preferredPath = "",
  onCollect,
  onSetPreferred,
  onGeneratingChange,
  onGenerateSuccess,
}: AiLipSyncGeneratorDialogProps) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const { models: cachedLipSyncModels } = useRawAiModels(AI_MODEL_PATHS.lipSync);
  const { models: cachedVoiceModels } = useRawAiModels(AI_MODEL_PATHS.voice);
  const lipSyncModels = cachedLipSyncModels as RawAiModel[];
  const voiceModels = cachedVoiceModels as RawAiModel[];
  const [voiceGroups, setVoiceGroups] = useState<Record<string, VoiceOptionItem[]>>({});
  const [activeVoiceLang, setActiveVoiceLang] = useState("");
  const [lipSyncModel, setLipSyncModel] = useState("");
  const [voiceModel, setVoiceModel] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [referenceVideo, setReferenceVideo] = useState("");
  const [referenceAudio, setReferenceAudio] = useState("");
  const [referenceFace, setReferenceFace] = useState("");
  const [narrationText, setNarrationText] = useState("");
  const [videoHistory, setVideoHistory] = useState<VideoResultItem[]>([]);
  const [audioHistory, setAudioHistory] = useState<AudioResultItem[]>([]);
  const [audioQueue, setAudioQueue] = useState<AudioResultItem[]>([]);
  const [currentPreviewPath, setCurrentPreviewPath] = useState("");
  const [playingAudioPath, setPlayingAudioPath] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState("");
  const [loadingVideoHistory, setLoadingVideoHistory] = useState(false);
  const [loadingAudioHistory, setLoadingAudioHistory] = useState(false);
  const [loadingLipSyncModels, setLoadingLipSyncModels] = useState(false);
  const [loadingVoiceModels, setLoadingVoiceModels] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);

  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const voicePreviewRef = useRef<HTMLAudioElement | null>(null);
  // Gate the init effect so it runs exactly once per open cycle. Without
  // this, any Redux update that bumps `row.shotValues` (e.g. the post-
  // generate writeback from /ai/voice/synthesize) would re-fire the effect
  // and clobber user-edited state — most visibly the narration textarea
  // gets reset to the dialogue cell text mid-typing.
  const initializedRef = useRef(false);

  // ─── Derived state ───────────────────────────────────

  const shotValues = useMemo(() => row?.shotValues ?? [], [row?.shotValues]);
  const baseVideoCell = useMemo(
    () => shotValues.find((item) => item.presetColumnKey === "video_path"),
    [shotValues]
  );
  const audioCell = useMemo(
    () => shotValues.find((item) => item.presetColumnKey === "sound_path"),
    [shotValues]
  );
  const columns = useAppSelector((s) => selectCurrentInstance(s).columns);
  const audioColumnId = useMemo(() => {
    // Prefer shotValues cell, fallback to column definition
    if (audioCell?.shotColumnId) return String(audioCell.shotColumnId);
    const col = columns.find((c) => c.presetColumnKey === "sound_path");
    return col?.id ? String(col.id) : "";
  }, [audioCell, columns]);

  // Lip-sync task queue lives in Redux (taskSlice) so it survives dialog
  // close/reopen cycles. A generation started in one session shows up as
  // "generating" when the user reopens the dialog, and the result lands
  // automatically via the watcher effect below when the task completes.
  // Factory-style createSelector: returns the same array reference when the
  // filtered set is unchanged, so unrelated dispatches don't re-render the
  // whole dialog. Same pattern as video-dialog.tsx.
  const selectShotTasks = useMemo(() => makeSelectTasksByShot(), []);
  const allTasks = useAppSelector((s) => selectShotTasks(s, shotId, shotColumnId));
  const lipSyncTasks = useMemo(
    () => allTasks.filter((task) => task.type === "lip_sync"),
    [allTasks]
  );
  const videoQueue = useMemo<VideoResultItem[]>(
    () =>
      lipSyncTasks.map((task): VideoResultItem => {
        const path = task.output?.storagePath ?? "";
        let status: VideoResultItem["status"];
        if (task.status === "failed") status = "failed";
        else if (task.status === "pending" || task.status === "running") status = "generating";
        return {
          id: task.id,
          path,
          name: path ? `LipSync_${task.createdAt}` : undefined,
          status,
        };
      }),
    [lipSyncTasks]
  );
  // Dedupe by path so a completed task + its refetched history counterpart
  // don't both render as separate cards after `loadVideoHistory` runs.
  const allVideoItems = useMemo<VideoResultItem[]>(() => {
    const seen = new Set<string>();
    const merged: VideoResultItem[] = [];
    for (const item of [...videoQueue, ...videoHistory]) {
      const key = item.path || `id:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged;
  }, [videoHistory, videoQueue]);
  const allAudioItems = useMemo(() => [...audioQueue, ...audioHistory], [audioHistory, audioQueue]);
  const currentPreviewItem = useMemo(
    () => allVideoItems.find((item) => item.path === currentPreviewPath) ?? null,
    [allVideoItems, currentPreviewPath]
  );
  const voiceLangOptions = useMemo(() => Object.keys(voiceGroups), [voiceGroups]);
  const currentVoices = useMemo(
    () => (activeVoiceLang ? (voiceGroups[activeVoiceLang] ?? []) : []),
    [activeVoiceLang, voiceGroups]
  );
  const isGenerating = useMemo(
    () =>
      videoQueue.some((item) => item.status === "generating") ||
      audioQueue.some((item) => item.status === "generating"),
    [audioQueue, videoQueue]
  );
  // Remember which completed tasks we've already notified the parent about,
  // so re-renders don't re-fire onCollect. Using a Set<string> ref lives
  // across renders without triggering one itself.
  const notifiedTaskIdsRef = useRef<Set<string>>(new Set());
  // Snapshot the narration text we seeded from the dialogue cell so that on
  // Generate we only write back to the cell if the user actually edited it.
  // The seed goes through `stripDialogueRoleLines`, which drops 角色：/台词：
  // /旁白： structure — writing the stripped text back blindly would destroy
  // speaker attribution and break `resolveDialogueVoicePreset` auto-match.
  const initialNarrationRef = useRef<string>("");
  const lipSyncModelCost = Math.abs(
    Number(
      lipSyncModels.find((item) => String(item.serviceCode ?? "") === lipSyncModel)?.integralCost ??
        0
    )
  );
  const voiceModelCost = Math.abs(
    Number(
      voiceModels.find((item) => String(item.serviceCode ?? "") === voiceModel)?.integralCost ?? 0
    )
  );
  const title = shotNumber
    ? t("aiLipSyncTitle", { number: shotNumber })
    : t("aiLipSyncTitleDefault");
  const previewIsPreferred = currentPreviewItem?.path
    ? currentPreviewItem.path === preferredPath
    : false;

  // ─── Audio/voice helpers ─────────────────────────────

  const stopAudioPreview = useCallback(() => {
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current = null;
    }
    setPlayingAudioPath("");
  }, []);

  const stopVoicePreview = useCallback(() => {
    if (voicePreviewRef.current) {
      voicePreviewRef.current.pause();
      voicePreviewRef.current = null;
    }
    setPlayingVoiceId("");
  }, []);

  const loadVoices = useCallback(
    async (modelCode: string, preferredVoiceId?: string) => {
      if (!modelCode) {
        setVoiceGroups({});
        setActiveVoiceLang("");
        setVoiceId("");
        return;
      }
      setLoadingVoices(true);
      stopVoicePreview();
      try {
        const groups =
          (await backendApi.get<Record<string, VoiceOptionItem[]>>("/api/ai/voice/voices/list", {
            params: { voiceType: modelCode },
          })) ?? {};
        setVoiceGroups(groups);
        const firstLang = Object.keys(groups)[0] ?? "";
        setActiveVoiceLang(firstLang);
        // Prefer the caller-supplied voice (from dialogue cell preset).
        // Fall back to the first voice in the first language group so the
        // panel has a sensible default instead of "Select Voice" forever.
        const matched = preferredVoiceId
          ? Object.values(groups)
              .flat()
              .find((item) => String(item.voiceId ?? "") === String(preferredVoiceId))
          : undefined;
        const fallback = firstLang ? groups[firstLang]?.[0] : undefined;
        const chosen = matched ?? fallback;
        setVoiceId(chosen?.voiceId ? String(chosen.voiceId) : "");
      } catch (error) {
        console.error("[AiLipSyncGeneratorDialog] 加载音色失败:", error);
        toast.error(t("loadVoicesFailed"));
      } finally {
        setLoadingVoices(false);
      }
    },
    [stopVoicePreview]
  );

  // ─── History loading ─────────────────────────────────

  const loadVideoHistory = useCallback(async () => {
    setLoadingVideoHistory(true);
    try {
      const data = await backendApi.post<Paginated<AssetRecord>>("/api/ai/record/shot/list", {
        data: { page: 1, pageSize: 50, shotId, shotcolumnId: shotColumnId, type: "video", sort: 1 },
      });
      const nextHistory = buildVideoHistory(appliedPaths, preferredPath, data?.list ?? []);
      setVideoHistory(nextHistory);
      setCurrentPreviewPath((current) => current || preferredPath || nextHistory[0]?.path || "");
    } catch (error) {
      console.error("[AiLipSyncGeneratorDialog] 加载对口型历史失败:", error);
      const nextHistory = buildVideoHistory(appliedPaths, preferredPath, []);
      setVideoHistory(nextHistory);
      setCurrentPreviewPath((current) => current || preferredPath || nextHistory[0]?.path || "");
    } finally {
      setLoadingVideoHistory(false);
    }
  }, [appliedPaths, preferredPath, shotColumnId, shotId]);

  const loadAudioHistory = useCallback(async () => {
    if (!audioColumnId) {
      const fallbackPaths = uniquePaths([defaultReferenceAudio, getPreferredFilePath(audioCell)]);
      setAudioHistory(fallbackPaths.map((path) => ({ id: path, path })));
      return;
    }
    setLoadingAudioHistory(true);
    try {
      const data = await backendApi.post<Paginated<AssetRecord>>("/api/ai/record/shot/list", {
        data: {
          page: 1,
          pageSize: 50,
          shotId,
          shotcolumnId: audioColumnId,
          type: "audio",
          sort: 1,
        },
      });
      const recordItems = (data?.list ?? [])
        .map(toAudioHistoryItem)
        .filter((item): item is AudioResultItem => Boolean(item));
      const mergedPaths = uniquePaths([
        defaultReferenceAudio,
        getPreferredFilePath(audioCell),
        ...recordItems.map((item) => item.path),
      ]);
      setAudioHistory(
        mergedPaths.map(
          (path) => recordItems.find((item) => item.path === path) ?? { id: path, path }
        )
      );
    } catch (error) {
      console.error("[AiLipSyncGeneratorDialog] 加载音频历史失败:", error);
      const fallbackPaths = uniquePaths([defaultReferenceAudio, getPreferredFilePath(audioCell)]);
      setAudioHistory(fallbackPaths.map((path) => ({ id: path, path })));
    } finally {
      setLoadingAudioHistory(false);
    }
  }, [audioCell, audioColumnId, defaultReferenceAudio, shotId]);

  // ─── Effects ─────────────────────────────────────────

  useEffect(() => {
    onGeneratingChange?.(isGenerating);
  }, [isGenerating, onGeneratingChange]);

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      stopAudioPreview();
      stopVoicePreview();
      return;
    }

    // Skip if we've already initialized for this open cycle, or if the model
    // lists haven't arrived yet (they load async via useRawAiModels, so the
    // first fire typically has them empty — we'll get another fire once
    // they populate).
    if (initializedRef.current) return;
    if (lipSyncModels.length === 0 || voiceModels.length === 0) return;

    initializedRef.current = true;

    let active = true;
    const nextReferenceVideo = defaultReferenceVideo || getPreferredFilePath(baseVideoCell);
    const nextReferenceAudio = defaultReferenceAudio || getPreferredFilePath(audioCell);

    // Don't clear the lip-sync queue here — it's owned by Redux now and
    // must survive dialog close/reopen. Only the local audio preview queue
    // gets reset.
    setAudioQueue([]);
    setReferenceVideo(nextReferenceVideo);
    setReferenceAudio(nextReferenceAudio);
    setReferenceFace(defaultReferenceFace || "");
    const seededNarration = getDialogueTextFromShotValues(shotValues);
    setNarrationText(seededNarration);
    initialNarrationRef.current = seededNarration;
    setCurrentPreviewPath(preferredPath || "");

    const initialize = async () => {
      setLoadingLipSyncModels(true);
      setLoadingVoiceModels(true);
      try {
        const voicePreset =
          row && worldId
            ? await resolveDialogueVoicePreset({ shotValues, worldId })
            : { voiceId: "", model: "", speakerName: "", referenceFacePath: "" };

        if (!active) return;

        const defaultLipSyncModel =
          String(
            lipSyncModels.find((item) => item.isDefault)?.serviceCode ??
              lipSyncModels[0]?.serviceCode ??
              ""
          ) || "";
        const defaultVoiceModelCode =
          String(
            (voicePreset?.model &&
            voiceModels.some((item) => item.serviceCode === voicePreset.model)
              ? voicePreset.model
              : (voiceModels.find((item) => item.isDefault)?.serviceCode ??
                voiceModels[0]?.serviceCode)) ?? ""
          ) || "";

        setLipSyncModel(defaultLipSyncModel);
        setVoiceModel(defaultVoiceModelCode);
        setVoiceId(String(voicePreset?.voiceId ?? ""));
        if (!defaultReferenceFace && voicePreset?.referenceFacePath) {
          setReferenceFace(voicePreset.referenceFacePath);
        }

        if (defaultVoiceModelCode) {
          void loadVoices(defaultVoiceModelCode, String(voicePreset?.voiceId ?? ""));
        } else {
          setVoiceGroups({});
          setActiveVoiceLang("");
          setVoiceId("");
        }

        void loadVideoHistory();
        void loadAudioHistory();
      } catch (error) {
        console.error("[AiLipSyncGeneratorDialog] 初始化失败:", error);
        toast.error(t("initLipSyncFailed"));
      } finally {
        if (active) {
          setLoadingLipSyncModels(false);
          setLoadingVoiceModels(false);
        }
      }
    };

    void initialize();
    return () => {
      active = false;
    };
  }, [
    audioCell,
    baseVideoCell,
    defaultReferenceAudio,
    defaultReferenceFace,
    defaultReferenceVideo,
    loadAudioHistory,
    loadVideoHistory,
    loadVoices,
    open,
    lipSyncModels,
    preferredPath,
    row,
    shotValues,
    stopAudioPreview,
    stopVoicePreview,
    voiceModels,
    worldId,
  ]);

  useEffect(() => {
    if (open || !currentPreviewPath) return;
    setCurrentPreviewPath("");
  }, [currentPreviewPath, open]);

  useEffect(() => {
    if (!open || currentPreviewPath) return;
    const firstAvailable = allVideoItems.find((item) => item.path)?.path ?? "";
    if (firstAvailable) setCurrentPreviewPath(firstAvailable);
  }, [allVideoItems, currentPreviewPath, open]);

  // Seed the "already notified" set on open so tasks that were completed
  // BEFORE this dialog session (e.g. finished while the dialog was closed,
  // or persisted across a remount) don't re-trigger onCollect/preview side
  // effects on mount. Only transitions that happen DURING this session fire.
  useEffect(() => {
    if (!open) {
      notifiedTaskIdsRef.current = new Set();
      return;
    }
    const seeded = new Set<string>();
    for (const task of lipSyncTasks) {
      if (task.status === "completed") seeded.add(task.id);
    }
    notifiedTaskIdsRef.current = seeded;
    // Intentional: seed only when `open` flips. Changes to `lipSyncTasks`
    // inside the same session are handled by the watcher below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Watch lip-sync task transitions and forward completions to the parent
  // so the merged video path lands in the video_path_lip_sync cell and the
  // preview updates. Keeping this centralized here (rather than inline in
  // handleGenerateVideo) means a task completing AFTER dialog close+reopen
  // within the same session also gets persisted.
  useEffect(() => {
    if (!open) return;
    for (const task of lipSyncTasks) {
      if (task.status !== "completed") continue;
      if (notifiedTaskIdsRef.current.has(task.id)) continue;
      const path = task.output?.storagePath;
      if (!path) continue;
      notifiedTaskIdsRef.current.add(task.id);
      const payload = { id: path, storagePath: path, url: ossUrl(path) };
      onCollect?.(payload);
      if (!preferredPath && appliedPaths.length === 0) {
        onSetPreferred?.(payload);
      }
      setCurrentPreviewPath(path);
      onGenerateSuccess?.();
      toast.success(tc("generateSuccess"));
    }
  }, [
    lipSyncTasks,
    open,
    onCollect,
    onSetPreferred,
    onGenerateSuccess,
    preferredPath,
    appliedPaths,
    tc,
  ]);

  // Surface failed-task error toasts once per failure so the user doesn't
  // just see a silent red retry card. Uses the same notified-set trick.
  const notifiedFailuresRef = useRef<Set<string>>(new Set());
  // Mirror of the completion seed: on dialog open, treat already-failed
  // tasks as "already toasted" so historical failures don't re-toast every
  // reopen. Only NEW failure transitions during this session fire.
  useEffect(() => {
    if (!open) {
      notifiedFailuresRef.current = new Set();
      return;
    }
    const seeded = new Set<string>();
    for (const task of lipSyncTasks) {
      if (task.status === "failed") seeded.add(task.id);
    }
    notifiedFailuresRef.current = seeded;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    for (const task of lipSyncTasks) {
      if (task.status !== "failed") continue;
      if (notifiedFailuresRef.current.has(task.id)) continue;
      notifiedFailuresRef.current.add(task.id);
      toast.error(tc("generateFailed"));
    }
  }, [lipSyncTasks, open, tc]);

  // ─── Action handlers ─────────────────────────────────

  const handleVoiceModelChange = async (modelCode: string) => {
    setVoiceModel(modelCode);
    await loadVoices(modelCode);
  };

  const handleToggleAudioPreview = (path: string) => {
    if (!path) return;
    if (playingAudioPath === path) {
      stopAudioPreview();
      return;
    }
    stopAudioPreview();
    const audio = new Audio(ossUrl(path));
    audioPreviewRef.current = audio;
    audio.onended = () => setPlayingAudioPath("");
    audio.onerror = () => setPlayingAudioPath("");
    audio
      .play()
      .then(() => setPlayingAudioPath(path))
      .catch(() => setPlayingAudioPath(""));
  };

  const handleToggleVoicePreview = (voice: VoiceOptionItem) => {
    const nextVoiceId = String(voice.voiceId ?? "");
    if (!nextVoiceId) return;
    if (playingVoiceId === nextVoiceId) {
      stopVoicePreview();
      return;
    }
    stopVoicePreview();
    const audio = new Audio(ossUrl(String(voice.voicePath ?? "")));
    voicePreviewRef.current = audio;
    audio.onended = () => setPlayingVoiceId("");
    audio.onerror = () => setPlayingVoiceId("");
    audio
      .play()
      .then(() => setPlayingVoiceId(nextVoiceId))
      .catch(() => setPlayingVoiceId(""));
  };

  const handleDownload = (path: string, filename: string) => {
    const url = ossUrl(path);
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGenerateAudio = async () => {
    const prompt = narrationText.trim();
    if (!prompt) {
      toast.warning(t("enterNarrationFirst"));
      return;
    }
    if (!audioColumnId) {
      toast.warning(t("noAudioColumn"));
      return;
    }

    // Only write back if the user actually edited the textarea. The seed
    // came through `stripDialogueRoleLines`, so blindly saving it would
    // clobber the structured dialogue (`角色：...`, `台词：Alice：...`) and
    // break voice auto-match on the next open. Fire-and-forget — a cell-
    // save failure shouldn't block voice synth.
    if (prompt !== initialNarrationRef.current.trim()) {
      void persistDialogueText(shotId, prompt);
      initialNarrationRef.current = prompt;
    }

    const queueId = `audio_${Date.now()}`;
    setAudioQueue((current) => [
      { id: queueId, path: "", status: "generating", name: prompt.slice(0, 24) },
      ...current,
    ]);

    try {
      const result = await backendApi.post<Record<string, unknown>>("/api/ai/voice/synthesize", {
        data: {
          shotId,
          shotColumnId: audioColumnId,
          model: voiceModel || undefined,
          text: prompt,
          voice_id: voiceId || undefined,
        },
        timeout: 360_000,
      });
      const nextPath = parseMediaResultPath(result);
      if (!nextPath) throw new Error("No audio result returned");

      setReferenceAudio(nextPath);
      setAudioQueue((current) => current.filter((item) => item.id !== queueId));
      setAudioHistory((current) => [
        { id: nextPath, path: nextPath },
        ...current.filter((item) => item.path !== nextPath),
      ]);
      toast.success(tc("generateSuccess"));
    } catch (error) {
      console.error("[AiLipSyncGeneratorDialog] 生成音频失败:", error);
      setAudioQueue((current) =>
        current.map((item) => (item.id === queueId ? { ...item, status: "failed" } : item))
      );
      toast.error(tc("generateFailed"));
    }
  };

  const handleRetryAudio = async (item: AudioResultItem) => {
    setAudioQueue((current) =>
      current.map((q) => (q.id === item.id ? { ...q, status: "generating" } : q))
    );
    try {
      const result = await backendApi.post<Record<string, unknown>>("/api/ai/voice/synthesize", {
        data: {
          shotId,
          shotColumnId: audioColumnId,
          model: voiceModel || undefined,
          text: narrationText.trim(),
          voice_id: voiceId || undefined,
        },
        timeout: 360_000,
      });
      const nextPath = parseMediaResultPath(result);
      if (!nextPath) throw new Error("No audio result returned");
      setReferenceAudio(nextPath);
      setAudioQueue((current) => current.filter((q) => q.id !== item.id));
      setAudioHistory((current) => [
        { id: nextPath, path: nextPath },
        ...current.filter((r) => r.path !== nextPath),
      ]);
      toast.success(tc("generateSuccess"));
    } catch (error) {
      console.error("[AiLipSyncGeneratorDialog] 重试音频失败:", error);
      setAudioQueue((current) =>
        current.map((q) => (q.id === item.id ? { ...q, status: "failed" } : q))
      );
      toast.error(tc("generateFailed"));
    }
  };

  const handleGenerateVideo = () => {
    if (!referenceVideo.trim()) {
      toast.warning(t("selectReferenceVideo"));
      return;
    }
    if (!referenceAudio.trim()) {
      toast.warning(t("selectReferenceAudio"));
      return;
    }
    // Submit into the Redux-backed queue. The queue processor polls pending
    // tasks, runs them against the long-polled /api/ai/video/lip/sync
    // endpoint, and writes back status/output. The watcher effect below
    // reacts to completion to fire onCollect/onSetPreferred and update the
    // preview pane — same side effects the old inline code did, but now
    // they survive dialog close/reopen.
    submitLipSyncTask({
      shotId,
      shotColumnId,
      model: lipSyncModel || undefined,
      videoUrl: ossUrl(referenceVideo),
      audioUrl: ossUrl(referenceAudio),
      refImageUrl: referenceFace ? ossUrl(referenceFace) : undefined,
    });
  };

  const handleRetryVideo = (item: VideoResultItem) => {
    // Retry the Redux task in place — status flips back to pending and the
    // queue processor picks it up again with the same stored input.
    retryLipSyncTask(item.id);
  };

  // ─── Render ──────────────────────────────────────────

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="gap-0 overflow-hidden rounded-xl border border-white/10 bg-[#262626] p-0 text-white sm:max-w-[1100px]">
          <DialogHeader className="shrink-0 border-b border-white/10 px-6 py-4">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="text-xs text-[#8F8F92]">
              {t("aiLipSyncDesc")}
            </DialogDescription>
          </DialogHeader>

          <div
            className="flex p-4 gap-4"
            style={{ height: "70vh", maxHeight: 700, minHeight: 480 }}
          >
            {/* Left: Audio panel (600px, matching web) */}
            <div className="w-150 shrink-0">
              <LipsyncAudioPanel
                narrationText={narrationText}
                onNarrationTextChange={setNarrationText}
                voiceModel={voiceModel}
                onVoiceModelChange={(m) => void handleVoiceModelChange(m)}
                activeVoiceLang={activeVoiceLang}
                onActiveVoiceLangChange={setActiveVoiceLang}
                voiceId={voiceId}
                onVoiceIdChange={setVoiceId}
                voiceModels={voiceModels}
                voiceLangOptions={voiceLangOptions}
                currentVoices={currentVoices}
                voiceGroups={voiceGroups}
                allAudioItems={allAudioItems}
                referenceAudio={referenceAudio}
                voiceModelCost={voiceModelCost}
                loadingVoiceModels={loadingVoiceModels}
                loadingVoices={loadingVoices}
                loadingAudioHistory={loadingAudioHistory}
                playingAudioPath={playingAudioPath}
                playingVoiceId={playingVoiceId}
                onToggleAudioPreview={handleToggleAudioPreview}
                onToggleVoicePreview={handleToggleVoicePreview}
                onDownload={handleDownload}
                onSelectAudio={setReferenceAudio}
                onGenerateAudio={() => void handleGenerateAudio()}
                onRetryAudio={(item) => void handleRetryAudio(item)}
                // Queue-based: a submit is ~instant. Keep the button
                // clickable so the user can keep queueing more batches
                // without waiting for in-flight tasks to drain.
                isGenerating={false}
                audioColumnId={audioColumnId}
              />
            </div>

            {/* Right: Video panel */}
            <div className="flex min-w-0 flex-1 flex-col">
              <LipsyncVideoPanel
                allVideoItems={allVideoItems}
                loadingVideoHistory={loadingVideoHistory}
                currentPreviewPath={currentPreviewPath}
                onSelectPreview={setCurrentPreviewPath}
                currentPreviewItem={currentPreviewItem}
                previewIsPreferred={previewIsPreferred}
                onDownload={handleDownload}
                onSetPreferred={onSetPreferred}
                referenceVideo={referenceVideo}
                onReferenceVideoChange={setReferenceVideo}
                referenceFace={referenceFace}
                onReferenceFaceChange={setReferenceFace}
                referenceAudio={referenceAudio}
                lipSyncModel={lipSyncModel}
                onLipSyncModelChange={setLipSyncModel}
                lipSyncModels={lipSyncModels}
                loadingLipSyncModels={loadingLipSyncModels}
                lipSyncModelCost={lipSyncModelCost}
                onGenerateVideo={() => void handleGenerateVideo()}
                onRetryVideo={(item) => void handleRetryVideo(item)}
                onOpenPicker={setPickerTarget}
                // Same queue reasoning as above — Generate Lip Sync
                // stays clickable; submission is a cheap Redux dispatch
                // and the lip-sync queue caps concurrency itself.
                isGenerating={false}
                shotNumber={shotNumber}
                shotId={shotId}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AssetPickerDialog
        open={pickerTarget === "video"}
        onOpenChange={(nextOpen) => setPickerTarget(nextOpen ? "video" : null)}
        assetType="video"
        multiple={false}
        onSelect={(paths) => {
          if (paths[0]) setReferenceVideo(paths[0]);
          setPickerTarget(null);
        }}
      />

      <AssetPickerDialog
        open={pickerTarget === "face"}
        onOpenChange={(nextOpen) => setPickerTarget(nextOpen ? "face" : null)}
        assetType="img"
        multiple={false}
        onSelect={(paths) => {
          if (paths[0]) setReferenceFace(paths[0]);
          setPickerTarget(null);
        }}
      />
    </>
  );
}
