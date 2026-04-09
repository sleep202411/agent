import { useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  IconCheck,
  IconDownload,
  IconLoader2,
  IconMicrophone,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RawAiModel, VoiceOptionItem } from "@/src/types/workspace";
import type { AudioResultItem } from "./lipsync-types";

export interface LipsyncAudioPanelProps {
  // TTS config
  narrationText: string;
  onNarrationTextChange: (text: string) => void;
  voiceModel: string;
  onVoiceModelChange: (model: string) => void;
  activeVoiceLang: string;
  onActiveVoiceLangChange: (lang: string) => void;
  voiceId: string;
  onVoiceIdChange: (id: string) => void;

  // Data
  voiceModels: RawAiModel[];
  voiceLangOptions: string[];
  currentVoices: VoiceOptionItem[];
  voiceGroups: Record<string, VoiceOptionItem[]>;
  allAudioItems: AudioResultItem[];
  referenceAudio: string;
  voiceModelCost: number;

  // Loading
  loadingVoiceModels: boolean;
  loadingVoices: boolean;
  loadingAudioHistory: boolean;

  // Playback
  playingAudioPath: string;
  playingVoiceId: string;
  onToggleAudioPreview: (path: string) => void;
  onToggleVoicePreview: (voice: VoiceOptionItem) => void;
  onDownload: (path: string, filename: string) => void;

  // Actions
  onSelectAudio: (path: string) => void;
  onGenerateAudio: () => void;
  onRetryAudio: (item: AudioResultItem) => void;
  isGenerating: boolean;
  audioColumnId: string;
}

function selectedVoiceName(
  voiceId: string,
  voiceGroups: Record<string, VoiceOptionItem[]>
): string {
  if (!voiceId) return "";
  for (const voices of Object.values(voiceGroups)) {
    const match = voices.find((v) => String(v.voiceId ?? "") === voiceId);
    if (match) return String(match.voiceName ?? "");
  }
  return "";
}

