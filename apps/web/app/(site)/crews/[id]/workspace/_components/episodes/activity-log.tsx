"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  useEpisodeActivity,
  type EpisodeActivity,
  type EpisodeActivityType,
} from "@/app/(site)/crews/_hooks/use-episodes";

interface ActivityLogProps {
  crewId: string;
  episodeId: string;
}

/**
 * Append-only event timeline per episode — created / assigned /
 * submitted / approved / rejected / revenue-set / episode-approved.
 * Renders newest first; each row is a one-liner with timestamp.
 */
export function ActivityLog({ crewId, episodeId }: ActivityLogProps) {
  const t = useTranslations("workspace");
  const { data: items = [], isLoading } = useEpisodeActivity(crewId, episodeId);

  return (
    <div className="rounded-xl bg-secondary/30 p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("episodeActivity")}
      </h4>
      {isLoading ? (
        <div className="flex h-20 items-center justify-center text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
          {t("noActivity")}
        </div>
      ) : (
        <ol className="space-y-0">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-2.5 border-b border-border/40 py-2 last:border-0"
            >
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
              <div className="flex-1">
                <div className="text-sm text-foreground/85">{renderActivity(a, t)}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatTime(a.createdAt)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function renderActivity(a: EpisodeActivity, t: ReturnType<typeof useTranslations>): string {
  const actor = a.actorName;
  const role = String(a.payload.roleName ?? "");
  const target = String(a.payload.targetName ?? a.payload.targetUserId ?? "");
  const reason = String(a.payload.reason ?? "");
  const amount = a.payload.amount;
  const currency = String(a.payload.currency ?? "CNY");

  const map: Record<EpisodeActivityType, () => string> = {
    episode_created: () => t("logEpisodeCreated", { actor }),
    member_assigned: () => t("logMemberAssigned", { actor, target, role: role || "—" }),
    member_unassigned: () => t("logMemberUnassigned", { actor, target }),
    submission_made: () => t("logSubmissionMade", { actor, role: role || "—" }),
    submission_approved: () => t("logSubmissionApproved", { actor, target, role: role || "—" }),
    submission_rejected: () =>
      t("logSubmissionRejected", {
        actor,
        target,
        role: role || "—",
        reason: reason || "—",
      }),
    revenue_set: () =>
      t("logRevenueSet", {
        actor,
        target,
        amount: typeof amount === "number" ? String(amount) : "0",
        currency,
      }),
    episode_approved: () => t("logEpisodeApproved", { actor }),
  };
  // `a.type` is widened to `string` on the wire for forward-compat —
  // new activity types can land without the client crashing. Guard
  // the lookup so unknown types render as empty rather than throwing.
  return (map as Record<string, (() => string) | undefined>)[a.type]?.() ?? "";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 16);
}
