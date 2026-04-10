import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconCheck,
  IconClock,
  IconDownload,
  IconLoader2,
  IconMusic,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { RawAiModel, AssetRecord } from "@/src/types/workspace";
import { useRawAiModels } from "@/src/hooks/use-ai-models";
import { AI_MODEL_PATHS } from "@/src/lib/ai-model-paths";
import { env } from "@/src/env";

const OSS_BASE = env.OSS_BASE_URL;
const MAX_CONCURRENT = 4;
const REQUEST_INTERVAL = 1000;
const MAX_QUEUE_SIZE = 8;

type QueueStatus = "waiting" | "generating";

interface AudioResultItem {
  id: string;
  path: string;
  previewUrl: string;
  name?: string;
}

interface AudioQueueItem {
  id: string;
  prompt: string;
  model: string;
  status: QueueStatus;
}

interface AiBasicAudioGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shotId: string;
  shotColumnId: string;
  defaultPrompt?: string;
  currentAudioPath?: string;
  onSelectPaths: (paths: string[]) => Promise<void> | void;
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

function getAudioName(item: AudioResultItem) {
  return item.name?.trim() || item.path.split("/").pop() || "audio";
}

function parseGeneratedAudio(result: unknown): AudioResultItem | null {
  if (Array.isArray(result) && result.length >= 2) {
    const previewUrl = String(result[0] ?? "").trim();
    const storagePath = String(result[1] ?? "").trim();
    if (!storagePath) return null;
    return {
      id: storagePath,
      path: storagePath,
      previewUrl: previewUrl || ossUrl(storagePath),
    };
  }

  if (typeof result === "string" && result.trim()) {
    const path = result.trim();
    return {
      id: path,
      path,
      previewUrl: ossUrl(path),
    };
  }

  if (result && typeof result === "object") {
    const value = result as {
      path?: string;
      storagePath?: string;
      url?: string;
      previewUrl?: string;
    };
    const path = String(value.storagePath ?? value.path ?? value.url ?? "").trim();
    if (!path) return null;
    return {
      id: path,
      path,
      previewUrl: String(value.previewUrl ?? value.url ?? "").trim() || ossUrl(path),
    };
  }

  return null;
}

function toHistoryAudio(record: AssetRecord): AudioResultItem | null {
  const path = String(
    record.storagePath ?? record.filePath ?? record.path ?? record.url ?? ""
  ).trim();
  if (!path) return null;
  return {
    id: String(record.id ?? path),
    path,
    previewUrl: ossUrl(path),
    name: String(record.name ?? ""),
  };
}

