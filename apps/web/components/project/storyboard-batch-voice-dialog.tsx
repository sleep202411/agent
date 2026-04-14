import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconLoader2, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { backendApi } from "@/src/lib/api";
import type { RawAiModel, VoiceOptionItem } from "@/src/types/workspace";
import { useTranslations } from "@/src/i18n/i18n";
import { useRawAiModels } from "@/src/hooks/use-ai-models";
import { AI_MODEL_PATHS } from "@/components/ui/schema-field/paths";
import { env } from "@/src/env";
const OSS_BASE = env.OSS_BASE_URL;

export interface BatchVoiceConfig {
  model: string;
  voiceId: string;
}

interface StoryboardBatchVoiceDialogProps {
  open: boolean;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (config: BatchVoiceConfig) => void;
}

function ossUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${OSS_BASE}/${path}`;
}

export function StoryboardBatchVoiceDialog({
  open,
  loading = false,
  onOpenChange,
  onConfirm,
}: StoryboardBatchVoiceDialogProps) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const { models: cachedModels, loading: loadingModels } = useRawAiModels(AI_MODEL_PATHS.voice);
  const models = cachedModels as RawAiModel[];
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [model, setModel] = useState("");
  const [voiceGroups, setVoiceGroups] = useState<Record<string, VoiceOptionItem[]>>({});
  const [activeLang, setActiveLang] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const modelOptions = useMemo(
    () =>
      models.map((item) => ({
        label: item.serviceName ?? item.serviceCode ?? "",
        value: String(item.serviceCode ?? ""),
      })),
    [models]
  );
  const currentModel = useMemo(
    () => models.find((item) => String(item.serviceCode ?? "") === model),
    [model, models]
  );
  const currentModelCost = Math.abs(Number(currentModel?.integralCost ?? 0));
  const langTabs = useMemo(() => Object.keys(voiceGroups), [voiceGroups]);
  const currentLang = activeLang || langTabs[0] || "";
  const currentVoices = currentLang ? (voiceGroups[currentLang] ?? []) : [];

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingVoiceId("");
  };

  const loadVoices = useCallback((modelCode: string) => {
    setLoadingVoices(true);
    setVoiceGroups({});
    setVoiceId("");
    setActiveLang("");
    stopAudio();
    let active = true;

    backendApi
      .get<Record<string, VoiceOptionItem[]>>("/api/ai/voice/voices/list", {
        params: { voiceType: modelCode },
      })
      .then((result) => {
        if (!active) return;
        const groups = result ?? {};
        setVoiceGroups(groups);
        const firstLang = Object.keys(groups)[0] ?? "";
        setActiveLang(firstLang);
      })
      .catch((error) => {
        console.error("[StoryboardBatchVoiceDialog] 加载音色失败:", error);
      })
      .finally(() => {
        if (active) {
          setLoadingVoices(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (models.length === 0) return;
    const defaultModelCode =
      models.find((item) => item.isDefault)?.serviceCode ?? models[0]?.serviceCode ?? "";
    const modelCode = String(defaultModelCode);
    setModel(modelCode);
    if (modelCode) {
      const cleanup = loadVoices(modelCode);
      return () => {
        cleanup();
        stopAudio();
      };
    }
    return () => {
      stopAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  const handleModelChange = (nextModelCode: string) => {
    setModel(nextModelCode);
    if (nextModelCode) {
      loadVoices(nextModelCode);
      return;
    }
    stopAudio();
    setVoiceGroups({});
    setVoiceId("");
    setActiveLang("");
  };

  const toggleVoicePreview = (voice: VoiceOptionItem) => {
    if (!voice.voiceId) return;
    if (playingVoiceId === voice.voiceId) {
      stopAudio();
      return;
    }

    stopAudio();
    const url = ossUrl(voice.voicePath);
    if (!url) return;

    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setPlayingVoiceId("");
    audio.onerror = () => setPlayingVoiceId("");
    audio
      .play()
      .then(() => setPlayingVoiceId(String(voice.voiceId)))
      .catch(() => setPlayingVoiceId(""));
  };

  const handleConfirm = () => {
    onConfirm({ model, voiceId });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!loading ? onOpenChange(next) : undefined)}>
      <DialogContent
        showCloseButton={!loading}
        className="gap-0 rounded-xl border border-border bg-[#262626] p-0 text-white sm:max-w-[540px]"
      >
        <DialogHeader className="border-b border-white/10 px-6 py-4">
          <DialogTitle>{t("batchVoiceTitle")}</DialogTitle>
          <DialogDescription className="text-xs text-[#8F8F92]">
            {t("batchVoiceDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <div className="text-sm font-medium">{t("modelLabel")}</div>
            <NativeSelect
              value={model}
              onChange={(event) => handleModelChange(event.target.value)}
              disabled={loading || loadingModels}
              className="w-full"
            >
              <NativeSelectOption value="" disabled>
                {loadingModels ? t("loadingModels") : t("selectModel")}
              </NativeSelectOption>
              {modelOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {currentModelCost ? (
              <div className="text-xs text-[#8F8F92]">
                {t("costPerVoice", { cost: currentModelCost })}
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="text-sm font-medium">{t("voiceLabel")}</div>
            {loadingVoices ? (
              <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-[#8F8F92]">
                <IconLoader2 className="size-4 animate-spin" />
                {t("loadingVoices")}
              </div>
            ) : !model ? (
              <div className="rounded-lg border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-[#8F8F92]">
                {t("selectModelFirst")}
              </div>
            ) : (
              <>
                {langTabs.length > 0 ? (
                  <NativeSelect
                    value={currentLang}
                    onChange={(event) => setActiveLang(event.target.value)}
                    className="w-full"
                  >
                    {langTabs.map((lang) => (
                      <NativeSelectOption key={lang} value={lang}>
                        {lang} ({voiceGroups[lang]?.length ?? 0})
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : null}

                <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                  {currentVoices.map((voice, index) => {
                    const active = String(voice.voiceId ?? "") === voiceId;
                    const playing = String(voice.voiceId ?? "") === playingVoiceId;
                    return (
                      <button
                        key={String(voice.voiceId ?? `${voice.voiceName ?? "voice"}_${index}`)}
                        type="button"
                        onClick={() =>
                          setVoiceId((current) =>
                            current === String(voice.voiceId ?? "")
                              ? ""
                              : String(voice.voiceId ?? "")
                          )
                        }
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors ${
                          active
                            ? "border-[#E52227] bg-[#E52227]/10"
                            : "border-white/8 bg-white/[0.03] hover:border-white/15"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {voice.voiceName || t("unnamedVoice")}
                          </div>
                          {voice.voiceDescription ? (
                            <div className="mt-1 line-clamp-2 text-xs text-[#8F8F92]">
                              {voice.voiceDescription}
                            </div>
                          ) : null}
                        </div>
                        <div className="ml-3 flex shrink-0 items-center gap-2">
                          <span className="text-xs text-[#8F8F92]">
                            {active ? t("voiceSelected") : t("voiceClickToSelect")}
                          </span>
                          <span
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleVoicePreview(voice);
                            }}
                            className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white hover:border-white/20"
                          >
                            {playing ? (
                              <IconPlayerStop className="size-4" />
                            ) : (
                              <IconPlayerPlay className="size-4" />
                            )}
                          </span>
                        </div>
                      </button>
                    );
                  })}

                  {!currentVoices.length ? (
                    <div className="rounded-lg border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-[#8F8F92]">
                      {t("noVoicesInGroup")}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="border-white/10 bg-transparent">
          <Button
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {tc("cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !model}
            className="bg-[#E52227] text-white hover:bg-[#FF3D42]"
          >
            {loading ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {tc("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
