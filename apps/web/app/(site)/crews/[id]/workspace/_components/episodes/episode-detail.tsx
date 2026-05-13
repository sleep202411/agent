"use client";

import { useState } from "react";
import { useEpisodeAssignments, type Episode } from "@/app/(site)/crews/_hooks/use-episodes";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { EpisodeBrief } from "./episode-brief";
import { ApprovalFlow } from "./approval-flow";
import { AssignmentTable } from "./assignment-table";
import { ActivityLog } from "./activity-log";
import { AssignMemberDialog } from "./assign-member-dialog";

interface EpisodeDetailProps {
  crewId: string;
  episode: Episode;
  viewer: UserCrewRole;
}

/**
 * Composed expanded panel: brief stats → approval flow → assignment
 * table → activity log. AssignmentTable owns its own assign / reject
 * dialogs internally; EpisodeBrief delegates "Configure Members" to
 * the same assign dialog (so the header CTA does the same thing as
 * the "+" inside the table).
 */
export function EpisodeDetail({ crewId, episode, viewer }: EpisodeDetailProps) {
  const { data: assignments = [] } = useEpisodeAssignments(crewId, episode.id);
  const [configureOpen, setConfigureOpen] = useState(false);

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <EpisodeBrief
        crewId={crewId}
        episode={episode}
        assignments={assignments}
        viewer={viewer}
        onConfigureMembers={() => setConfigureOpen(true)}
      />
      <ApprovalFlow episode={episode} assignments={assignments} />
      <AssignmentTable
        crewId={crewId}
        episodeId={episode.id}
        episodeNumber={episode.number}
        viewer={viewer}
      />
      <ActivityLog crewId={crewId} episodeId={episode.id} />

      <AssignMemberDialog
        open={configureOpen}
        onOpenChange={setConfigureOpen}
        crewId={crewId}
        episodeId={episode.id}
        episodeNumber={episode.number}
        existingAssignments={assignments}
      />
    </div>
  );
}
