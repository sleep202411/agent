import { IconDeviceTv } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import type { Episode } from "@/src/store/slices/projectSlice";
import { EpisodeCard } from "./episode-card";

interface EpisodeListProps {
  episodes: Episode[];
  activeEpisodeId: string | null;
  onSelect: (episodeId: string) => void;
  onEdit: (episode: Episode) => void;
  onDelete: (episode: Episode) => void;
}

export function EpisodeList({
  episodes,
  activeEpisodeId,
  onSelect,
  onEdit,
  onDelete,
}: EpisodeListProps) {
  const t = useTranslations("episode");

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
    <div className="space-y-4">
      {episodes.map((episode, index) => {
        const episodeId = String(episode.id ?? "");
        return (
          <EpisodeCard
            key={episodeId || index}
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
  );
}
