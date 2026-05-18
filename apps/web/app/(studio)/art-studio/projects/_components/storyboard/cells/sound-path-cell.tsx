"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  IconCircleCheck,
  IconLoader2,
  IconMusic,
  IconPlayerPause,
  IconPlayerPlay,
  IconSparkles,
  IconUpload,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AiAudioGeneratorDialog } from "@/app/(studio)/art-studio/projects/_components/storyboard/ai-generator";
import { AudioWaveformBars } from "@/app/(studio)/art-studio/projects/_components/storyboard/ai-generator/audio-waveform-bars";
import { cn } from "@/lib/utils";
import { uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  clearSingleBatchCompleted,
  selectCurrentInstance,
  type ShotRow,
  type ShotValue,
} from "@/src/store/slices/projectSlice";
import { ossUrl, getPreferredFilePath, persistValueList } from "./cell-utils";

// ─── Types ─────────────────────────────────────────────

interface SoundPathCellProps {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
  row?: ShotRow;
}

// ─── Main Cell ─────────────────────────────────────────

export function SoundPathCell({ cell, shotId, shotColumnId, row }: SoundPathCellProps) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const [aiOpen, setAiOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [showGenerateDone, setShowGenerateDone] = useState(false);
  const dragCounterRef = useRef(0);
  const doneTimerRef = useRef<number | null>(null);

  const worldId = useAppSelector((state) => selectCurrentInstance(state).worldId);
  const isBatchGeneratingCell = useAppSelector((state) =>
    Boolean(selectCurrentInstance(state).batchGeneratingCells[`${shotId}:${shotColumnId}`])
  );
  const isBatchCompletedCell = useAppSelector((state) =>
    Boolean(selectCurrentInstance(state).batchCompletedCells[`${shotId}:${shotColumnId}`])
  );

  const path = getPreferredFilePath(cell);
  const src = ossUrl(path);

  useEffect(() => {
    return () => {
      if (doneTimerRef.current) window.clearTimeout(doneTimerRef.current);
    };
  }, []);

  // ─── Upload ──────────────────────────────────────────

  const handleUploadFile = useCallback(
    async (file: File) => {
      const acceptedMimeTypes = new Set(["audio/mpeg", "audio/wav", "audio/x-wav"]);
      const extension = `.${String(file.name.split(".").pop() ?? "").toLowerCase()}`;
      if (!acceptedMimeTypes.has(file.type) && ![".mp3", ".wav"].includes(extension)) {
        toast.error(t("pleaseUploadAudio"));
        return;
      }
      setUploading(true);
      try {
        const uploaded = await uploadWorkspaceFile(file, {
          uploadType: "SHOT_VALUE_AUDIO",
          sourceType: "LOCAL",
          accept: "audio/*",
        });
        await persistValueList(shotId, shotColumnId, [uploaded.path], {
          files: [{ path: uploaded.path, preferred: true }],
        });
      } catch (error) {
        console.error("[SoundPathCell] 上传音频失败:", error);
        toast.error(tc("uploadFailed"));
      } finally {
        setUploading(false);
      }
    },
    [shotColumnId, shotId, t, tc]
  );

  const handleAudioUpload = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav";
    input.onchange = (event) => {
      const target = event.target as HTMLInputElement | null;
      const file = target?.files?.[0];
      if (file) void handleUploadFile(file);
    };
    input.click();
  }, [handleUploadFile]);

  // ─── AI generate ─────────────────────────────────────

  const handleAiGenerate = () => {
    setShowGenerateDone(false);
    if (isBatchCompletedCell) {
      store.dispatch(clearSingleBatchCompleted({ shotId, columnId: shotColumnId }));
    }
    setAiOpen(true);
  };

  const handleSelectGeneratedAudios = useCallback(
    async (selectedPaths: string[]) => {
      const normalized = selectedPaths.map((item) => item.trim()).filter(Boolean);
      if (normalized.length === 0) return;
      await persistValueList(shotId, shotColumnId, normalized, {
        files: normalized.map((item, index) => ({ path: item, preferred: index === 0 })),
      });
    },
    [shotColumnId, shotId]
  );

  const aiButtonIcon =
    isAiGenerating || isBatchGeneratingCell ? (
      <IconLoader2 className="size-3.5 animate-spin" />
    ) : showGenerateDone || isBatchCompletedCell ? (
      <IconCircleCheck className="size-3.5 text-green-500" />
    ) : (
      <IconSparkles className="size-3.5" />
    );

  // ─── Drag handlers ───────────────────────────────────

  const dragHandlers = {
    onDragEnter: (event: React.DragEvent) => {
      event.preventDefault();
      dragCounterRef.current += 1;
      setIsDragOver(true);
    },
    onDragOver: (event: React.DragEvent) => event.preventDefault(),
    onDragLeave: () => {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setIsDragOver(false);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) void handleUploadFile(file);
    },
  };

  // ─── Render ──────────────────────────────────────────

  return (
    <>
      <div
        className={cn(
          "group relative flex h-full w-full items-center justify-center overflow-hidden rounded-md",
          isDragOver && "border-2 border-dashed border-primary bg-primary/10"
        )}
        {...dragHandlers}
      >
        {uploading ? (
          <SoundPathUploading />
        ) : isDragOver && !src ? (
          <div className="flex h-full w-full items-center justify-center text-center text-xs text-primary">
            {t("dragAudioHere")}
          </div>
        ) : src ? (
          <SoundPathFilled
            path={path}
            src={src}
            isAiGenerating={isAiGenerating}
            isBatchGeneratingCell={isBatchGeneratingCell}
            aiButtonIcon={aiButtonIcon}
            onPlay={undefined}
            onUpload={handleAudioUpload}
            onAiGenerate={handleAiGenerate}
          />
        ) : (
          <SoundPathEmpty
            isBatchGeneratingCell={isBatchGeneratingCell}
            aiButtonIcon={aiButtonIcon}
            onUpload={handleAudioUpload}
            onAiGenerate={handleAiGenerate}
          />
        )}
      </div>

      <AiAudioGeneratorDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        shotId={shotId}
        shotColumnId={shotColumnId}
        row={row}
        worldId={worldId ?? ""}
        currentAudioPath={path}
        onSelectPath={(selectedPath: string) => void handleSelectGeneratedAudios([selectedPath])}
        onGeneratingChange={setIsAiGenerating}
        onGenerateSuccess={() => {
          setShowGenerateDone(true);
          doneTimerRef.current = window.setTimeout(() => setShowGenerateDone(false), 5000);
        }}
      />
    </>
  );
}

