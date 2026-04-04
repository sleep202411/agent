"use client";

import { IconPhoto, IconPlayerPlay, IconRefresh } from "@tabler/icons-react";
import { Spinner } from "@/components/ui/spinner";
import type { ImageStatus } from "@/src/types/storyboard";

interface ThumbnailCellProps {
  imageUrl?: string;
  videoUrl?: string;
  imageStatus: ImageStatus;
  onGenerate?: () => void;
}

export function ThumbnailCell({ imageUrl, videoUrl, imageStatus, onGenerate }: ThumbnailCellProps) {
  if (imageStatus === "generating") {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded bg-muted/30">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }

  if (imageStatus === "failed") {
    return (
      <button
        type="button"
        onClick={onGenerate}
        className="flex aspect-video w-full items-center justify-center gap-1 rounded bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
      >
        <IconRefresh className="size-3.5" />
        <span className="text-[10px]">重试</span>
      </button>
    );
  }

  if (imageUrl || videoUrl) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded bg-muted/30">
        <img src={imageUrl || videoUrl} alt="" className="size-full object-cover" />
        {videoUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <IconPlayerPlay className="size-5 text-white" />
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onGenerate}
      className="flex aspect-video w-full items-center justify-center rounded border border-dashed border-border bg-muted/20 text-muted-foreground/40 transition-colors hover:border-primary/40 hover:text-primary"
    >
      <IconPhoto className="size-5" />
    </button>
  );
}
