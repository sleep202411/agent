"use client";

import { useCallback, useRef, useState } from "react";
import { IconLoader2, IconPlayerPause, IconPlayerPlay, IconUpload } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { MediaPreviewModal } from "@/components/media/media-preview-modal";
import { AudioWaveformBars } from "@/app/(studio)/art-studio/projects/_components/storyboard/ai-generator/audio-waveform-bars";
import { cn } from "@/lib/utils";
import { uploadWorkspaceFile } from "@/src/lib/uploads/workspace-upload";
import { store } from "@/src/store";
import {
  setRows,
  selectCurrentInstance,
  type ShotColumn,
  type ShotValue,
} from "@/src/store/slices/projectSlice";
import {
  ossUrl,
  getPreferredFilePath,
  upsertShotCell,
  resolveShotValueId,
  getPrimaryMediaPath,
} from "./cell-utils";
import { backendApi } from "@/src/lib/api";

export function MusicCell({
  cell,
  shotId,
  shotColumnId,
  column,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
  column?: ShotColumn;
}) {
  const t = useTranslations("storyboard");
  const [isHovering, setIsHovering] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioPlayProgress, setAudioPlayProgress] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const path =
    getPreferredFilePath(cell) ||
    getPrimaryMediaPath((cell?.files as Array<{ path?: string; storagePath?: string }>) ?? []);
  const src = ossUrl(path);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";

      setUploading(true);
      try {
        const result = await uploadWorkspaceFile(file, {
          uploadType: "STORYBOARD",
          accept: "audio/*",
        });

        const currentRows = selectCurrentInstance(store.getState()).rows;
        store.dispatch(
          setRows(
            upsertShotCell(currentRows, shotId, shotColumnId, {
              value: result.path,
            })
          )
        );

        const apiResult = await backendApi.post("/api/user/shotValue/input", {
          data: { shotId, shotColumnId, value: result.path },
        });
        const nextId = resolveShotValueId(apiResult);

        if (nextId) {
          const rows = selectCurrentInstance(store.getState()).rows;
          store.dispatch(
            setRows(
              upsertShotCell(rows, shotId, shotColumnId, {
                id: nextId,
                value: result.path,
              })
            )
          );
        }

        toast.success(t("uploadSuccess"));
      } catch (error) {
        console.error("[MusicCell] 上传失败:", error);
        toast.error(t("uploadFailed"));
      } finally {
        setUploading(false);
      }
    },
    [shotId, shotColumnId]
  );

  const handleTogglePlay = useCallback(() => {
    if (!src) return;

    if (isAudioPlaying) {
      audioRef.current?.pause();
      setIsAudioPlaying(false);
      return;
    }

    if (!audioRef.current) {
      audioRef.current = new Audio(src);
      audioRef.current.addEventListener("ended", () => {
        setIsAudioPlaying(false);
        setAudioPlayProgress(0);
      });
      audioRef.current.addEventListener("timeupdate", () => {
        if (audioRef.current) {
          const progress = audioRef.current.currentTime / (audioRef.current.duration || 1);
          setAudioPlayProgress(progress);
        }
      });
    }

    audioRef.current.play();
    setIsAudioPlaying(true);
  }, [src, isAudioPlaying]);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => void handleFileSelected(e)}
      />

      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden p-3"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <IconLoader2 className="size-5 animate-spin text-white/75" />
            <span className="text-[11px] text-white/60">{t("uploading")}</span>
          </div>
        ) : src ? (
          <div className="flex w-full items-center gap-3">
            <div className="min-w-0 flex-1">
              <AudioWaveformBars
                audioKey={path}
                progress={isAudioPlaying ? audioPlayProgress : 0}
              />
              <div
                className={cn(
                  "mt-2 transition-all overflow-hidden",
                  isHovering ? "max-h-12 opacity-100" : "max-h-0 opacity-0"
                )}
              >
                <Button size="sm" variant="soft" color="muted" onClick={handleUpload}>
                  <IconUpload className="size-3.5" />
                  {t("replaceAudio")}
                </Button>
              </div>
            </div>
            <button
              type="button"
              onClick={handleTogglePlay}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/80 text-white transition-colors hover:bg-primary"
            >
              {isAudioPlaying ? (
                <IconPlayerPause className="size-4" />
              ) : (
                <IconPlayerPlay className="ml-0.5 size-4" />
              )}
            </button>
          </div>
        ) : (
          <div className="flex w-fit flex-col items-stretch justify-center gap-3">
            <Button size="sm" variant="soft" color="muted" onClick={handleUpload}>
              <IconUpload className="size-3.5" />
              {t("uploadAudio")}
            </Button>
          </div>
        )}
      </div>

      {src && (
        <MediaPreviewModal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          type="audio"
          src={src}
          name={column?.columnName ?? t("music")}
        />
      )}
    </>
  );
}
