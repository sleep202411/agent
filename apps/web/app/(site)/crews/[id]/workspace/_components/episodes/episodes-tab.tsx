"use client";

import { useMemo, useState } from "react";
import { IconLoader2, IconPlus } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { useCrewEpisodes } from "@/app/(site)/crews/_hooks/use-episodes";
import { useUserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { EpisodeRow } from "./episode-row";
import { AddEpisodeDialog } from "./add-episode-dialog";

interface EpisodesTabProps {
  crewId: string;
}

/**
 * Crew workspace Episodes tab — the on-screen analog of the
 * traditional production board ("通告板"). Lists every episode the
 * crew owns; click to expand the full per-episode panel (brief,
 * approval flow, assignments, activity log).
 *
 * The first non-approved episode is highlighted as "current" so the
 * admin's eye lands there.
 */
export function EpisodesTab({ crewId }: EpisodesTabProps) {
  const t = useTranslations("workspace");
  const viewer = useUserCrewRole(crewId);
  const { data: episodes = [], isLoading } = useCrewEpisodes(crewId);

  // First non-approved episode = current. Episodes already come back
  // ordered by `number` ascending from the data layer.
  const currentId = useMemo(() => {
    const next = episodes.find((e) => e.status !== "approved");
    return next?.id ?? null;
  }, [episodes]);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Open the current episode by default once data lands.
  const effectiveExpanded = expandedId ?? currentId;

  const nextNumber = episodes.length === 0 ? 1 : Math.max(...episodes.map((e) => e.number)) + 1;

  if (viewer.role === "outsider") {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {t("episodesOutsiderHint")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-foreground">{t("episodesHeading")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("episodesSubheading", { count: episodes.length })}
          </p>
        </div>
        {viewer.isAdmin ? (
          <Button variant="soft" color="primary" size="sm" onClick={() => setAddOpen(true)}>
            <IconPlus className="size-3.5" /> {t("addEpisode")}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin" />
        </div>
      ) : episodes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          {t("noEpisodesYet")}
        </div>
      ) : (
        <div className="space-y-3">
          {episodes.map((ep) => (
            <EpisodeRow
              key={ep.id}
              crewId={crewId}
              episode={ep}
              isCurrent={ep.id === currentId}
              expanded={effectiveExpanded === ep.id}
              onToggle={() => setExpandedId((prev) => (prev === ep.id ? null : ep.id))}
              viewer={viewer}
            />
          ))}
        </div>
      )}

      <AddEpisodeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        crewId={crewId}
        nextNumber={nextNumber}
      />
    </div>
  );
}
