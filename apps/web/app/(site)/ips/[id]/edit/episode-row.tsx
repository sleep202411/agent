"use client";

import {
  IconGripVertical,
  IconPencil,
  IconPlayerPlayFilled,
  IconPlaylist,
  IconTrash,
} from "@tabler/icons-react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ipImageUrl, type Episode } from "@/app/(site)/ips/_hooks/use-ip";

interface SortableEpisodeRowProps {
  id: string;
  index: number;
  episode: Episode;
  onClick: () => void;
  onDelete: () => void;
}

export function SortableEpisodeRow({
  id,
  index,
  episode,
  onClick,
  onDelete,
}: SortableEpisodeRowProps) {
  const t = useTranslations("ipEdit");
  const { ref, handleRef, isDragging } = useSortable({ id, index });

  const coverUrl = ipImageUrl(episode.videoBanner);
  const hasCover = !!coverUrl;
  const hasVideo = !!episode.videoLink;
  const subtitle = (() => {
    if (!hasVideo) return t("epVideoMissing");
    const desc = episode.description?.trim();
    return desc || t("epVideoLinked");
  })();

  return (
    <div
      ref={ref}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border/70 bg-card transition-colors hover:border-primary/30",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      {/* Top strip — drag, EP marker, edit/delete */}
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
        </div>

        <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-xs" onClick={onClick}>
            <IconPencil className="size-3.5" />
          </Button>
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
        {/* Thumbnail — videoBanner cover + play affordance + duration badge.
         *  Live preview would need /vedio/play/getLink per row (the wire
         *  videoLink isn't directly playable), so the list stays cheap and
         *  playback is deferred to the edit dialog / fullscreen viewer. */}
        <div className="relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/50">
          {hasCover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <IconPlaylist className="size-6 text-muted-foreground/30" />
          )}

          {hasVideo && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/15">
              <span className="flex size-6 items-center justify-center rounded-full bg-black/55 text-white/90 shadow-sm backdrop-blur-sm transition-transform group-hover:scale-110">
                <IconPlayerPlayFilled className="size-3 translate-x-px" />
              </span>
            </span>
          )}

          {episode.duration > 0 && (
            <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/65 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white/95">
              {formatDuration(episode.duration)}
            </span>
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
