"use client";

import { IconCheck, IconLoader2, IconUsers } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useApproveEpisode,
  type Episode,
  type EpisodeAssignment,
} from "@/app/(site)/crews/_hooks/use-episodes";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";

interface EpisodeBriefProps {
  crewId: string;
  episode: Episode;
  assignments: EpisodeAssignment[];
  viewer: UserCrewRole;
  onConfigureMembers: () => void;
}

/**
 * Top stat strip of the expanded episode panel — six counters mirroring
 * the PRD layout, plus the two admin actions (configure members,
 * approve episode). The "submit to client" PRD button is dropped per
 * the internal-only product framing.
 */
export function EpisodeBrief({
  crewId,
  episode,
  assignments,
  viewer,
  onConfigureMembers,
}: EpisodeBriefProps) {
  const t = useTranslations("workspace");
  const approveEp = useApproveEpisode(crewId);

  const total = assignments.length;
  const approved = assignments.filter((a) => a.status === "approved").length;
  const pending = assignments.filter(
    (a) => a.status === "in_progress" || a.status === "submitted" || a.status === "rejected"
  ).length;

  const canApproveEp =
    viewer.isAdmin && episode.status !== "approved" && total > 0 && approved === total;

  const handleApproveEp = () => {
    approveEp.mutate(episode.id, {
      onSuccess: () => toast.success(t("episodeApproved", { number: episode.number })),
      onError: (err) => toast.error(err instanceof Error ? err.message : t("episodeApproveFailed")),
    });
  };

  return (
    <div className="rounded-xl bg-secondary/30 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("episodeBrief")}
        </h4>
        {viewer.isAdmin ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" color="muted" size="xs" onClick={onConfigureMembers}>
              <IconUsers className="size-3" /> {t("configureMembers")}
            </Button>
            <Button
              variant="solid"
              color="success"
              size="xs"
              disabled={!canApproveEp || approveEp.isPending}
              onClick={handleApproveEp}
            >
              {approveEp.isPending ? (
                <IconLoader2 className="size-3 animate-spin" />
              ) : (
                <IconCheck className="size-3" />
              )}
              {t("approveEpisode")}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t("briefMembers")} value={total} />
        <Stat label={t("briefApproved")} value={approved} tone="success" />
        <Stat label={t("briefPending")} value={pending} tone={pending > 0 ? "warning" : "muted"} />
        <Stat
          label={t("briefStatus")}
          value={t(EP_STATUS_LABEL[episode.status])}
          tone={EP_STATUS_TONE[episode.status]}
        />
        <Stat label={t("briefDeadline")} value={episode.deadline || "—"} />
        <Stat label={t("briefLastUpdated")} value={formatRelative(episode.updatedAt, t)} />
      </div>
    </div>
  );
}

// ─── Small atoms ───────────────────────────────────────

type Tone = "muted" | "success" | "warning" | "info";

const EP_STATUS_LABEL: Record<Episode["status"], string> = {
  not_started: "epStatusNotStarted",
  in_production: "epStatusInProduction",
  approved: "epStatusApproved",
};
const EP_STATUS_TONE: Record<Episode["status"], Tone> = {
  not_started: "muted",
  in_production: "info",
  approved: "success",
};

function Stat({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string | number;
  tone?: Tone;
}) {
  const cls = cn(
    "text-sm font-bold",
    tone === "success" && "text-green-400",
    tone === "warning" && "text-amber-400",
    tone === "info" && "text-blue-400",
    tone === "muted" && "text-foreground"
  );
  return (
    <div>
      <div className="mb-0.5 text-xs text-muted-foreground">{label}</div>
      <div className={cls}>{value}</div>
    </div>
  );
}

function formatRelative(ts: number, t: ReturnType<typeof useTranslations>): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return t("justNow");
  if (diff < hr) return t("minutesAgo", { count: Math.floor(diff / min) });
  if (diff < day) return t("hoursAgo", { count: Math.floor(diff / hr) });
  if (diff < 30 * day) return t("daysAgo", { count: Math.floor(diff / day) });
  return new Date(ts).toISOString().slice(0, 10);
}
