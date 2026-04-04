"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconDownload,
  IconLoader2,
  IconMicrophone,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconWand,
  IconX,
  IconArrowUp,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { AudioWaveformBars } from "@/components/storyboard/ai-generator/audio-waveform-bars";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RichMentionEditor } from "@/components/storyboard/editor/rich-mention-editor";
import { cn } from "@/lib/utils";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { RawAiModel, AssetRecord, VoiceOptionItem } from "@/src/types/workspace";
import { useRawAiModels } from "@/src/hooks/use-ai-models";
import { AI_MODEL_PATHS } from "@/src/lib/ai-model-paths";
import {
  getDialogueTextFromShotValues,
  resolveDialogueVoicePreset,
} from "@/src/lib/storyboard-dialogue";
import type { MentionItem } from "@/components/storyboard/editor/mention-node";
import { useAppSelector } from "@/src/store";
import { selectCurrentInstance, type Asset, type ShotRow } from "@/src/store/slices/projectSlice";
import { Field, FieldLabel } from "@/components/ui/field";

const OSS_BASE = process.env.NEXT_PUBLIC_OSS_BASE_URL ?? "";
const MAX_CONCURRENT = 4;
const REQUEST_INTERVAL = 1000;

type QueueStatus = "waiting" | "generating" | "failed";

interface AudioHistoryItem {
  id: string;
  path: string;
  name?: string;
}

interface AudioQueueItem {
  id: string;
  prompt: string;
  model?: string;
  voiceId?: string;
  status: QueueStatus;
  name?: string;
}

interface AiAudioGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shotId: string;
  shotColumnId: string;
  shotNumber?: number;
  row?: ShotRow;
  worldId?: string;
  currentAudioPath?: string;
  onSelectPath: (path: string) => Promise<void> | void;
  onGeneratingChange?: (isGenerating: boolean) => void;
  onGenerateSuccess?: () => void;
}

function ossUrl(path?: string | null) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

function parseMediaResultPath(result: unknown) {
  if (Array.isArray(result) && result.length > 0) {
    const stringItems = result.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    );
    return String(stringItems[1] ?? stringItems[0] ?? "").trim();
  }

  if (typeof result === "string") {
    return result.trim();
  }

  if (result && typeof result === "object") {
    const record = result as {
      path?: string;
      url?: string;
      filePath?: string;
      storagePath?: string;
    };
    return String(record.storagePath ?? record.filePath ?? record.path ?? record.url ?? "").trim();
  }

  return "";
}

