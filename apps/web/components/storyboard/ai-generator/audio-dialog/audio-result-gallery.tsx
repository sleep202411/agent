"use client";

import {
  IconCheck,
  IconDownload,
  IconLoader2,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AudioWaveformBars } from "@/components/storyboard/ai-generator/audio-waveform-bars";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import type { ResultItem } from "@/src/store/slices/projectSlice";

interface AudioResultGalleryProps {
  items: ResultItem[];
  loading?: boolean;
  currentAudioPath?: string;
  playingPath?: string;
  audioProgress?: number;
  selectingPath?: string;
  onTogglePlay?: (item: ResultItem) => void;
  onSelect?: (item: ResultItem) => void;
  onDownload?: (item: ResultItem) => void;
  onDelete?: (item: ResultItem) => void;
  onRetry?: (item: ResultItem) => void;
  emptyText?: string;
}

function isCurrentAudio(path: string | undefined, currentAudioPath: string) {
  if (!path || !currentAudioPath) return false;
  return (
    path === currentAudioPath || currentAudioPath.endsWith(path) || path.endsWith(currentAudioPath)
  );
}

export function AudioResultGallery({
  items,
  loading,
  currentAudioPath = "",
  playingPath = "",
  audioProgress = 0,
  selectingPath = "",
  onTogglePlay,
  onSelect,
  onDownload,
  onDelete,
  onRetry,
  emptyText = "AI 生成",
}: AudioResultGalleryProps) {
  const t = useTranslations("storyboard");
  if (!items.length && !loading) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.02]">
        <h3 className="text-[18px] font-semibold text-[#E52227]">{emptyText}</h3>
      </div>
    );
  }

  if (loading && !items.length) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.02]">
        <IconLoader2 className="size-5 animate-spin text-white/50" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="grid flex-1 auto-rows-min grid-cols-3 gap-3 overflow-y-auto rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-3">
        {items.map((item) => {
          const isQueue = item.fromQueue;
          const isFailed = item.status === "failed";
          const isLoading = isQueue && !isFailed && item.status !== "success";
          const path = item.storagePath ?? "";
          const playing = Boolean(path && playingPath === path);
          const current = isCurrentAudio(path, currentAudioPath);
          const selecting = Boolean(path && selectingPath === path);

          if (isFailed) {
            return (
              <div
                key={item.id}
                className="group relative flex min-h-[72px] cursor-pointer items-stretch overflow-hidden rounded-lg border border-transparent bg-white/[0.06]"
              >
                <button
                  type="button"
                  onClick={() => onRetry?.(item)}
                  className="flex w-full items-center justify-center gap-2 px-3 py-4 text-xs text-white/55 transition-colors hover:text-white/85"
                >
                  <IconRefresh className="size-4 text-[#E52227]" />
                  <span>{item.error || t("generationFailed")}</span>
                </button>
              </div>
            );
          }

          if (isLoading) {
            return (
              <div
                key={item.id}
                className="group relative flex min-h-[72px] items-stretch overflow-hidden rounded-lg border border-[#E52227]/20 bg-white/[0.06]"
              >
                <div className="flex w-full items-center gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <AudioWaveformBars audioKey="" progress={0} loading />
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={item.id}
              onClick={() => onTogglePlay?.(item)}
              className={cn(
                "group relative flex min-h-[72px] cursor-pointer items-stretch overflow-hidden rounded-lg border bg-white/[0.06] transition-colors",
                current ? "border-[#E52227]/60" : "border-transparent",
                "hover:border-[#E52227]/50"
              )}
            >
              <div className="flex w-full items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <AudioWaveformBars
                    audioKey={path}
                    progress={playing ? audioProgress : 0}
                    loading={false}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {onSelect && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={selecting}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(item);
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
                            </span>
                          ) : current ? (
                            <span className="inline-flex items-center gap-1">
                              <IconCheck className="size-3" />
                              {t("current")}
                            </span>
                          ) : (
                            t("select")
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {current ? t("currentlyUsing") : t("useThisAudio")}
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {onDownload && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDownload(item);
                      }}
                      className="h-7 w-0 overflow-hidden rounded-full bg-white/[0.12] text-white transition-all duration-300 group-hover:w-7"
                    >
                      <span className="flex h-7 w-7 items-center justify-center">
                        <IconDownload className="size-4" />
                      </span>
                    </button>
                  )}

                  {onDelete && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(item);
                      }}
                      className="h-7 w-0 overflow-hidden rounded-full bg-white/[0.12] text-white transition-all duration-300 group-hover:w-7"
                    >
                      <span className="flex h-7 w-7 items-center justify-center">
                        <IconTrash className="size-4" />
                      </span>
                    </button>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-full bg-white/[0.12] text-white hover:bg-white/[0.2]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePlay?.(item);
                    }}
                  >
                    {playing ? (
                      <IconPlayerPause className="size-4" />
                    ) : (
                      <IconPlayerPlay className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
