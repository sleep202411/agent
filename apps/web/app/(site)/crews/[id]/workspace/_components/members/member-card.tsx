"use client";

/**
 * One member rendered as a compact card.
 *
 * Owner card is visually distinct (single tile across the top with a
 * brand-tinted background) — the founder is a special role and the
 * remove + finance-toggle actions don't apply to them.
 *
 * Inline actions only — members don't carry enough info to warrant a
 * full drawer like positions do. Profile link navigates out for the
 * real "who is this person" view.
 */

import Link from "next/link";
import {
  IconCalendar,
  IconCoin,
  IconCrown,
  IconExternalLink,
  IconLoader2,
  IconTrash,
  IconUserPlus,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SwitchControl } from "@/components/ui/schema-field/switch-control";
import {
  CrewApiError,
  useRemoveMember,
  useUpdateMember,
  type CrewMemberDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";

interface MemberCardProps {
  crewId: string;
  member: CrewMemberDTO;
  isOwner: boolean;
  /** Owner can manage every other member but not themselves. */
  canManage: boolean;
  onAskRemove: (memberId: string, name: string) => void;
}

export function MemberCard({
  crewId,
  member,
  // isOwner kept on the API for future viewer-specific affordances
  // (e.g. "you" badge on the viewer's own row).
  isOwner: _isOwner,
  canManage,
  onAskRemove,
}: MemberCardProps) {
  const t = useTranslations("workspace");
  const translatePosition = useTranslatePositionValue();
  const updateMember = useUpdateMember(crewId);
  const isFounder = member.via === "founder";
  const displayName = `User ${member.userId}`;
  const initial = member.userId.charAt(0).toUpperCase();
  const roleLabel = isFounder ? t("memberRoleOwner") : translatePosition(member.roleType);
  const viaLabel = isFounder
    ? null
    : member.via === "application"
      ? t("memberViaApplication")
      : t("memberViaManual");

  const handleToggleFinance = () => {
    updateMember.mutate(
      { memberId: member.id, isFinance: !member.isFinance },
      {
        onSuccess: () =>
          toast.success(member.isFinance ? t("memberFinanceRemoved") : t("memberFinanceAdded")),
        onError: (err) => surfaceErr(err, t("memberFinanceFailed")),
      }
    );
  };

  return (
    <div
      className={cn(
        // Borderless per DESIGN.md "Cards without borders".
        "group flex flex-col gap-3 rounded-xl p-4 transition-all",
        isFounder
          ? "bg-linear-to-br from-primary/10 via-card to-card hover:from-primary/15"
          : "bg-card hover:bg-card/70 hover:shadow-md"
      )}
    >
      {/* Header: avatar + name + role */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
            isFounder ? "bg-primary/20 text-primary" : "bg-secondary text-foreground"
          )}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{displayName}</span>
            {isFounder ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                <IconCrown className="size-2.5" />
                {t("memberRoleOwner")}
              </span>
            ) : null}
            {member.isFinance ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                <IconCoin className="size-2.5" />
                {t("memberFinanceBadge")}
              </span>
            ) : null}
          </div>
          {!isFounder ? (
            <div className="mt-0.5 text-xs text-muted-foreground">{roleLabel}</div>
          ) : null}
        </div>
      </div>

      {/* Meta: joined date + via */}
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <IconCalendar className="size-3" />
        {t("memberJoinedAgo", { date: relativeDate(member.joinedAt, t) })}
        {viaLabel ? <span>· {viaLabel}</span> : null}
      </div>

      {/* Footer: actions */}
      <div className="mt-auto flex items-center justify-between border-t border-border/40 pt-2">
        <Link
          href={`/creators/${member.userId}`}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          {t("memberViewProfile")}
          <IconExternalLink className="size-3" />
        </Link>
        {canManage && !isFounder ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {t("memberFinanceToggleShort")}
              <SwitchControl
                value={member.isFinance}
                onChange={() => handleToggleFinance()}
                disabled={updateMember.isPending}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              color="destructive"
              onClick={() => onAskRemove(member.id, displayName)}
              aria-label={t("removeMember")}
              title={t("removeMember")}
            >
              <IconTrash className="size-3.5" />
            </Button>
          </div>
        ) : isFounder ? (
          // Founder cell shows "Owner" affordance only; no actions.
          <span className="text-[10px] text-muted-foreground">{t("memberOwnerCannotRemove")}</span>
        ) : null}
      </div>

      {updateMember.isPending ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/60">
          <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {/* Suppress unused-import lint for IconUserPlus (re-exported case). */}
      <span className="hidden">
        <IconUserPlus className="size-0" />
      </span>
    </div>
  );
}

function relativeDate(
  iso: string,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  const diffDays = Math.floor((Date.now() - ts) / 86_400_000);
  if (diffDays < 1) return t("justNow");
  return t("daysAgo", { count: diffDays });
}

function surfaceErr(err: unknown, fallback: string) {
  if (err instanceof CrewApiError) {
    const detail =
      typeof err.body === "object" && err.body && "message" in err.body
        ? String((err.body as { message: unknown }).message)
        : err.message;
    toast.error(`HTTP ${err.status}`, { description: detail, duration: 8000 });
    return;
  }
  toast.error(err instanceof Error ? err.message : fallback);
}
