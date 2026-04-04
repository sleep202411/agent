"use client";

import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Episode } from "@/src/store/slices/projectSlice";

interface EpisodeCardProps {
  episode: Episode;
  index: number;
  active: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  showDelete: boolean;
}

export function EpisodeCard({
  episode,
  index,
  active,
  onSelect,
  onEdit,
  onDelete,
  showDelete,
}: EpisodeCardProps) {
  const t = useTranslations("episode");

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 transition-colors",
        active
          ? "border-primary/40 bg-primary/5"
          : "border-border/70 bg-card hover:border-primary/20"
      )}
    >
      <div className="flex items-center justify-between gap-3 cursor-pointer" onClick={onSelect}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {episode.title?.trim() || t("episodeNumber", { index: index + 1 })}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {episode.introduction ? String(episode.introduction) : t("noIntroduction")}
          </div>
        </div>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" color="muted" size="icon-xs" onClick={onEdit}>
            <IconPencil className="size-3.5" />
          </Button>
          {showDelete ? (
            <Button variant="ghost" color="muted" size="icon-xs" onClick={onDelete}>
              <IconTrash className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
