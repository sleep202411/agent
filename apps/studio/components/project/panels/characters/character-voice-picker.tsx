"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconLoader2, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { VoiceOptionItem } from "@/src/types/workspace";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";

export function VoicePickerDialog({
  open,
  onOpenChange,
  voices,
  loading,
  selectedVoiceId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voices: Record<string, VoiceOptionItem[]>;
  loading: boolean;
  selectedVoiceId: string;
  onSelect: (voice: VoiceOptionItem) => void;
}) {
  const [activeLang, setActiveLang] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tabs = useMemo(() => Object.entries(voices), [voices]);
  const currentLang = activeLang || tabs[0]?.[0] || "";

  useEffect(() => {
    if (!open) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    }
  }, [open]);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingVoiceId("");
  }, []);

  useEffect(() => stopAudio, [stopAudio]);

  const togglePlay = useCallback(
    (voice: VoiceOptionItem) => {
      const voiceId = String(voice.voiceId ?? "");
      if (!voice.voicePath) return;
      if (playingVoiceId === voiceId) {
        stopAudio();
        return;
      }
      stopAudio();
      const audio = new Audio(buildOssUrl(String(voice.voicePath)));
      audio.onended = () => setPlayingVoiceId("");
      audio.onerror = () => setPlayingVoiceId("");
      audioRef.current = audio;
      setPlayingVoiceId(voiceId);
      void audio.play().catch((error) => {
        console.error("[VoicePickerDialog] 播放失败:", error);
        setPlayingVoiceId("");
      });
    },
    [playingVoiceId, stopAudio]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden p-0 sm:max-w-[560px]">
        <DialogHeader className="px-6 pt-5">
          <DialogTitle>角色语音</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6">
          {tabs.length > 1 ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {tabs.map(([lang, items]) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setActiveLang(lang)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    currentLang === lang
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {lang} ({items.length})
                </button>
              ))}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-2">
                {(voices[currentLang] ?? tabs[0]?.[1] ?? []).map((voice) => {
                  const voiceId = String(voice.voiceId ?? "");
                  const active = voiceId === selectedVoiceId;
                  return (
                    <button
                      key={voiceId}
                      type="button"
                      onClick={() => {
                        onSelect(voice);
                        onOpenChange(false);
                        stopAudio();
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-white/20 hover:bg-white/[0.02]"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">
                          {voice.voiceName || voiceId}
                        </div>
                        {voice.voiceDescription ? (
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {voice.voiceDescription}
                          </div>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        color="muted"
                        size="icon-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          togglePlay(voice);
                        }}
                      >
                        {playingVoiceId === voiceId ? (
                          <IconPlayerStop className="size-4" />
                        ) : (
                          <IconPlayerPlay className="size-4" />
                        )}
                      </Button>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
