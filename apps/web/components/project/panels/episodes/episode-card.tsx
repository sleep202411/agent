import { IconGripVertical, IconPencil, IconTrash } from "@tabler/icons-react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Episode } from "@/src/store/slices/projectSlice";

interface EpisodeCardProps {
  id: string;
  episode: Episode;
  index: number;
  active: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  showDelete: boolean;
}

export function SortableEpisodeCard({
  id,
  episode,
  index,
  active,
  onSelect,
  onEdit,
  onDelete,
  showDelete,
}: EpisodeCardProps) {
  const t = useTranslations("episode");
  const { ref, handleRef, isDragging } = useSortable({ id, index });

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border px-3 py-2.5 transition-colors",
        active
          ? "border-primary/40 bg-primary/5"
          : "border-border/70 bg-card hover:border-primary/20",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <div className="flex items-center gap-2">
        {/* Drag handle + index */}
        <div
          ref={handleRef}
          className="flex shrink-0 cursor-grab touch-none items-center gap-1.5 rounded-md py-2 text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing"
        >
          <IconGripVertical className="size-3.5" />
          <span className="min-w-5 text-center text-xs font-semibold tabular-nums text-muted-foreground">
            {index + 1}
          </span>
        </div>

        {/* Content — clickable to select */}
        <div className="min-w-0 flex-1 cursor-pointer" onClick={onSelect}>
          <div className="truncate text-sm font-medium">
            {episode.title?.trim() || t("untitledEpisode")}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {episode.introduction ? String(episode.introduction) : t("noIntroduction")}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
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
