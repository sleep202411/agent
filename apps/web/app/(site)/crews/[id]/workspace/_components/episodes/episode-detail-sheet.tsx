"use client";

/**
 * Side-sheet wrapping the per-episode admin/member surface. Mirrors
 * `PositionDetailSheet` so the two tabs feel symmetric. Sheet stays
 * mounted while `episode` is null so the close animation can play
 * without ripping the inner state out mid-frame.
 */

import { useState } from "react";
import { IconHash } from "@tabler/icons-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTranslations } from "@/src/i18n/i18n";
import { useEpisodeAssignments, type Episode } from "@/app/(site)/crews/_hooks/use-episodes";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { EpisodeBrief } from "./episode-brief";
import { AssignmentTable } from "./assignment-table";
import { ActivityLog } from "./activity-log";
import { AssignMemberDialog } from "./assign-member-dialog";
import { EpisodeStatusBadge } from "./episode-status-badge";

interface EpisodeDetailSheetProps {
  crewId: string;
  episode: Episode | null;
  viewer: UserCrewRole;
  onOpenChange: (open: boolean) => void;
}

export function EpisodeDetailSheet({
  crewId,
  episode,
  viewer,
  onOpenChange,
}: EpisodeDetailSheetProps) {
  const t = useTranslations("workspace");
  // Hooks must run unconditionally → call useEpisodeAssignments with a
  // stable empty string when no episode is selected; React Query
  // automatically disables on the empty key.
  const { data: assignments = [] } = useEpisodeAssignments(crewId, episode?.id ?? "");
  const [configureOpen, setConfigureOpen] = useState(false);

  if (!episode) {
    return <Sheet open={false} onOpenChange={onOpenChange} />;
  }

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-xl">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <IconHash className="size-4" />
              <span className="text-sm font-semibold tabular-nums">
                {episode.number.toString().padStart(2, "0")}
              </span>
            </span>
            <span className="truncate">
              {episode.title || t("episodeLabel", { number: episode.number })}
            </span>
            <EpisodeStatusBadge status={episode.status} />
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-1 pb-6">
          <EpisodeBrief
            crewId={crewId}
            episode={episode}
            assignments={assignments}
            viewer={viewer}
            onConfigureMembers={() => setConfigureOpen(true)}
          />
          <AssignmentTable
            crewId={crewId}
            episodeId={episode.id}
            episodeNumber={episode.number}
            viewer={viewer}
          />
          <ActivityLog crewId={crewId} episodeId={episode.id} />
        </div>

        <AssignMemberDialog
          open={configureOpen}
          onOpenChange={setConfigureOpen}
          crewId={crewId}
          episodeId={episode.id}
          episodeNumber={episode.number}
          existingAssignments={assignments}
        />
      </SheetContent>
    </Sheet>
  );
}