function uniquePaths(paths: Array<string | undefined | null>) {
  return Array.from(new Set(paths.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function toAudioHistoryItem(record: AssetRecord): AudioHistoryItem | null {
  const path = String(
    record.storagePath ?? record.filePath ?? record.path ?? record.url ?? ""
  ).trim();
  if (!path) return null;
  return {
    id: String(record.id ?? path),
    path,
    name: String(record.name ?? ""),
  };
}

function isCurrentAudio(path: string, currentAudioPath: string) {
  if (!path || !currentAudioPath) return false;
  return (
    path === currentAudioPath || currentAudioPath.endsWith(path) || path.endsWith(currentAudioPath)
  );
}

function getRoleImagePath(role?: Asset) {
  const roleImgPath = Array.isArray(role?.roleImgPath)
    ? role.roleImgPath.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  if (roleImgPath[0]) return roleImgPath[0];

  if (role?.otherImgPath && typeof role.otherImgPath === "object") {
    const first = Object.values(role.otherImgPath)
      .map((item) => String(item ?? "").trim())
      .find(Boolean);
    if (first) return first;
  }

  if (typeof role?.otherImgPath === "string" && role.otherImgPath.trim()) {
    return role.otherImgPath.trim();
  }

  return "";
}

export function AiAudioGeneratorDialog({
  open,
  onOpenChange,
  shotId,
  shotColumnId,
  row,
  worldId,
  currentAudioPath = "",
  onSelectPath,
  onGeneratingChange,
  onGenerateSuccess,
}: AiAudioGeneratorDialogProps) {
  const characters = useAppSelector((state) => selectCurrentInstance(state).characters);
  const { models: cachedVoiceModels } = useRawAiModels(AI_MODEL_PATHS.voice);
  const voiceModels = cachedVoiceModels as RawAiModel[];
  const [voiceGroups, setVoiceGroups] = useState<Record<string, VoiceOptionItem[]>>({});
  const [activeVoiceLang, setActiveVoiceLang] = useState("");
  const [voiceModel, setVoiceModel] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [promptText, setPromptText] = useState("");
  const [generateCount, setGenerateCount] = useState(1);
  const [audioHistory, setAudioHistory] = useState<AudioHistoryItem[]>([]);
  const [audioQueue, setAudioQueue] = useState<AudioQueueItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [playingAudioPath, setPlayingAudioPath] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState("");
  const [selectingPath, setSelectingPath] = useState("");
  const [audioProgress, setAudioProgress] = useState(0);

  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const voicePreviewRef = useRef<HTMLAudioElement | null>(null);
  const initializedRef = useRef(false);
  const previousGeneratingRef = useRef(false);
  const queueStateRef = useRef<AudioQueueItem[]>([]);
  const activeRequestCountRef = useRef(0);
  const lastRequestTimeRef = useRef(0);
  const queueTimerRef = useRef<number | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const processQueueRef = useRef<() => void>(() => {});

  const allAudioItems = useMemo(() => audioHistory, [audioHistory]);
  const voiceLangOptions = useMemo(() => Object.keys(voiceGroups), [voiceGroups]);
  const currentVoices = useMemo(
    () => (activeVoiceLang ? (voiceGroups[activeVoiceLang] ?? []) : []),
    [activeVoiceLang, voiceGroups]
  );
  const selectedVoiceName = useMemo(() => {
    if (!voiceId) return "";
    for (const voices of Object.values(voiceGroups)) {
      const matched = voices.find((item) => String(item.voiceId ?? "") === voiceId);
      if (matched?.voiceName) return String(matched.voiceName);
    }
    return "";
  }, [voiceGroups, voiceId]);
  const isGenerating = useMemo(
    () => audioQueue.some((item) => item.status === "waiting" || item.status === "generating"),
    [audioQueue]
  );
  const voiceModelCost = Math.abs(
    Number(
      voiceModels.find((item) => String(item.serviceCode ?? "") === voiceModel)?.integralCost ?? 0
    )
  );
  const totalCost = voiceModelCost * generateCount;
  const mentionItems = useMemo<MentionItem[]>(
    () =>
      characters
        .filter((role) => role.id && role.name)
        .map((role) => ({
          id: String(role.id),
          label: String(role.name),
          mentionType: "character" as const,
          imgUrl: ossUrl(getRoleImagePath(role)),
          voiceId: typeof role.voiceId === "string" ? role.voiceId.trim() : "",
          model: typeof role.model === "string" ? role.model.trim() : "",
        })),
    [characters]
  );

  const clearQueueTimer = useCallback(() => {
    if (queueTimerRef.current) {
      window.clearTimeout(queueTimerRef.current);
      queueTimerRef.current = null;
    }
  }, []);

  const stopProgressLoop = useCallback(() => {
    if (progressRafRef.current) {
      window.cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
    }
  }, []);

  const stopAudioPreview = useCallback(() => {
    stopProgressLoop();
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current = null;
    }
    setPlayingAudioPath("");
    setAudioProgress(0);
  }, [stopProgressLoop]);

  const stopVoicePreview = useCallback(() => {
    if (voicePreviewRef.current) {
      voicePreviewRef.current.pause();
      voicePreviewRef.current = null;
    }
    setPlayingVoiceId("");
  }, []);

  const updateAudioProgress = useCallback(() => {
    const audio = audioPreviewRef.current;
    if (!audio || !playingAudioPath) {
      setAudioProgress(0);
      return;
    }
    const duration = audio.duration || 1;
    setAudioProgress(audio.currentTime / duration);
    progressRafRef.current = window.requestAnimationFrame(updateAudioProgress);
  }, [playingAudioPath]);

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

        if (preferredVoiceId) {
          const matchedGroup = Object.entries(groups).find(([, voices]) =>
            voices.some((item) => String(item.voiceId ?? "") === String(preferredVoiceId ?? ""))
          );
          const matched = matchedGroup?.[1]?.find(
            (item) => String(item.voiceId ?? "") === String(preferredVoiceId ?? "")
          );
          setActiveVoiceLang(matchedGroup?.[0] ?? Object.keys(groups)[0] ?? "");
          setVoiceId(matched?.voiceId ? String(matched.voiceId) : "");
          return;
        }

        setActiveVoiceLang(Object.keys(groups)[0] ?? "");
        setVoiceId("");
      } catch (error) {
        console.error("[AiAudioGeneratorDialog] 加载音色失败:", error);
        toast.error("加载音色失败");
      } finally {
        setLoadingVoices(false);
      }
    },
    [stopVoicePreview]
  );

  const loadAudioHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await backendApi.post<Paginated<AssetRecord>>("/api/ai/record/shot/list", {
        data: { page: 1, pageSize: 50, shotId, shotcolumnId: shotColumnId, type: "audio", sort: 1 },
      });
      const recordItems = (data?.list ?? [])
        .map(toAudioHistoryItem)
        .filter((item): item is AudioHistoryItem => Boolean(item));
      const mergedPaths = uniquePaths([currentAudioPath, ...recordItems.map((item) => item.path)]);
      setAudioHistory(
        mergedPaths.map(
          (path) =>
            recordItems.find((item) => item.path === path) ?? {
              id: path,
              path,
            }
        )
      );
    } catch (error) {
      console.error("[AiAudioGeneratorDialog] 加载音频历史失败:", error);
      const fallbackPaths = uniquePaths([currentAudioPath]);
      setAudioHistory(
        fallbackPaths.map((path) => ({
          id: path,
          path,
        }))
      );
    } finally {
      setLoadingHistory(false);
    }
  }, [currentAudioPath, shotColumnId, shotId]);

  useEffect(() => {
    queueStateRef.current = audioQueue;
  }, [audioQueue]);

  useEffect(() => {
    onGeneratingChange?.(isGenerating);
    if (previousGeneratingRef.current && !isGenerating) {
      onGenerateSuccess?.();
    }
    previousGeneratingRef.current = isGenerating;
  }, [isGenerating, onGenerateSuccess, onGeneratingChange]);

  const startGeneration = useCallback(
    async (item: AudioQueueItem) => {
      setAudioQueue((current) =>
        current.map((queueItem) =>
          queueItem.id === item.id ? { ...queueItem, status: "generating" } : queueItem
        )
      );

      activeRequestCountRef.current += 1;
      lastRequestTimeRef.current = Date.now();

      try {
        const result = await backendApi.post<Record<string, unknown>>("/api/ai/voice/synthesize", {
          data: {
            shotId,
            shotColumnId,
            model: item.model || undefined,
            text: item.prompt,
            voice_id: item.voiceId || undefined,
          },
          timeout: 360_000,
        });
        const nextPath = parseMediaResultPath(result);
        if (!nextPath) {
          throw new Error("未获取到音频结果");
        }

        setAudioQueue((current) => current.filter((queueItem) => queueItem.id !== item.id));
        setAudioHistory((current) => [
          { id: nextPath, path: nextPath },
          ...current.filter((record) => record.path !== nextPath),
        ]);
      } catch (error) {
        console.error("[AiAudioGeneratorDialog] 生成音频失败:", error);
        setAudioQueue((current) =>
          current.map((queueItem) =>
            queueItem.id === item.id ? { ...queueItem, status: "failed" } : queueItem
          )
        );
        toast.error("音频生成失败");
      } finally {
        activeRequestCountRef.current = Math.max(0, activeRequestCountRef.current - 1);
        processQueueRef.current();
      }
    },
    [shotColumnId, shotId]
  );

  const processQueue = useCallback(() => {
    clearQueueTimer();
    const waitingItems = queueStateRef.current.filter((item) => item.status === "waiting");
    if (!waitingItems.length) return;
    if (activeRequestCountRef.current >= MAX_CONCURRENT) return;

    const now = Date.now();
    const elapsed = now - lastRequestTimeRef.current;
    if (lastRequestTimeRef.current > 0 && elapsed < REQUEST_INTERVAL) {
      queueTimerRef.current = window.setTimeout(
        processQueueRef.current,
        REQUEST_INTERVAL - elapsed
      );
      return;
    }

    const nextItem = waitingItems[0];
    void startGeneration(nextItem);

    if (waitingItems.length > 1 && activeRequestCountRef.current < MAX_CONCURRENT) {
      queueTimerRef.current = window.setTimeout(processQueueRef.current, REQUEST_INTERVAL);
    }
  }, [clearQueueTimer, startGeneration]);

  useEffect(() => {
    processQueueRef.current = processQueue;
  }, [processQueue]);

  useEffect(() => {
    if (!audioQueue.length) return;
    processQueueRef.current();
  }, [audioQueue]);

  useEffect(() => {
    if (!open) {
      stopAudioPreview();
      stopVoicePreview();
      return;
    }

    let active = true;
    const shotValues = row?.shotValues ?? [];

    const initialize = async () => {
      if (!initializedRef.current && voiceModels.length > 0) {
        const nextPrompt = getDialogueTextFromShotValues(shotValues);
        setPromptText(nextPrompt);
        setGenerateCount(1);
        setSelectingPath("");

        setLoadingModels(true);
        try {
          const voicePreset =
            row && worldId
              ? await resolveDialogueVoicePreset({
                  shotValues,
                  worldId,
                })
              : { voiceId: "", model: "", speakerName: "", referenceFacePath: "" };

          if (!active) return;

          const presetModel = String(voicePreset?.model ?? "");
          const defaultVoiceModelCode =
            presetModel &&
            voiceModels.some((item) => String(item.serviceCode ?? "") === presetModel)
              ? presetModel
              : "";

          setVoiceModel(defaultVoiceModelCode);
          setVoiceId(String(voicePreset?.voiceId ?? ""));

          if (defaultVoiceModelCode) {
            void loadVoices(defaultVoiceModelCode, String(voicePreset?.voiceId ?? ""));
          } else {
            setVoiceGroups({});
            setActiveVoiceLang("");
            setVoiceId("");
          }

          initializedRef.current = true;
        } catch (error) {
          console.error("[AiAudioGeneratorDialog] 初始化失败:", error);
          toast.error("初始化配音工具失败");
        } finally {
          if (active) {
            setLoadingModels(false);
          }
        }
      }

      await loadAudioHistory();
    };

    void initialize();

    return () => {
      active = false;
    };
  }, [
    loadAudioHistory,
    loadVoices,
    open,
    row,
    stopAudioPreview,
    stopVoicePreview,
    voiceModels,
    worldId,
  ]);

  useEffect(() => {
    return () => {
      clearQueueTimer();
      stopAudioPreview();
      stopVoicePreview();
    };
  }, [clearQueueTimer, stopAudioPreview, stopVoicePreview]);

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
    audio.onended = () => {
      stopAudioPreview();
    };
    audio.onerror = () => {
      stopAudioPreview();
    };
    audio
      .play()
      .then(() => {
        setPlayingAudioPath(path);
        progressRafRef.current = window.requestAnimationFrame(updateAudioProgress);
      })
      .catch(() => {
        stopAudioPreview();
      });
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

  const handleDownload = (path: string) => {
    const url = ossUrl(path);
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGenerate = () => {
    const prompt = promptText.trim();
    if (!prompt) {
      toast.warning("请先输入旁白或对白");
      return;
    }

    const newItems = Array.from({ length: generateCount }, (_, index) => ({
      id: `voice_${Date.now()}_${index}`,
      prompt,
      model: voiceModel || undefined,
      voiceId: voiceId || undefined,
      status: "waiting" as const,
      name: prompt.slice(0, 24),
    }));
    setAudioQueue((current) => [...current, ...newItems]);
  };

  const handleRetry = (item: AudioQueueItem) => {
    setAudioQueue((current) =>
      current.map((queueItem) =>
        queueItem.id === item.id ? { ...queueItem, status: "waiting" } : queueItem
      )
    );
  };

  const handleSelect = async (path: string) => {
    if (!path) return;
    setSelectingPath(path);
    try {
      await onSelectPath(path);
      toast.success("已更新当前镜头配音");
    } catch (error) {
      console.error("[AiAudioGeneratorDialog] 选择音频失败:", error);
      toast.error("更新配音失败");
    } finally {
      setSelectingPath("");
    }
  };

  const title = "AI 配音";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="gap-0 rounded-2xl border border-white/10 bg-[#2F2F35] p-0 text-white sm:max-w-[800px]"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader className="px-6 pb-3 pt-5">
            <DialogTitle className="text-[22px] font-medium text-white">{title}</DialogTitle>
          </DialogHeader>

          <div className="px-4 pb-4">
            <div className="flex h-[360px] flex-col px-1">
              {audioQueue.length || allAudioItems.length ? (
                <div className="grid flex-1 auto-rows-min grid-cols-3 gap-3 overflow-y-auto rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-3">
                  {audioQueue.map((item) => (
                    <AudioGridCard
                      key={item.id}
                      loading={item.status !== "failed"}
                      failed={item.status === "failed"}
                      failedText="Generate failed"
                      onRetry={() => handleRetry(item)}
                    />
                  ))}

                  {allAudioItems.map((audio, index) => {
                    const path = audio.path;
                    const playing = Boolean(path && playingAudioPath === path);
                    const current = isCurrentAudio(path, currentAudioPath);
                    const selecting = Boolean(path && selectingPath === path);

                    return (
                      <AudioGridCard
                        key={audio.id || `${path}_${index}`}
                        audioKey={path}
                        progress={playing ? audioProgress : 0}
                        playing={playing}
                        current={current}
                        showSelect
                        showDownload
                        selectText={current ? "当前使用" : "选择"}
                        onClick={() => handleToggleAudioPreview(path)}
                        onTogglePlay={() => handleToggleAudioPreview(path)}
                        onSelect={() => void handleSelect(path)}
                        onDownload={() => handleDownload(path)}
                        selecting={selecting}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.02]">
                  {loadingHistory ? (
                    <IconLoader2 className="size-5 animate-spin text-white/50" />
                  ) : (
                    <h3 className="text-[18px] font-semibold text-[#E52227]">AI 生成</h3>
                  )}
                </div>
              )}
            </div>

            <div className="mt-3 rounded-lg border border-white/20 bg-[#31313A] p-2">
              <RichMentionEditor
                value={promptText}
                onChange={setPromptText}
                placeholder="请输入需要配音的台词文本，支持 @角色"
                mentionItems={mentionItems}
                mentionTypes={["character"]}
                showAvatar={false}
                extraFields={["voiceId", "model"]}
                minHeight={160}
                className="px-2 pt-2 [&_[contenteditable]]:text-[15px] [&_[contenteditable]]:leading-7 [&_[contenteditable]]:text-white"
                onSubmitShortcut={handleGenerate}
                submitMode="mod"
              />

              <div className="px-2 pb-2 text-[11px] text-[#8F8F92]">
                未指定时，自动匹配提示词中角色的配音设置
              </div>

              <div className="flex items-end justify-between gap-4 pt-2">
                <div className="flex items-center gap-3">
                  <ToolbarSelect
                    value={voiceModel}
                    options={voiceModels.map((item) => ({
                      label: String(item.serviceName ?? item.serviceCode ?? "Unknown"),
                      value: String(item.serviceCode ?? ""),
                    }))}
                    placeholder={loadingModels ? "加载模型中" : "选择模型"}
                    icon={<IconWand className="size-4" />}
                    onChange={(value) => void handleVoiceModelChange(value)}
                  />

                  <VoiceChip
                    label={selectedVoiceName || "选择语音"}
                    selected={Boolean(voiceId)}
                    onClick={() => setShowVoiceModal(true)}
                    onClear={voiceId ? () => setVoiceId("") : undefined}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <ToolbarSelect
                    value={String(generateCount)}
                    options={[
                      { label: "1x", value: "1" },
                      { label: "2x", value: "2" },
                      { label: "4x", value: "4" },
                    ]}
                    compact
                    onChange={(value) => setGenerateCount(Number(value))}
                  />

                  <div className="relative flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.03)_100%)] p-[6px_4px] backdrop-blur-[12px]">
                    <span className="pointer-events-none absolute inset-0 rounded-full border border-white/10" />
                    {totalCost > 0 ? (
                      <span className="relative flex h-[26px] min-w-[48px] items-center justify-center rounded-full bg-white/[0.04] px-3 text-sm font-medium text-white/80">
                        {totalCost}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className={cn(
                        "relative flex size-9 items-center justify-center rounded-full transition-all",
                        isGenerating
                          ? "bg-white/[0.05] text-white/30"
                          : "bg-[linear-gradient(135deg,rgba(229,34,39,0.7)_0%,rgba(229,34,39,0.5)_100%)] text-white shadow-[0_2px_8px_rgba(229,34,39,0.3)] hover:scale-105 hover:shadow-[0_4px_12px_rgba(229,34,39,0.4)]"
                      )}
                    >
                      {isGenerating ? (
                        <IconLoader2 className="size-[18px] animate-spin" />
                      ) : (
                        <IconArrowUp className="size-[18px]" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showVoiceModal}
        onOpenChange={(nextOpen) => {
          setShowVoiceModal(nextOpen);
          if (!nextOpen) {
            stopVoicePreview();
          }
        }}
        modal={false}
      >
        <DialogContent
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="gap-0 rounded-2xl border border-white/10 bg-[#2F2F35] p-0 text-white sm:max-w-[560px]"
        >
          <DialogHeader className="border-b border-white/10 px-5 py-4">
            <DialogTitle className="text-lg font-medium">选择语音</DialogTitle>
          </DialogHeader>

          <div className="px-4 pb-4 pt-3">
            <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
              {voiceLangOptions.map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setActiveVoiceLang(lang)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs transition-colors",
                    lang === activeVoiceLang
                      ? "bg-white text-black"
                      : "bg-white/[0.05] text-white/70 hover:bg-white/[0.08] hover:text-white"
                  )}
                >
                  {lang} ({voiceGroups[lang]?.length ?? 0})
                </button>
              ))}
            </div>

            <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {loadingVoices ? (
                <div className="flex items-center gap-2 px-2 py-10 text-sm text-[#8F8F92]">
                  <IconLoader2 className="size-4 animate-spin" />
                  加载语音中...
                </div>
              ) : !voiceModel ? (
                <div className="px-2 py-10 text-sm text-[#8F8F92]">请先选择模型</div>
              ) : !currentVoices.length ? (
                <div className="px-2 py-10 text-sm text-[#8F8F92]">当前分组下暂无语音</div>
              ) : (
                currentVoices.map((voice, index) => {
                  const currentVoiceId = String(voice.voiceId ?? "");
                  const active = currentVoiceId === voiceId;
                  const playing = currentVoiceId === playingVoiceId;
                  return (
                    <button
                      key={currentVoiceId || `${voice.voiceName ?? "voice"}_${index}`}
                      type="button"
                      onClick={() => {
                        setVoiceId(currentVoiceId);
                        setShowVoiceModal(false);
                        stopVoicePreview();
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors",
                        active
                          ? "border-[#E52227]/60 bg-[#E52227]/10"
                          : "border-white/10 bg-white/[0.03] hover:border-white/20"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">
                          {voice.voiceName || "未命名语音"}
                        </div>
                        {voice.voiceDescription ? (
                          <div className="mt-1 line-clamp-1 text-xs text-[#8F8F92]">
                            {voice.voiceDescription}
                          </div>
                        ) : null}
                      </div>
                      <span
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleVoicePreview(voice);
                        }}
                        className="ml-3 flex size-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white hover:border-white/20"
                      >
                        {playing ? (
                          <IconPlayerStop className="size-4" />
                        ) : (
                          <IconPlayerPlay className="size-4" />
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ToolbarSelect({
  value,
  options,
  onChange,
  placeholder,
  icon,
  compact = false,
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <Field
      orientation="horizontal"
      className={cn(
        "relative w-auto items-center gap-[6px] rounded-[8px] bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.03)_100%)] px-[14px] py-[7px] text-[13px] text-white/85 backdrop-blur-[12px] transition-[transform,box-shadow,color] duration-200 hover:text-white hover:shadow-[0_2px_12px_rgba(229,34,39,0.15)]",
        compact ? "min-w-[86px]" : "min-w-[156px]"
      )}
    >
      <span className="pointer-events-none absolute inset-0 rounded-[8px] border border-[#E52227]/35 opacity-70" />
      {icon ? <FieldLabel className="text-white/75">{icon}</FieldLabel> : null}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full w-full appearance-none bg-transparent pr-6 text-base outline-none"
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <IconChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-white/55" />
    </Field>
  );
}

function VoiceChip({
  label,
  selected,
  onClick,
  onClear,
}: {
  label: string;
  selected?: boolean;
  onClick: () => void;
  onClear?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex min-w-[156px] max-w-[200px] items-center gap-[6px] rounded-[8px] bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.03)_100%)] px-[14px] py-[7px] text-[13px] text-white/85 backdrop-blur-[12px] transition-[transform,box-shadow,color] duration-200 hover:text-white hover:shadow-[0_2px_12px_rgba(229,34,39,0.15)]"
    >
      <span className="pointer-events-none absolute inset-0 rounded-[8px] border border-[#E52227]/35 opacity-70" />
      <IconMicrophone className="size-4 text-white/75" />
      <span className="flex-1 truncate text-left">{label}</span>
      {selected && onClear ? (
        <span
          onClick={(event) => {
            event.stopPropagation();
            onClear();
          }}
          className="flex size-5 items-center justify-center rounded-full text-white/55 hover:bg-white/10 hover:text-white"
        >
          <IconX className="size-3.5" />
        </span>
      ) : (
        <IconChevronDown className="size-4 text-white/55" />
      )}
    </button>
  );
}

function AudioGridCard({
  audioKey = "",
  progress = 0,
  playing = false,
  current = false,
  loading = false,
  failed = false,
  selecting = false,
  showSelect = false,
  showDownload = false,
  selectText = "选择",
  failedText = "生成失败",
  onClick,
  onTogglePlay,
  onSelect,
  onDownload,
  onRetry,
}: {
  audioKey?: string;
  progress?: number;
  playing?: boolean;
  current?: boolean;
  loading?: boolean;
  failed?: boolean;
  selecting?: boolean;
  showSelect?: boolean;
  showDownload?: boolean;
  selectText?: string;
  failedText?: string;
  onClick?: () => void;
  onTogglePlay?: () => void;
  onSelect?: () => void;
  onDownload?: () => void;
  onRetry?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative flex min-h-[72px] cursor-pointer items-stretch overflow-hidden rounded-lg border bg-white/[0.06] transition-colors",
        current ? "border-[#E52227]/60" : "border-transparent",
        !loading && !failed && "hover:border-[#E52227]/50",
        loading && "cursor-default border-[#E52227]/20",
        failed && "cursor-pointer"
      )}
    >
      {failed ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRetry?.();
          }}
          className="flex w-full items-center justify-center gap-2 px-3 py-4 text-xs text-white/55 transition-colors hover:text-white/85"
        >
          <IconRefresh className="size-4 text-[#E52227]" />
          <span>{failedText}</span>
        </button>
      ) : (
        <div className="flex w-full items-center gap-3 px-3 py-3">
          <div className="min-w-0 flex-1 overflow-hidden">
            <AudioWaveformBars audioKey={audioKey} progress={progress} loading={loading} />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {showSelect ? (
              <button
                type="button"
                disabled={selecting}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect?.();
                }}
                className={cn(
                  "max-w-0 overflow-hidden whitespace-nowrap rounded px-0 py-1 text-xs text-white/70 transition-all duration-300",
                  "group-hover:max-w-[72px] group-hover:px-2.5",
                  selecting && "pointer-events-none opacity-60"
                )}
              >
                {selecting ? (
                  <span className="inline-flex items-center gap-1">
                    <IconLoader2 className="size-3 animate-spin" />
                    ...
                  </span>
                ) : current ? (
                  <span className="inline-flex items-center gap-1">
                    <IconCheck className="size-3" />
                    当前
                  </span>
                ) : (
                  selectText
                )}
              </button>
            ) : null}

            {showDownload ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDownload?.();
                }}
                className="h-7 w-0 overflow-hidden rounded-full bg-white/[0.12] text-white transition-all duration-300 group-hover:w-7"
              >
                <span className="flex h-7 w-7 items-center justify-center">
                  <IconDownload className="size-4" />
                </span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onTogglePlay?.();
              }}
              className="flex size-7 items-center justify-center rounded-full bg-white/[0.12] text-white transition-colors hover:bg-white/[0.2]"
            >
              {playing ? (
                <IconPlayerPause className="size-4" />
              ) : (
                <IconPlayerPlay className="size-4" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
