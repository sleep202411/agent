import { useTranslations } from "@/src/i18n/i18n";
import { IconLoader2, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { VoiceOptionItem } from "@/src/types/workspace";

interface AudioVoicePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voiceGroups: Record<string, VoiceOptionItem[]>;
  activeVoiceLang: string;
  onLangChange: (lang: string) => void;
  selectedVoiceId: string;
  onSelectVoice: (voiceId: string) => void;
  playingVoiceId: string;
  onTogglePreview: (voice: VoiceOptionItem) => void;
  loading?: boolean;
  noModel?: boolean;
}

export function AudioVoicePickerDialog({
  open,
  onOpenChange,
  voiceGroups,
  activeVoiceLang,
  onLangChange,
  selectedVoiceId,
  onSelectVoice,
  playingVoiceId,
  onTogglePreview,
  loading,
  noModel,
}: AudioVoicePickerDialogProps) {
  const t = useTranslations("storyboard");
  const langOptions = Object.keys(voiceGroups);
  const currentVoices = activeVoiceLang ? (voiceGroups[activeVoiceLang] ?? []) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="gap-0 rounded-2xl border-white/10 bg-[#2F2F35] p-0 text-white ring-0 sm:max-w-[560px]"
      >
        <DialogHeader className="border-b border-white/10 px-5 py-4">
          <DialogTitle className="text-lg font-medium text-white">{t("selectVoice")}</DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-4 pt-3">
          <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
            {langOptions.map((lang) => (
              <Button
                key={lang}
                variant="ghost"
                size="sm"
                onClick={() => onLangChange(lang)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs",
                  lang === activeVoiceLang
                    ? "bg-white text-black hover:bg-white/90"
                    : "bg-white/[0.05] text-white/70 hover:bg-white/[0.08] hover:text-white"
                )}
              >
                {lang} ({voiceGroups[lang]?.length ?? 0})
              </Button>
            ))}
          </div>

          <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-10 text-sm text-[#8F8F92]">
                <IconLoader2 className="size-4 animate-spin" />
                {t("loadingVoices")}
              </div>
            ) : noModel ? (
              <div className="px-2 py-10 text-sm text-[#8F8F92]">{t("selectModelFirst")}</div>
            ) : !currentVoices.length ? (
              <div className="px-2 py-10 text-sm text-[#8F8F92]">{t("noVoicesInGroup")}</div>
            ) : (
              currentVoices.map((voice, index) => {
                const id = String(voice.voiceId ?? "");
                const active = id === selectedVoiceId;
                const playing = id === playingVoiceId;
                return (
                  <button
                    key={id || `voice_${index}`}
                    type="button"
                    onClick={() => {
                      onSelectVoice(id);
                      onOpenChange(false);
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
                        {voice.voiceName || t("unnamedVoice")}
                      </div>
                      {voice.voiceDescription ? (
                        <div className="mt-1 line-clamp-1 text-xs text-[#8F8F92]">
                          {voice.voiceDescription}
                        </div>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-3 size-8 shrink-0 rounded-full border border-white/10 bg-black/30 text-white hover:border-white/20"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePreview(voice);
                      }}
                    >
                      {playing ? (
                        <IconPlayerStop className="size-4" />
                      ) : (
                        <IconPlayerPlay className="size-4" />
                      )}
                    </Button>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
