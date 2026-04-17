"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AudioResultGallery } from "./audio-result-gallery";
import { AudioPromptInput } from "./audio-prompt-input";
import { AudioVoicePickerDialog } from "./audio-voice-picker-dialog";
import { useAppDispatch, useAppSelector } from "@/src/store";
import {
  selectCurrentInstance,
  makeSelectAllAudioResults,
  initAudioInstance,
  deleteAudioItem,
  updateAudioForm,
  type ResultItem,
  type ShotRow,
} from "@/src/store/slices/projectSlice";
import { submitAudioTask, retryAudioTask } from "@/src/lib/ai-audio-queue";
import { useRawAiModels } from "@/src/hooks/use-ai-models";
import { AI_MODEL_PATHS } from "@/components/ui/schema-field/paths";
import {
  getDialogueTextFromShotValues,
  resolveDialogueVoicePreset,
} from "@/src/lib/storyboard-dialogue";
import { backendApi } from "@/src/lib/api";
import type { VoiceOptionItem } from "@/src/types/workspace";
import { env } from "@/src/env";

const OSS_BASE = env.OSS_BASE_URL;

function ossUrl(path?: string | null) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:"))
    return path;
  return `${OSS_BASE}/${path}`;
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
  const t = useTranslations("storyboard");
  const dispatch = useAppDispatch();

  // ─── Redux state ──────────────────────────────────────
  const instProj = useAppSelector(selectCurrentInstance);
  const audioForm = instProj.aiAudioForm;
  const inst = useAppSelector((s) => {
    const key = `${shotId}_${shotColumnId}`;
    return selectCurrentInstance(s).aiAudioForm.instances[key] ?? null;
  });
  const selectAllResults = useMemo(makeSelectAllAudioResults, []);
  const allResults = useAppSelector((s) => selectAllResults(s, shotId, shotColumnId));
  const { models: cachedVoiceModels } = useRawAiModels(AI_MODEL_PATHS.voice);
  const voiceModels = audioForm.models.length > 0 ? audioForm.models : (cachedVoiceModels ?? []);

  const formData = inst?.formData ?? { prompt: "", model: "", voiceId: "", count: 1 };
  const historyLoading = inst?.historyLoading ?? false;

  // ─── Local-only state (not cached) ────────────────────
  const [voiceGroups, setVoiceGroups] = useState<Record<string, VoiceOptionItem[]>>({});
  const [activeVoiceLang, setActiveVoiceLang] = useState("");
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [playingAudioPath, setPlayingAudioPath] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState("");
  const [audioProgress, setAudioProgress] = useState(0);
  const [selectingPath, setSelectingPath] = useState("");

  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const voicePreviewRef = useRef<HTMLAudioElement | null>(null);
  const progressRafRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const previousGeneratingRef = useRef(false);

  // ─── Derived state ────────────────────────────────────
  const isGenerating = useMemo(
    () =>
      allResults.some(
        (item) => item.fromQueue && item.status !== "success" && item.status !== "failed"
      ),
    [allResults]
  );

  const selectedVoiceName = useMemo(() => {
    if (!formData.voiceId) return "";
    for (const voices of Object.values(voiceGroups)) {
      const matched = voices.find((v) => String(v.voiceId ?? "") === formData.voiceId);
      if (matched?.voiceName) return String(matched.voiceName);
    }
    return "";
  }, [voiceGroups, formData.voiceId]);

  const voiceModelCost = Math.abs(
    Number(
      voiceModels.find((m) => String(m.serviceCode ?? "") === formData.model)?.integralCost ?? 0
    )
  );

  // ─── Audio preview ────────────────────────────────────
  const stopProgressLoop = useCallback(() => {
    if (progressRafRef.current) {
      cancelAnimationFrame(progressRafRef.current);
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

  const toggleAudioPreview = useCallback(
    (path: string) => {
      if (!path) return;
      if (playingAudioPath === path) {
        stopAudioPreview();
        return;
      }
      stopAudioPreview();
      const audio = new Audio(ossUrl(path));
      audioPreviewRef.current = audio;
      audio.onended = () => stopAudioPreview();
      audio.onerror = () => stopAudioPreview();
      const updateProgress = () => {
        if (!audio.duration) return;
        setAudioProgress(audio.currentTime / audio.duration);
        progressRafRef.current = requestAnimationFrame(updateProgress);
      };
      audio
        .play()
        .then(() => {
          setPlayingAudioPath(path);
          progressRafRef.current = requestAnimationFrame(updateProgress);
        })
        .catch(() => stopAudioPreview());
    },
    [playingAudioPath, stopAudioPreview]
  );

  const toggleVoicePreview = useCallback(
    (voice: VoiceOptionItem) => {
      const id = String(voice.voiceId ?? "");
      if (!id) return;
      if (playingVoiceId === id) {
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
        .then(() => setPlayingVoiceId(id))
        .catch(() => setPlayingVoiceId(""));
    },
    [playingVoiceId, stopVoicePreview]
  );

  // ─── Voice loading ────────────────────────────────────
  const loadVoices = useCallback(
    async (modelCode: string, preferredVoiceId?: string) => {
      if (!modelCode) {
        setVoiceGroups({});
        setActiveVoiceLang("");
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
            voices.some((v) => String(v.voiceId ?? "") === String(preferredVoiceId))
          );
          setActiveVoiceLang(matchedGroup?.[0] ?? Object.keys(groups)[0] ?? "");
          const matched = matchedGroup?.[1]?.find(
            (v) => String(v.voiceId ?? "") === String(preferredVoiceId)
          );
          if (matched) {
            dispatch(
              updateAudioForm({
                shotId,
                colId: shotColumnId,
                updates: { voiceId: String(matched.voiceId) },
              })
            );
          }
          return;
        }
        setActiveVoiceLang(Object.keys(groups)[0] ?? "");
      } catch {
        toast.error(t("loadVoicesFailed"));
      } finally {
        setLoadingVoices(false);
      }
    },
    [dispatch, shotColumnId, shotId, stopVoicePreview]
  );

  // ─── Auto-load voices when model changes ───────────────
  useEffect(() => {
    if (open && formData.model) {
      void loadVoices(formData.model, formData.voiceId || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.model, open]);

  // ─── Generating change callback ───────────────────────
  useEffect(() => {
    onGeneratingChange?.(isGenerating);
    if (previousGeneratingRef.current && !isGenerating) {
      onGenerateSuccess?.();
    }
    previousGeneratingRef.current = isGenerating;
  }, [isGenerating, onGenerateSuccess, onGeneratingChange]);

  // ─── Initialize on open ───────────────────────────────
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
        const defaultPrompt = getDialogueTextFromShotValues(shotValues);
        await dispatch(
          initAudioInstance({ shotId, colId: shotColumnId, opts: { defaultPrompt } })
        ).unwrap();

        if (!active) return;

        const voicePreset =
          row && worldId
            ? await resolveDialogueVoicePreset({ shotValues, worldId }).catch(() => ({
                voiceId: "",
                model: "",
                speakerName: "",
                referenceFacePath: "",
              }))
            : { voiceId: "", model: "", speakerName: "", referenceFacePath: "" };

        if (!active) return;

        const presetModel = String(voicePreset?.model ?? "");
        const matchesModel = voiceModels.some((m) => String(m.serviceCode ?? "") === presetModel);
        const defaultModelCode = matchesModel ? presetModel : "";

        if (defaultModelCode) {
          dispatch(
            updateAudioForm({
              shotId,
              colId: shotColumnId,
              updates: {
                model: defaultModelCode,
                voiceId: String(voicePreset?.voiceId ?? ""),
              },
            })
          );
          void loadVoices(defaultModelCode, String(voicePreset?.voiceId ?? ""));
        }

        initializedRef.current = true;
      }
    };

    void initialize();
    return () => {
      active = false;
    };
  }, [
    dispatch,
    loadVoices,
    open,
    row,
    shotColumnId,
    shotId,
    stopAudioPreview,
    stopVoicePreview,
    voiceModels,
    worldId,
  ]);

  // ─── Cleanup on unmount ───────────────────────────────
  useEffect(() => {
    return () => {
      stopAudioPreview();
      stopVoicePreview();
    };
  }, [stopAudioPreview, stopVoicePreview]);

  // ─── Handlers ─────────────────────────────────────────
  const handleModelChange = async (modelCode: string) => {
    dispatch(
      updateAudioForm({ shotId, colId: shotColumnId, updates: { model: modelCode, voiceId: "" } })
    );
    await loadVoices(modelCode);
  };

  const handleGenerate = () => {
    const prompt = formData.prompt.trim();
    if (!prompt) {
      toast.warning(t("enterNarrationFirst"));
      return;
    }
    for (let i = 0; i < formData.count; i++) {
      submitAudioTask({
        shotId,
        shotColumnId,
        prompt,
        model: formData.model || undefined,
        voiceId: formData.voiceId || undefined,
      });
    }
  };

  const handleTogglePlay = (item: ResultItem) => {
    const path = item.storagePath ?? "";
    if (path) toggleAudioPreview(path);
  };

  const handleSelect = async (item: ResultItem) => {
    const path = item.storagePath ?? "";
    if (!path) return;
    setSelectingPath(path);
    try {
      await onSelectPath(path);
      toast.success(t("voiceUpdated"));
    } catch {
      toast.error(t("voiceUpdateFailed"));
    } finally {
      setSelectingPath("");
    }
  };

  const handleDownload = (item: ResultItem) => {
    const url = item.url || ossUrl(item.storagePath);
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRetry = (item: ResultItem) => {
    if (item.fromQueue) retryAudioTask(item.id);
  };

  const handleDelete = (item: ResultItem) => {
    void dispatch(deleteAudioItem({ shotId, colId: shotColumnId, item }));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="gap-0 rounded-2xl border border-white/10 bg-[#2F2F35] p-0 text-white sm:max-w-[800px]"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader className="px-6 pb-3 pt-5">
            <DialogTitle>{t("aiVoice")}</DialogTitle>
          </DialogHeader>

          <div className="px-4 pb-4">
            <div className="flex h-[360px] flex-col">
              <AudioResultGallery
                items={allResults}
                loading={historyLoading}
                currentAudioPath={currentAudioPath}
                playingPath={playingAudioPath}
                audioProgress={audioProgress}
                selectingPath={selectingPath}
                onTogglePlay={handleTogglePlay}
                onSelect={handleSelect}
                onDownload={handleDownload}
                onDelete={handleDelete}
                onRetry={handleRetry}
              />
            </div>

            <div className="mt-3">
              <AudioPromptInput
                prompt={formData.prompt}
                onPromptChange={(v) =>
                  dispatch(updateAudioForm({ shotId, colId: shotColumnId, updates: { prompt: v } }))
                }
                model={formData.model}
                onModelChange={(v) => void handleModelChange(v)}
                voiceModels={voiceModels}
                selectedVoiceName={selectedVoiceName}
                onOpenVoicePicker={() => setShowVoicePicker(true)}
                onClearVoice={
                  formData.voiceId
                    ? () =>
                        dispatch(
                          updateAudioForm({ shotId, colId: shotColumnId, updates: { voiceId: "" } })
                        )
                    : undefined
                }
                hasVoice={Boolean(formData.voiceId)}
                count={formData.count}
                onCountChange={(v) =>
                  dispatch(updateAudioForm({ shotId, colId: shotColumnId, updates: { count: v } }))
                }
                cost={voiceModelCost * formData.count}
                isGenerating={isGenerating}
                onSubmit={handleGenerate}
                characters={instProj.characters}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AudioVoicePickerDialog
        open={showVoicePicker}
        onOpenChange={(nextOpen) => {
          setShowVoicePicker(nextOpen);
          if (!nextOpen) stopVoicePreview();
        }}
        voiceGroups={voiceGroups}
        activeVoiceLang={activeVoiceLang}
        onLangChange={setActiveVoiceLang}
        selectedVoiceId={formData.voiceId}
        onSelectVoice={(id) =>
          dispatch(updateAudioForm({ shotId, colId: shotColumnId, updates: { voiceId: id } }))
        }
        playingVoiceId={playingVoiceId}
        onTogglePreview={toggleVoicePreview}
        loading={loadingVoices}
        noModel={!formData.model}
      />
    </>
  );
}