// ─── Filled State (has audio) ──────────────────────────

function SoundPathFilled({
  path,
  src,
  isAiGenerating,
  isBatchGeneratingCell,
  aiButtonIcon,
  onUpload,
  onAiGenerate,
}: {
  path: string;
  src: string;
  isAiGenerating: boolean;
  isBatchGeneratingCell: boolean;
  aiButtonIcon: React.ReactNode;
  onPlay: undefined;
  onUpload: () => void;
  onAiGenerate: () => void;
}) {
  const t = useTranslations("storyboard");
  const [isHovering, setIsHovering] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopPlayback = useCallback(() => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setProgress(0);
  }, []);

  const updateProgress = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setProgress(audio.currentTime / (audio.duration || 1));
    rafRef.current = window.requestAnimationFrame(updateProgress);
  }, []);

  useEffect(() => {
    stopPlayback();
  }, [src, stopPlayback]);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  const handleTogglePlay = useCallback(() => {
    if (!src) return;
    if (isPlaying) {
      stopPlayback();
      return;
    }
    stopPlayback();
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.addEventListener("ended", stopPlayback);
    audio.addEventListener("error", stopPlayback);
    void audio
      .play()
      .then(() => {
        setIsPlaying(true);
        updateProgress();
      })
      .catch(() => stopPlayback());
  }, [isPlaying, src, stopPlayback, updateProgress]);

  const show = isHovering || isAiGenerating;

  return (
    <div
      className="relative flex h-full w-full items-center px-4"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div className="min-w-0 flex-1">
        <AudioWaveformBars
          audioKey={path}
          progress={isPlaying ? progress : 0}
          count={80}
          className="gap-px"
        />
      </div>

      <div
        className={cn(
          "absolute inset-x-2 bottom-1 flex items-center justify-center gap-1 px-2 py-1.5",
          show ? "pointer-events-auto" : "pointer-events-none"
        )}
      >
        {[
          {
            key: "play",
            icon: isPlaying ? (
              <IconPlayerPause className="size-3.5" />
            ) : (
              <IconPlayerPlay className="size-3.5" />
            ),
            title: isPlaying ? t("pause") : t("play"),
            onClick: handleTogglePlay,
            disabled: false,
          },
          {
            key: "upload",
            icon: <IconUpload className="size-3.5" />,
            title: t("uploadAudio"),
            onClick: onUpload,
            disabled: isBatchGeneratingCell,
          },
          {
            key: "ai",
            icon: aiButtonIcon,
            title: t("aiGenerate"),
            onClick: onAiGenerate,
            disabled: isBatchGeneratingCell,
            highlight: true,
          },
        ].map((action, index) => (
          <Button
            key={action.key}
            variant="ghost"
            color={"highlight" in action && action.highlight ? "primary" : "muted"}
            disabled={action.disabled}
            onClick={action.onClick}
            title={action.title}
            className={cn(
              "transition-all duration-200 ease-out",
              show ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            )}
            style={{ transitionDelay: show ? `${index * 50}ms` : "0ms" }}
          >
            {action.icon}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ─── Empty State (no audio) ────────────────────────────

function SoundPathEmpty({
  isBatchGeneratingCell,
  aiButtonIcon,
  onUpload,
  onAiGenerate,
}: {
  isBatchGeneratingCell: boolean;
  aiButtonIcon: React.ReactNode;
  onUpload: () => void;
  onAiGenerate: () => void;
}) {
  const t = useTranslations("storyboard");

  if (isBatchGeneratingCell) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
        <IconLoader2 className="size-5 animate-spin text-white/75" />
        <span className="text-[11px] font-medium text-white/80">{t("batchGenerating")}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex w-fit flex-col items-stretch justify-center gap-3">
        <Button size="sm" variant="soft" color="muted" onClick={onUpload}>
          {t("uploadAudio")}
        </Button>
        <Button size="sm" variant="soft" color="muted" onClick={onAiGenerate}>
          {aiButtonIcon}
          {t("aiGenerate")}
        </Button>
      </div>
    </div>
  );
}

// ─── Uploading State ───────────────────────────────────

function SoundPathUploading() {
  return (
    <div className="flex h-full w-full items-center justify-center px-4 py-3">
      <div className="flex w-full items-center gap-3 rounded-lg bg-white/3 px-4 py-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/70">
          <IconMusic className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <AudioWaveformBars loading />
        </div>
        <IconLoader2 className="size-4 animate-spin text-white/70" />
      </div>
    </div>
  );
}