export function AiBasicAudioGeneratorDialog({
  open,
  onOpenChange,
  shotId,
  shotColumnId,
  defaultPrompt = "",
  currentAudioPath = "",
  onSelectPaths,
  onGeneratingChange,
  onGenerateSuccess,
}: AiBasicAudioGeneratorDialogProps) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const { models: cachedModels, loading: loadingModelsFromCache } = useRawAiModels(
    AI_MODEL_PATHS.audio
  );
  const models = cachedModels as RawAiModel[];
  const [modelCode, setModelCode] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generateCount, setGenerateCount] = useState("1");
  const [generatedAudios, setGeneratedAudios] = useState<AudioResultItem[]>([]);
  const [historyAudios, setHistoryAudios] = useState<AudioResultItem[]>([]);
  const [queue, setQueue] = useState<AudioQueueItem[]>([]);
  const loadingModels = loadingModelsFromCache;
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [currentPreviewAudio, setCurrentPreviewAudio] = useState<AudioResultItem | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [selecting, setSelecting] = useState(false);
  const activeRequestCountRef = useRef(0);
  const lastRequestTimeRef = useRef(0);
  const queueTimerRef = useRef<number | null>(null);
  const generatedWhileOpenRef = useRef(false);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const currentAudioElementRef = useRef<HTMLAudioElement | null>(null);

  const allAudios = useMemo(
    () => [...generatedAudios, ...historyAudios],
    [generatedAudios, historyAudios]
  );
  const isGenerating = queue.length > 0;
  const currentModelCost = Math.abs(
    Number(models.find((item) => String(item.serviceCode ?? "") === modelCode)?.integralCost ?? 0)
  );
  const totalCost = currentModelCost * Number(generateCount);

  const modelOptions = useMemo<Array<{ label: string; value: string }>>(
    () =>
      models.map((item) => ({
        label: String(item.serviceName ?? item.serviceCode ?? t("modelLabel")),
        value: String(item.serviceCode ?? ""),
      })),
    [models]
  );

  const countOptions = useMemo<Array<{ label: string; value: string }>>(
    () => [1, 2, 4].map((value) => ({ label: String(value), value: String(value) })),
    []
  );

  // Set default model code when cache loads
  useEffect(() => {
    if (models.length === 0 || modelCode) return;
    const defaultModel = models.find((item) => item.isDefault) ?? models[0] ?? null;
    setModelCode(defaultModel?.serviceCode ? String(defaultModel.serviceCode) : "");
  }, [models, modelCode]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await backendApi.post<Paginated<AssetRecord>>("/api/ai/record/shot/list", {
        data: { page: 1, pageSize: 50, shotId, shotcolumnId: shotColumnId, type: "audio", sort: 1 },
      });
      const nextHistory = (data?.list ?? [])
        .map(toHistoryAudio)
        .filter((item): item is AudioResultItem => Boolean(item));

      if (
        currentAudioPath.trim() &&
        !nextHistory.some((item) => item.path === currentAudioPath.trim())
      ) {
        nextHistory.unshift({
          id: currentAudioPath.trim(),
          path: currentAudioPath.trim(),
          previewUrl: ossUrl(currentAudioPath.trim()),
        });
      }

      setHistoryAudios(nextHistory);
    } catch (error) {
      console.error("[AiBasicAudioGeneratorDialog] 加载历史失败:", error);
      if (currentAudioPath.trim()) {
        const fallback = {
          id: currentAudioPath.trim(),
          path: currentAudioPath.trim(),
          previewUrl: ossUrl(currentAudioPath.trim()),
        };
        setHistoryAudios([fallback]);
      } else {
        setHistoryAudios([]);
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [currentAudioPath, shotColumnId, shotId]);

  const cleanupPreviewAudio = useCallback(() => {
    if (currentAudioElementRef.current) {
      currentAudioElementRef.current.pause();
      currentAudioElementRef.current.src = "";
      currentAudioElementRef.current.remove();
      currentAudioElementRef.current = null;
    }
    if (audioContainerRef.current) {
      audioContainerRef.current.innerHTML = "";
    }
  }, []);

  const playPreviewAudio = useCallback(() => {
    const preview = currentPreviewAudio;
    const container = audioContainerRef.current;
    if (!preview || !container) return;

    cleanupPreviewAudio();
    const audio = document.createElement("audio");
    audio.src = preview.previewUrl;
    audio.controls = true;
    audio.style.cssText = "width: 100%;";
    container.appendChild(audio);
    currentAudioElementRef.current = audio;
    audio.load();
    void audio.play().catch(() => {});
  }, [cleanupPreviewAudio, currentPreviewAudio]);

  const scheduleQueue = useCallback(
    (delay = 0) => {
      if (queueTimerRef.current) {
        window.clearTimeout(queueTimerRef.current);
      }
      queueTimerRef.current = window.setTimeout(() => {
        const waitingItem = queue.find((item) => item.status === "waiting");
        if (!waitingItem || activeRequestCountRef.current >= MAX_CONCURRENT) {
          return;
        }

        const now = Date.now();
        const elapsed = now - lastRequestTimeRef.current;
        if (lastRequestTimeRef.current > 0 && elapsed < REQUEST_INTERVAL) {
          scheduleQueue(REQUEST_INTERVAL - elapsed);
          return;
        }

        activeRequestCountRef.current += 1;
        lastRequestTimeRef.current = now;
        setQueue((current) =>
          current.map((item) =>
            item.id === waitingItem.id ? { ...item, status: "generating" } : item
          )
        );

        void backendApi
          .post<Record<string, unknown>>("/api/ai/audio/generate/basic", {
            data: {
              shotId,
              shotColumnId,
              prompt: waitingItem.prompt,
              model: waitingItem.model || undefined,
            },
            timeout: 360_000,
          })
          .then((result) => {
            const audio = parseGeneratedAudio(result);
            if (!audio) {
              throw new Error(t("noValidAudio"));
            }
            generatedWhileOpenRef.current = true;
            setGeneratedAudios((current) => [audio, ...current]);
            setCurrentPreviewAudio(audio);
            toast.success(tc("generateSuccess"));
          })
          .catch((error) => {
            console.error("[AiBasicAudioGeneratorDialog] 生成音频失败:", error);
            toast.error(tc("generateFailed"));
          })
          .finally(() => {
            activeRequestCountRef.current = Math.max(0, activeRequestCountRef.current - 1);
            setQueue((current) => current.filter((item) => item.id !== waitingItem.id));
            scheduleQueue(REQUEST_INTERVAL);
          });

        if (queue.filter((item) => item.status === "waiting").length > 1) {
          scheduleQueue(REQUEST_INTERVAL);
        }
      }, delay);
    },
    [queue, shotColumnId, shotId]
  );

  useEffect(() => {
    onGeneratingChange?.(isGenerating);
  }, [isGenerating, onGeneratingChange]);

  useEffect(() => {
    if (!open) {
      if (queueTimerRef.current) {
        window.clearTimeout(queueTimerRef.current);
        queueTimerRef.current = null;
      }
      activeRequestCountRef.current = 0;
      lastRequestTimeRef.current = 0;
      cleanupPreviewAudio();
      if (generatedWhileOpenRef.current) {
        onGenerateSuccess?.();
        generatedWhileOpenRef.current = false;
      }
      return;
    }

    setPrompt(defaultPrompt);
    setGenerateCount("1");
    setGeneratedAudios([]);
    setSelectedIndices([]);
    setQueue([]);
    setCurrentPreviewAudio(null);
    cleanupPreviewAudio();
    void loadHistory();
  }, [cleanupPreviewAudio, defaultPrompt, loadHistory, onGenerateSuccess, open]);

  useEffect(() => {
    if (!open || queue.length === 0) return;
    scheduleQueue();
  }, [open, queue, scheduleQueue]);

  useEffect(
    () => () => {
      cleanupPreviewAudio();
      if (queueTimerRef.current) {
        window.clearTimeout(queueTimerRef.current);
      }
    },
    [cleanupPreviewAudio]
  );

  useEffect(() => {
    if (!currentPreviewAudio) {
      cleanupPreviewAudio();
      return;
    }
    const timer = window.setTimeout(() => {
      playPreviewAudio();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [cleanupPreviewAudio, currentPreviewAudio, playPreviewAudio]);

  const handleDownload = useCallback(async () => {
    if (!currentPreviewAudio) return;
    try {
      const response = await fetch(currentPreviewAudio.previewUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = getAudioName(currentPreviewAudio);
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("[AiBasicAudioGeneratorDialog] 下载失败:", error);
      toast.error(t("downloadFailed2"));
    }
  }, [currentPreviewAudio]);

  const handleGenerate = useCallback(() => {
    if (!prompt.trim()) {
      toast.warning(t("enterPrompt"));
      return;
    }
    if (!modelCode) {
      toast.warning(t("selectModelFirst"));
      return;
    }
    if (queue.length >= MAX_QUEUE_SIZE) {
      toast.warning(t("queueFull"));
      return;
    }

    const count = Number(generateCount);
    const now = Date.now();
    setSelectedIndices([]);
    setQueue((current) => [
      ...current,
      ...Array.from({ length: count }, (_, index) => ({
        id: `${now}-${index}`,
        prompt: prompt.trim(),
        model: modelCode,
        status: "waiting" as QueueStatus,
      })),
    ]);
  }, [generateCount, modelCode, prompt, queue.length]);

  const handleToggleSelect = useCallback((index: number) => {
    setSelectedIndices((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index]
    );
  }, []);

  const handleSelect = useCallback(async () => {
    const selectedPaths =
      selectedIndices.length > 0
        ? selectedIndices
            .map((index) => allAudios[index])
            .filter(Boolean)
            .map((item) => item.path)
        : currentPreviewAudio
          ? [currentPreviewAudio.path]
          : [];

    if (selectedPaths.length === 0) return;

    setSelecting(true);
    try {
      await onSelectPaths(selectedPaths);
      onOpenChange(false);
    } catch (error) {
      console.error("[AiBasicAudioGeneratorDialog] 选择音频失败:", error);
      toast.error(t("selectAudioFailed"));
    } finally {
      setSelecting(false);
    }
  }, [allAudios, currentPreviewAudio, onOpenChange, onSelectPaths, selectedIndices]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[1200px] max-w-[calc(100vw-2rem)] rounded-2xl p-0 sm:max-w-[1200px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="px-6 py-4">
          <DialogTitle className="text-base font-medium">{t("aiAudioTitle")}</DialogTitle>
        </DialogHeader>

        <div className="flex h-150 min-h-0 gap-5 px-4 pb-5">
          <div className="flex w-75 shrink-0 flex-col gap-4 overflow-y-auto">
            <section className="space-y-2">
              <div className="text-sm font-medium text-foreground">{t("audioPromptLabel")}</div>
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t("audioPromptPlaceholder")}
                rows={7}
              />
            </section>

            <section className="space-y-2">
              <div className="text-sm font-medium text-foreground">{t("modelLabel")}</div>
              <NativeSelect
                value={modelCode}
                onChange={(event) => setModelCode(event.target.value)}
                disabled={loadingModels}
              >
                <option value="" disabled>
                  {t("selectModel")}
                </option>
                {modelOptions.map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
              {currentModelCost > 0 ? (
                <div className="text-xs text-muted-foreground">
                  {t("costPerUnit", { cost: currentModelCost })}
                </div>
              ) : null}
            </section>

            <section className="space-y-2 pt-4">
              <NativeSelect
                value={generateCount}
                onChange={(event) => setGenerateCount(event.target.value)}
                className="w-[120px]"
              >
                {countOptions.map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </section>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {queue.length > 0 || allAudios.length > 0 ? (
              <div className="grid flex-1 auto-rows-min grid-cols-2 content-start gap-3 overflow-y-auto rounded-lg border border-dashed border-[#444] bg-white/[0.02] p-3">
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "relative flex min-h-[60px] items-center justify-center overflow-hidden rounded-lg border-2 border-transparent bg-[#1A1A1A] px-4 py-4 text-center",
                      item.status === "generating" ? "text-[#E52227]" : "text-[#999]"
                    )}
                  >
                    <div className="flex flex-col items-center justify-center gap-2">
                      {item.status === "generating" ? (
                        <IconLoader2 className="size-5 animate-spin" />
                      ) : (
                        <IconClock className="size-5" />
                      )}
                      <span className="text-xs">
                        {item.status === "generating" ? t("generatingStatus") : t("queueStatus")}
                      </span>
                    </div>
                  </div>
                ))}

                {allAudios.map((audio, index) => {
                  const selected = selectedIndices.includes(index);
                  const previewing = currentPreviewAudio === audio;
                  return (
                    <button
                      key={`${audio.id}_${index}`}
                      type="button"
                      onClick={() => setCurrentPreviewAudio(audio)}
                      className={cn(
                        "relative flex min-h-[60px] items-center gap-3 overflow-hidden rounded-lg border-2 bg-[#1A1A1A] p-3 text-left transition-colors",
                        previewing
                          ? "border-[#E52227]"
                          : "border-transparent hover:border-[#E52227]/50"
                      )}
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#E63946]/10 text-[#E63946]">
                        <IconMusic className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-[#E0E0E0]">{getAudioName(audio)}</div>
                      </div>
                      <div
                        className={cn(
                          "absolute right-2 top-2 flex size-5 items-center justify-center rounded border-2 text-[10px]",
                          selected
                            ? "border-[#E52227] bg-[#E52227] text-white"
                            : "border-white bg-black/30 text-transparent"
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleSelect(index);
                        }}
                      >
                        <IconCheck className="size-3" />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[#444] bg-white/[0.02]">
                {loadingHistory ? (
                  <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
                ) : (
                  <div className="text-center">
                    <div className="text-lg font-semibold text-foreground">{t("aiAudioEmpty")}</div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {t("aiAudioEmptyDesc")}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex w-[320px] shrink-0 flex-col">
            <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-[#444] bg-white/[0.02]">
              {currentPreviewAudio ? (
                <>
                  <div className="absolute right-3 top-3 flex items-center gap-2 rounded-lg bg-black/70 px-3 py-2 backdrop-blur-sm">
                    <button
                      type="button"
                      className="flex items-center justify-center rounded px-2 py-1 text-white transition-colors hover:bg-white/10"
                      onClick={() => void handleDownload()}
                    >
                      <IconDownload className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="flex items-center justify-center rounded px-2 py-1 text-white transition-colors hover:bg-white/10"
                      disabled
                    >
                      <IconTrash className="size-4" />
                    </button>
                  </div>
                  <div className="flex w-full flex-col items-center gap-4 p-6">
                    <div className="flex size-20 items-center justify-center rounded-full bg-[#E63946]/10 text-[#E63946]">
                      <IconMusic className="size-12" />
                    </div>
                    <div className="max-w-full break-all text-center text-sm text-[#E0E0E0]">
                      {getAudioName(currentPreviewAudio)}
                    </div>
                    <div ref={audioContainerRef} className="w-full px-3" />
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">{t("selectAudioPreview")}</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="soft"
              color="muted"
              onClick={handleGenerate}
              disabled={queue.length >= MAX_QUEUE_SIZE}
            >
              {tc("generate")}
            </Button>
            <div className="text-xs text-muted-foreground">
              {totalCost > 0 ? t("estimatedCost", { cost: totalCost }) : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button
              onClick={() => void handleSelect()}
              disabled={selecting || (!currentPreviewAudio && selectedIndices.length === 0)}
            >
              {selecting ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {t("selectAction")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
