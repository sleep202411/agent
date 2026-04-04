"use client";

import { IconDownload, IconPlayerPause, IconPlayerPlay, IconTrash } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface MusicCardProps {
  title: string;
  time: string;
  playing?: boolean;
  onPlay: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

export function MusicCard({ title, time, playing, onPlay, onDownload, onDelete }: MusicCardProps) {
  return (
    <button
      type="button"
      onClick={onPlay}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        playing ? "bg-primary/10" : "hover:bg-muted/50"
      )}
    >
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors",
          playing && "bg-primary/15 text-primary"
        )}
      >
        {playing ? <IconPlayerPause className="size-4" /> : <IconPlayerPlay className="size-4" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{time}</div>
      </div>

      <div
        className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <Button size="icon-xs" variant="ghost" color="muted" onClick={onDownload}>
          <IconDownload className="size-3.5" />
        </Button>
        <Button size="icon-xs" variant="ghost" color="muted" onClick={onDelete}>
          <IconTrash className="size-3.5" />
        </Button>
      </div>
    </button>
  );
}
