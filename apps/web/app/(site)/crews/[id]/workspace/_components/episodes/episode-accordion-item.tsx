"use client";

/**
 * One row of the episodes production-board accordion.
 *
 * Collapsed header carries all the at-a-glance signal (number,
 * title, status, avatar stack, approval progress, deadline) so
 * admins can scan the board without expanding anything. Expanding
 * reveals the full per-episode work surface — brief + assignment
 * table + activity log + the assign-member dialog wiring.
 *
 * Multiple items can be expanded simultaneously by design — admins
 * coordinating across two adjacent episodes is the common flow,
 * and an accordion that auto-collapses peers fights that.
 *
 * Permissions: this component renders the same surface for every
 * non-outsider viewer; per-action gates (assign, approve, set
 * revenue, submit own work) live inside the child components and
 * read from `viewer` — plus the episode freeze, which this component
 * owns (`isApproved`) and forwards as `frozen`: an approved episode
 * is closed for edits no matter who is looking at it.
 */

import { useMemo, useState } from "react";
import { IconCalendar, IconCheck, IconChevronDown, IconUsers } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  useEpisodeAssignments,
  type Episode,
  type EpisodeAssignment,
} from "@/app/(site)/crews/_hooks/use-episodes";
import { useCrewMembers, type CrewMemberDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import type { LookupUserDTO } from "@repo/shared/users";
import type { UserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { EpisodeStatusBadge } from "./episode-status-badge";
import { EpisodeBrief } from "./episode-brief";
import { AssignmentTable } from "./assignment-table";
import { ActivityLog } from "./activity-log";
import { AssignMemberDialog } from "./assign-member-dialog";

interface EpisodeAccordionItemProps {
  crewId: string;
  episode: Episode;
  isCurrent: boolean;
  expanded: boolean;
  onToggle: () => void;
  viewer: UserCrewRole;
}

export function EpisodeAccordionItem({
  crewId,
  episode,
  isCurrent,
  expanded,
  onToggle,
  viewer,
}: EpisodeAccordionItemProps) {
  const t = useTranslations("workspace");
  // Keep the stable episode query key while disabling its network work
  // for collapsed rows. Once a row has been opened, React Query keeps
  // the resolved summary available if it is collapsed again.
  const assignmentsQuery = useEpisodeAssignments(crewId, episode.id, { enabled: expanded });
  const assignments = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data]);
  const { data: members = [] } = useCrewMembers(crewId);
  const [configureOpen, setConfigureOpen] = useState(false);

  const membersById = useMemo(() => {
    const map = new Map<string, CrewMemberDTO>();
    for (const m of members) map.set(m.userId, m);
    return map;
  }, [members]);

  // Resolve assignee display names for the avatar-stack tooltips. Same
  // sorted-key cache as the assignment table inside the expanded body,
  // so this is effectively free after the first request.
  const assigneeIds = useMemo(() => assignments.map((a) => a.userId), [assignments]);
  const displays = useUserDisplays(assigneeIds);

  const total = assignments.length;
  const approved = assignments.filter((a) => a.status === "approved").length;
  const pendingReview = assignments.filter((a) => a.status === "submitted").length;
  const inProgress = assignments.filter(
    (a) => a.status === "in_progress" || a.status === "rejected"
  ).length;
  const progressPct = total > 0 ? Math.min(100, (approved / total) * 100) : 0;
  const isApproved = episode.status === "approved";
  const daysLeft = daysUntilDeadline(episode.deadline);

  const stackEntries = assignments.slice(0, 5);
  const overflow = Math.max(0, assignments.length - stackEntries.length);

  const numberBadgeColors = isApproved
    ? "bg-green-400/15 text-green-400"
    : episode.status === "in_production"
      ? "bg-blue-400/15 text-blue-400"
      : "bg-secondary text-muted-foreground";

  return (
    <div
      className={cn(
        // Borderless surface per DESIGN.md. Current episode lifts via a
        // single-pixel primary ring rather than a full border so the
        // visual weight matches non-current rows.
        "overflow-hidden rounded-xl bg-card transition-all",
        isCurrent && !isApproved && "ring-1 ring-primary/40",
        expanded && "shadow-sm"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-card/70"
      >
        {/* Episode number badge */}
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-black tabular-nums",
            numberBadgeColors
          )}
        >
          {episode.number.toString().padStart(2, "0")}
        </div>

        {/* Title + status block */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="line-clamp-1 text-sm font-semibold text-foreground">
              {episode.title || t("episodeLabel", { number: episode.number })}
            </h3>
            <EpisodeStatusBadge status={episode.status} />
            {isCurrent && !isApproved ? (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {t("currentEpisode")}
              </span>
            ) : null}
          </div>
          {episode.description ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {episode.description}
            </p>
          ) : null}
        </div>

        {/* Right-side: avatars + progress + deadline + chevron */}
        <div className="hidden shrink-0 items-center gap-4 md:flex">
          {/* Avatars */}
          {assignmentsQuery.isSuccess ? (
            stackEntries.length > 0 ? (
              <AvatarStack
                entries={stackEntries}
                membersById={membersById}
                displays={displays}
                overflow={overflow}
              />
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <IconUsers className="size-3.5" />
                {t("rowNoAssignments")}
              </span>
            )
          ) : null}

          {/* Progress */}
          {total > 0 ? (
            <div className="flex w-32 flex-col gap-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <IconCheck className="size-3" />
                  {approved}/{total}
                </span>
                {pendingReview > 0 ? (
                  <span className="text-blue-400">
                    {pendingReview} {t("pendingReviewBadge")}
                  </span>
                ) : inProgress > 0 ? (
                  <span className="text-amber-400">
                    {inProgress} {t("inProgressBadge")}
                  </span>
                ) : null}
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    isApproved
                      ? "bg-green-400"
                      : approved === total
                        ? "bg-blue-400"
                        : "bg-amber-400"
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          ) : null}

          {/* Deadline */}
          {daysLeft != null ? (
            <span
              className={cn(
                "inline-flex w-20 items-center justify-end gap-1 text-[11px]",
                !isApproved && daysLeft < 0 && "text-rose-400",
                !isApproved && daysLeft >= 0 && daysLeft <= 3 && "text-amber-400",
                (isApproved || daysLeft > 3) && "text-muted-foreground"
              )}
            >
              <IconCalendar className="size-3" />
              {isApproved
                ? formatShortDate(episode.deadline)
                : daysLeft < 0
                  ? t("episodeDeadlinePast")
                  : daysLeft === 0
                    ? t("episodeDeadlineToday")
                    : t("episodeDeadlineInDays", { count: daysLeft })}
            </span>
          ) : null}
        </div>

        {/* Mobile-only compact meta — collapses to chevron + avatar+progress
            visibility lost on small screens (admins on phones are the
            edge case; expand reveals everything anyway) */}
        <IconChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>

      {/* Expanded body — only mounted when expanded so collapsed rows
          don't pay the cost of EpisodeBrief / AssignmentTable /
          ActivityLog renders. Each of those already invalidates its
          own React Query data on mount. */}
      {expanded ? (
        <div className="space-y-4 border-t border-border/40 px-4 pb-4 pt-4">
          {assignmentsQuery.isSuccess ? (
            <EpisodeBrief
              crewId={crewId}
              episode={episode}
              assignments={assignments}
              viewer={viewer}
              onConfigureMembers={() => setConfigureOpen(true)}
            />
          ) : null}
          <AssignmentTable
            crewId={crewId}
            episodeId={episode.id}
            episodeNumber={episode.number}
            viewer={viewer}
            frozen={isApproved}
          />
          <ActivityLog crewId={crewId} episodeId={episode.id} />

          {assignmentsQuery.isSuccess ? (
            <AssignMemberDialog
              open={configureOpen}
              onOpenChange={setConfigureOpen}
              crewId={crewId}
              episodeId={episode.id}
              episodeNumber={episode.number}
              existingAssignments={assignments}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────

function AvatarStack({
  entries,
  membersById,
  displays,
  overflow,
}: {
  entries: EpisodeAssignment[];
  membersById: Map<string, CrewMemberDTO>;
  displays: Map<string, LookupUserDTO>;
  overflow: number;
}) {
  return (
    <div className="flex -space-x-1.5">
      {entries.map((a) => {
        const memberRoleType = membersById.get(a.userId)?.roleType;
        const name = displayNameOf(a.userId, displays);
        const role = a.roleName || memberRoleType || "";
        const tooltip = role ? `${name} · ${role}` : name;
        // Prefer the real nickname's first character; fall back to last
        // two digits of the userId (numeric Java ids).
        const lookup = displays.get(a.userId);
        const initial = lookup?.nickname
          ? lookup.nickname.trim().charAt(0).toUpperCase()
          : (a.userId.match(/\d+$/)?.[0] ?? a.userId).slice(-2);
        return (
          <div
            key={a.id}
            title={tooltip}
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

function formatShortDate(iso: string | null): string {
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
