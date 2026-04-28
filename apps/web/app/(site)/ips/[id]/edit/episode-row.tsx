"use client";

import {
  IconFileText,
  IconGripVertical,
  IconPencil,
  IconPlaylist,
  IconTrash,
} from "@tabler/icons-react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { EpisodeDraft } from "./episode-dialog";

interface SortableEpisodeRowProps {
  id: string;
  index: number;
  episode: EpisodeDraft;
  ipId: string;
  onClick: () => void;
  onDelete: () => void;
}

export function SortableEpisodeRow({
  id,
  index,
  episode,
  ipId,
  onClick,
  onDelete,
}: SortableEpisodeRowProps) {
  const t = useTranslations("ipEdit");
  const { ref, handleRef, isDragging } = useSortable({ id, index });

  const subtitle = (() => {
    if (!episode.videoUrl) return t("epVideoMissing");
    const parts: string[] = [];
    if (episode.duration > 0) parts.push(formatDuration(episode.duration));
    const desc = episode.description?.trim();
    if (desc) parts.push(desc);
    return parts.length > 0 ? parts.join(" · ") : t("epVideoLinked");
  })();

  return (
    <div
      ref={ref}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card transition-colors",
        episode.type === "interactive"
          ? "border-violet-400/20 bg-violet-400/5 hover:border-violet-400/40"
          : "border-border/70 hover:border-primary/30",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      {/* Top strip — drag, EP marker, type chip, edit/delete */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-muted/30 px-2 py-1">
        <div className="flex items-center gap-1.5">
          <div
            ref={handleRef}
            className="flex shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
          >
            <IconGripVertical className="size-4" />
          </div>
          <span className="font-mono text-[11px] font-semibold tabular-nums tracking-wider text-muted-foreground">
            EP {String(index + 1).padStart(2, "0")}
          </span>
          {episode.type === "interactive" && (
            <span className="rounded bg-violet-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-400">
              {t("typeInteractive")}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-xs" onClick={onClick}>
            <IconPencil className="size-3.5" />
          </Button>
          {episode.type === "interactive" && (
            <Button variant="ghost" size="icon-xs" asChild>
              <a href={`/ips/${ipId}/episodes/${index + 1}/editor`}>
                <IconFileText className="size-3.5" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
            onClick={onDelete}
          >
            <IconTrash className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        {/* Thumbnail */}
        <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/50">
          {episode.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={episode.cover} alt="" className="size-full object-cover" />
          ) : (
            <IconPlaylist className="size-6 text-muted-foreground/30" />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-1">
          <div
            className={cn(
              "truncate text-sm",
              episode.title ? "font-medium text-foreground" : "text-muted-foreground"
            )}
          >
            {episode.title || t("epUntitled")}
          </div>
          <div className="line-clamp-1 text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </button>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