export function LipsyncAudioPanel({
  narrationText,
  onNarrationTextChange,
  voiceModel,
  onVoiceModelChange,
  activeVoiceLang,
  onActiveVoiceLangChange,
  voiceId,
  onVoiceIdChange,
  voiceModels,
  voiceLangOptions,
  currentVoices,
  voiceGroups,
  allAudioItems,
  referenceAudio,
  voiceModelCost,
  loadingVoiceModels,
  loadingVoices,
  loadingAudioHistory,
  playingAudioPath,
  playingVoiceId,
  onToggleAudioPreview,
  onToggleVoicePreview,
  onDownload,
  onSelectAudio,
  onGenerateAudio,
  onRetryAudio,
  isGenerating,
  audioColumnId,
}: LipsyncAudioPanelProps) {
  const t = useTranslations("storyboard");
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const voiceName = selectedVoiceName(voiceId, voiceGroups);

  return (
    <>
      <div className="flex h-full flex-col gap-4">
        {/* ── Top: Audio results grid (flex-1) ── */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 border border-white/10 rounded-xl">
          {loadingAudioHistory || !allAudioItems.length ? (
            <div className="flex h-full items-center justify-center text-sm text-[#8F8F92]">
              {loadingAudioHistory ? (
                <>
                  <IconLoader2 className="mr-2 size-4 animate-spin" />
                  {t("loadingAudio")}
                </>
              ) : (
                t("noAudio")
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {allAudioItems.map((item, index) => {
                const path = item.path;
                const selected = Boolean(path) && referenceAudio === path;
                const playing = Boolean(path) && playingAudioPath === path;
                return (
                  <button
                    key={item.id || `${path}_${index}`}
                    type="button"
                    disabled={!path && item.status !== "failed"}
                    onClick={() => {
                      if (item.status === "failed") {
                        onRetryAudio(item);
                        return;
                      }
                      if (!path) return;
                      onSelectAudio(path);
                    }}
                    className={cn(
                      "relative flex flex-col items-center justify-center gap-2 rounded-lg border px-3 py-4 transition-colors",
                      selected
                        ? "border-[#E52227] bg-[#E52227]/10"
                        : "border-white/10 bg-white/[0.03] hover:border-white/20",
                      item.status === "failed" && "border-[#E52227]/60"
                    )}
                  >
                    {/* Status icon */}
                    <div className="flex size-10 items-center justify-center rounded-full bg-white/5">
                      {item.status === "generating" ? (
                        <IconLoader2 className="size-5 animate-spin text-white/80" />
                      ) : item.status === "failed" ? (
                        <IconRefresh className="size-5 text-[#E52227]" />
                      ) : (
                        <IconMicrophone className="size-5 text-white/70" />
                      )}
                    </div>

                    {/* Label */}
                    <div className="w-full truncate text-center text-xs">
                      {item.status === "generating"
                        ? t("generatingStatus")
                        : item.status === "failed"
                          ? t("failedRetry")
                          : item.name || t("audioIndex", { index: index + 1 })}
                    </div>

                    {/* Selected badge */}
                    {selected ? (
                      <div className="absolute right-1.5 top-1.5">
                        <IconCheck className="size-4 text-[#E52227]" />
                      </div>
                    ) : null}

                    {/* Action buttons */}
                    {!item.status && path ? (
                      <div className="flex gap-1.5">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleAudioPreview(path);
                          }}
                          className="flex size-7 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white hover:border-white/20"
                        >
                          {playing ? (
                            <IconPlayerPause className="size-3.5" />
                          ) : (
                            <IconPlayerPlay className="size-3.5" />
                          )}
                        </span>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            onDownload(path, `audio_${index + 1}.mp3`);
                          }}
                          className="flex size-7 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white hover:border-white/20"
                        >
                          <IconDownload className="size-3.5" />
                        </span>
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Bottom: Narration input + compact toolbar (210px) ── */}
        <div className="flex h-52.5 shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
          <Textarea
            className="min-h-0 flex-1 resize-none border-0 bg-transparent text-sm text-white placeholder:text-[#6F6F72] focus-visible:ring-0"
            value={narrationText}
            onChange={(event) => onNarrationTextChange(event.target.value)}
            placeholder={t("narrationPlaceholder")}
          />

          {/* Toolbar */}
          <div className="flex shrink-0 items-center gap-2 px-2.5 py-2">
            <NativeSelect
              value={voiceModel}
              onChange={(event) => onVoiceModelChange(event.target.value)}
              disabled={loadingVoiceModels}
              className="h-8 max-w-[160px] bg-transparent text-xs dark:bg-transparent"
            >
              <NativeSelectOption value="" disabled>
                {loadingVoiceModels ? t("loadingModels") : t("voiceModel")}
              </NativeSelectOption>
              {voiceModels.map((item) => {
                const value = String(item.serviceCode ?? "");
                return (
                  <NativeSelectOption key={value} value={value}>
                    {item.serviceName ?? value}
                  </NativeSelectOption>
                );
              })}
            </NativeSelect>

            <button
              type="button"
              onClick={() => setVoiceDialogOpen(true)}
              disabled={!voiceModel || loadingVoices}
              className="flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs text-white transition-colors hover:border-white/20 disabled:opacity-50"
            >
              <IconMicrophone className="size-3.5" />
              {voiceName || t("selectVoice")}
            </button>

            {voiceModelCost ? (
              <span className="text-[11px] text-[#8F8F92]">
                {t("creditsAmount", { cost: voiceModelCost })}
              </span>
            ) : null}

            <div className="flex-1" />

            <Button
              size="sm"
              className="h-8 bg-[#E52227] px-3 text-white hover:bg-[#FF3D42]"
              onClick={onGenerateAudio}
              disabled={isGenerating}
            >
              {isGenerating ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
              {t("generate")}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Voice selection dialog ── */}
      <Dialog open={voiceDialogOpen} onOpenChange={setVoiceDialogOpen}>
        <DialogContent className="gap-0 rounded-xl border border-white/10 bg-[#262626] p-0 text-white sm:max-w-2xl">
          <DialogHeader className="border-b border-white/10 px-5 py-4">
            <DialogTitle className="text-base">{t("selectVoice")}</DialogTitle>
            <DialogDescription className="sr-only">{t("selectTtsVoice")}</DialogDescription>
          </DialogHeader>

          {/* Language tabs */}
          {voiceLangOptions.length > 1 ? (
            <div className="flex gap-1 overflow-x-auto border-b border-white/10 px-5 py-2 scrollbar-none">
              {voiceLangOptions.map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => onActiveVoiceLangChange(lang)}
                  className={cn(
                    "shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors",
                    activeVoiceLang === lang
                      ? "bg-[#E52227] text-white"
                      : "text-[#8F8F92] hover:text-white"
                  )}
                >
                  {lang} ({voiceGroups[lang]?.length ?? 0})
                </button>
              ))}
            </div>
          ) : null}

          {/* Voice list */}
          <div className="max-h-[400px] overflow-y-auto p-4">
            {loadingVoices ? (
              <div className="flex items-center justify-center py-8 text-sm text-[#8F8F92]">
                <IconLoader2 className="mr-2 size-4 animate-spin" />
                {t("loadingVoices")}
              </div>
            ) : !currentVoices.length ? (
              <div className="py-8 text-center text-sm text-[#8F8F92]">
                {t("noVoicesAvailable")}
              </div>
            ) : (
              <div className="space-y-2">
                {currentVoices.map((voice, index) => {
                  const currentVoiceId = String(voice.voiceId ?? "");
                  const active = currentVoiceId === voiceId;
                  const playing = currentVoiceId === playingVoiceId;
                  return (
                    <button
                      key={currentVoiceId || `voice_${index}`}
                      type="button"
                      onClick={() => {
                        onVoiceIdChange(active ? "" : currentVoiceId);
                        if (!active) setVoiceDialogOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors",
                        active
                          ? "border-[#E52227] bg-[#E52227]/10"
                          : "border-white/10 bg-white/[0.03] hover:border-white/20"
                      )}
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
                        {active ? (
                          <IconCheck className="size-4 text-[#E52227]" />
                        ) : (
                          <span className="text-xs text-[#8F8F92]">{t("select")}</span>
                        )}
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleVoicePreview(voice);
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
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
