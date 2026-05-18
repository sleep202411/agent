"use client";

/**
 * One episode rendered as a compact card. Click anywhere to open the
 * detail sheet. Owner / member / finance all share the same card
 * surface — gating happens inside the sheet, not on the card.
 *
 * Mirrors the positions/members card pattern: borderless surface
 * (per DESIGN.md "Cards without borders"), hover lift, single-axis
 * structural hairline only between body and footer.
 */

import { useMemo } from "react";
import { IconCalendar, IconCheck, IconUsers } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { env } from "@/src/env";
import {
  useEpisodeAssignments,
  type Episode,
  type EpisodeAssignment,
} from "@/app/(site)/crews/_hooks/use-episodes";
import { useCrewMembers, type CrewMemberDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { EpisodeStatusBadge } from "./episode-status-badge";

interface EpisodeCardProps {
  crewId: string;
  episode: Episode;
  /** Highlighted "current" episode = first non-approved. */
  isCurrent: boolean;
  onClick: () => void;
}

export function EpisodeCard({ crewId, episode, isCurrent, onClick }: EpisodeCardProps) {
  const t = useTranslations("workspace");
  const { data: assignments = [] } = useEpisodeAssignments(crewId, episode.id);
  const { data: members = [] } = useCrewMembers(crewId);

  const membersById = useMemo(() => {
    const map = new Map<string, CrewMemberDTO>();
    for (const m of members) map.set(m.userId, m);
    return map;
  }, [members]);

  const total = assignments.length;
  const approved = assignments.filter((a) => a.status === "approved").length;
  const pendingReview = assignments.filter((a) => a.status === "submitted").length;
  const inProgress = assignments.filter(
    (a) => a.status === "in_progress" || a.status === "rejected"
  ).length;
  const progressPct = total > 0 ? Math.min(100, (approved / total) * 100) : 0;
  const isApproved = episode.status === "approved";

  const daysLeft = daysUntilDeadline(episode.deadline);

  // Stack of unique-user avatars (limit visual to 5; "+N" overflow).
  const stackEntries = assignments.slice(0, 5);
  const overflow = Math.max(0, assignments.length - stackEntries.length);

  const numberBadgeColors =
    episode.status === "approved"
      ? "bg-green-400/15 text-green-400"
      : episode.status === "in_production"
        ? "bg-blue-400/15 text-blue-400"
        : "bg-secondary text-muted-foreground";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl bg-card p-4 text-left transition-all",
        "hover:bg-card/70 hover:shadow-md",
        isCurrent && "ring-1 ring-primary/40"
      )}
    >
      {/* Top row: number badge + title + status pill */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-black tabular-nums",
            numberBadgeColors
          )}
        >
          {episode.number.toString().padStart(2, "0")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="line-clamp-1 text-base font-semibold text-foreground">
              {episode.title || t("episodeLabel", { number: episode.number })}
            </h3>
            {isCurrent && !isApproved ? (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {t("currentEpisode")}
              </span>
            ) : null}
          </div>
          <div className="mt-1">
            <EpisodeStatusBadge status={episode.status} />
          </div>
        </div>
      </div>

      {/* Description preview if any */}
      {episode.description ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">{episode.description}</p>
      ) : null}

      {/* Member avatar stack */}
      <div className="flex items-center gap-2">
        {stackEntries.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <IconUsers className="size-3.5" />
            {t("rowNoAssignments")}
          </span>
        ) : (
          <>
            <AvatarStack entries={stackEntries} membersById={membersById} overflow={overflow} />
            <span className="text-xs text-muted-foreground">
              {t("assignmentsCount", { count: assignments.length })}
            </span>
          </>
        )}
      </div>

      {/* Progress */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <IconCheck className="size-3" />
            {approved}/{total} {t("approvedCount")}
          </span>
          {pendingReview > 0 ? (
            <span className="font-semibold text-blue-400">
              {t("pendingReviewCount", { count: pendingReview })}
            </span>
          ) : inProgress > 0 ? (
            <span className="text-amber-400">{t("inProgressCount", { count: inProgress })}</span>
          ) : null}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              isApproved
                ? "bg-green-400"
                : approved === total && total > 0
                  ? "bg-blue-400"
                  : "bg-amber-400"
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Footer: deadline + last updated */}
      <div className="mt-auto flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
        <span>{t("updatedRelative", { time: shortRelative(episode.updatedAt, t) })}</span>
        {daysLeft != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              !isApproved && daysLeft < 0 && "text-rose-400",
              !isApproved && daysLeft >= 0 && daysLeft <= 3 && "text-amber-400"
            )}
          >
            <IconCalendar className="size-3" />
            {isApproved
              ? formatDeadlineDate(episode.deadline)
              : daysLeft < 0
                ? t("episodeDeadlinePast")
                : daysLeft === 0
                  ? t("episodeDeadlineToday")
                  : t("episodeDeadlineInDays", { count: daysLeft })}
          </span>
        ) : null}
      </div>
    </button>
  );
}

// ─── Helpers ─────────────────────────────────────

function AvatarStack({
  entries,
  membersById,
  overflow,
}: {
  entries: EpisodeAssignment[];
  membersById: Map<string, CrewMemberDTO>;
  overflow: number;
}) {
  return (
    <div className="flex -space-x-1.5">
      {entries.map((a) => {
        const memberRoleType = membersById.get(a.userId)?.roleType;
        const initial = (a.userId.match(/\d+$/)?.[0] ?? a.userId).slice(-2);
        return (
          <div
            key={a.id}
            title={a.roleName || memberRoleType || `User ${a.userId}`}
            className="flex size-6 items-center justify-center rounded-full border-2 border-card bg-primary/15 text-[10px] font-semibold tabular-nums text-primary"
          >
            {initial}
          </div>
        );
      })}
      {overflow > 0 ? (
        <div className="flex size-6 items-center justify-center rounded-full border-2 border-card bg-secondary text-[10px] font-semibold text-muted-foreground">
          +{overflow}
        </div>
      ) : null}
    </div>
  );
}

function daysUntilDeadline(iso: string | null): number | null {
  if (!iso) return null;
  const ts = new Date(`${iso}T00:00:00Z`).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.ceil((ts - Date.now()) / 86_400_000);
}

function formatDeadlineDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function shortRelative(
  iso: string,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  const diff = Date.now() - ts;
  if (diff < 60_000) return t("justNow");
  if (diff < 3_600_000) return t("minutesAgo", { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("hoursAgo", { count: Math.floor(diff / 3_600_000) });
  return t("daysAgo", { count: Math.floor(diff / 86_400_000) });
}

// Silence env unused — it's preserved for future avatar URL resolution
// when we move from "User XXXX" placeholders to real avatars.
void env;
