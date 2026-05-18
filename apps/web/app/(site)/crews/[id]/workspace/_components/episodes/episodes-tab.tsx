"use client";

import { useMemo, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { useCrewEpisodes } from "@/app/(site)/crews/_hooks/use-episodes";
import { useUserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { EpisodesGrid } from "./episodes-grid";
import { AddEpisodeDialog } from "./add-episode-dialog";

interface EpisodesTabProps {
  crewId: string;
}

/**
 * Crew workspace Episodes tab — card-grid surface with a side-sheet
 * detail drawer. First non-approved episode is highlighted as
 * "current" so the admin's eye lands there. Outsiders see a hint and
 * nothing else.
 */
export function EpisodesTab({ crewId }: EpisodesTabProps) {
  const t = useTranslations("workspace");
  const viewer = useUserCrewRole(crewId);
  const { data: episodes = [], isLoading } = useCrewEpisodes(crewId);

  const currentId = useMemo(() => {
    const next = episodes.find((e) => e.status !== "approved");
    return next?.id ?? null;
  }, [episodes]);

  const [addOpen, setAddOpen] = useState(false);

  const nextNumber = episodes.length === 0 ? 1 : Math.max(...episodes.map((e) => e.number)) + 1;

  if (viewer.role === "outsider") {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {t("episodesOutsiderHint")}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <IconLoader2 className="size-4 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <EpisodesGrid
        crewId={crewId}
        episodes={episodes}
        currentId={currentId}
        isAdmin={viewer.isAdmin}
        viewer={viewer}
        onAddEpisode={() => setAddOpen(true)}
      />
      <AddEpisodeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        crewId={crewId}
        nextNumber={nextNumber}
      />
    </>
  );
}
