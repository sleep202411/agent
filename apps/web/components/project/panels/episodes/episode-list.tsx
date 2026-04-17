"use client";

import { useCallback, useRef } from "react";
import { IconDeviceTv } from "@tabler/icons-react";
import { DragDropProvider } from "@dnd-kit/react";
import { useTranslations } from "@/src/i18n/i18n";
import type { Episode } from "@/src/store/slices/projectSlice";
import { SortableEpisodeCard } from "./episode-card";

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const result = [...arr];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

interface EpisodeListProps {
  episodes: Episode[];
  activeEpisodeId: string | null;
  onSelect: (episodeId: string) => void;
  onEdit: (episode: Episode) => void;
  onDelete: (episode: Episode) => void;
  onReorder: (reordered: Episode[]) => void;
}

export function EpisodeList({
  episodes,
  activeEpisodeId,
  onSelect,
  onEdit,
  onDelete,
  onReorder,
}: EpisodeListProps) {
  const t = useTranslations("episode");
  const pendingReorderRef = useRef<Episode[] | null>(null);

  const handleDragOver = useCallback(
    (event: unknown) => {
      const op = (
        event as {
          operation?: { source?: { id: string | number }; target?: { id: string | number } };
        }
      ).operation;
      const source = op?.source;
      const target = op?.target;
      if (!source || !target || source.id === target.id) return;

      const currentList = pendingReorderRef.current ?? episodes;
      const fromIndex = currentList.findIndex((ep) => String(ep.id) === String(source.id));
      const toIndex = currentList.findIndex((ep) => String(ep.id) === String(target.id));
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

      pendingReorderRef.current = arrayMove(currentList, fromIndex, toIndex);
    },
    [episodes]
  );

  const handleDragEnd = useCallback(() => {
    if (pendingReorderRef.current) {
      onReorder(pendingReorderRef.current);
      pendingReorderRef.current = null;
    }
  }, [onReorder]);

  if (episodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-4 py-12 text-center">
        <IconDeviceTv className="size-8 text-muted-foreground/30" />
        <p className="mt-3 text-sm font-medium">{t("noEpisodes")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("noEpisodesHint")}</p>
      </div>
    );
  }

  return (
    <DragDropProvider onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="space-y-2">
        {episodes.map((episode, index) => {
          const episodeId = String(episode.id ?? "");
          return (
            <SortableEpisodeCard
              key={episodeId || index}
              id={episodeId}
              episode={episode}
              index={index}
              active={episodeId === String(activeEpisodeId)}
              onSelect={() => onSelect(episodeId)}
              onEdit={() => onEdit(episode)}
              onDelete={() => onDelete(episode)}
              showDelete={episodes.length > 1}
            />
          );
        })}
      </div>
    </DragDropProvider>
  );
}
