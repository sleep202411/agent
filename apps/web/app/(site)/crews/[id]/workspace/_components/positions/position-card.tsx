"use client";

/**
 * One position rendered as a compact card. Click anywhere to open the
 * detail sheet. Owner-only — visitor-facing position UI lives in
 * `crew-detail-new.tsx` and has different gating (Apply button etc).
 */

import {
  IconBriefcase,
  IconCalendar,
  IconCoin,
  IconMapPin,
  IconStar,
  IconUsers,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";
import {
  daysUntilCloseDate,
  employmentTypeKey,
  experienceKey,
  formatSalaryString,
  timeAgo,
  workModeKey,
  type CrewPositionDTO,
} from "./position-meta";

interface PositionCardProps {
  position: CrewPositionDTO;
  applicantCount: number;
  pendingApplicantCount: number;
  onClick: () => void;
}

export function PositionCard({
  position,
  applicantCount,
  pendingApplicantCount,
  onClick,
}: PositionCardProps) {
  const t = useTranslations("workspace");
  const translatePosition = useTranslatePositionValue();
  const filled = position.recruitedCount;
  const total = position.targetCount;
  const progressPct = total > 0 ? Math.min(100, (filled / total) * 100) : 0;
  const isFrozen = position.status === "frozen";
  const isFull = position.status === "full" || filled >= total;
  const label = translatePosition(position.positionType);
  const salaryText = formatSalaryString(position, t);
  const daysLeft = daysUntilCloseDate(position.closeDate);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Borderless card per DESIGN.md "Cards without borders".
        // Surface lift (bg-card vs bg-background) does the visual
        // separation; hover adds a subtle scale + brighter surface
        // — no rings, no borders.
        "group relative flex flex-col gap-3 rounded-xl bg-card p-4 text-left transition-all",
        "hover:bg-card/70 hover:shadow-md",
        isFrozen && "opacity-70"
      )}
    >
      {/* Top row: title + status pill */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground line-clamp-1">{label}</h3>
        <StatusPill isFrozen={isFrozen} isFull={isFull} t={t} />
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap gap-1.5 text-xs">
        {/* Note: the chip elements DO carry a 1px ring intentionally —
            they're token-sized affordances, not cards. Per DESIGN.md
            cards lose borders; small inline pills keep theirs. */}
        <MetaChip icon={IconMapPin}>
          {t(workModeKey(position.workMode))}
          {position.location ? ` · ${position.location}` : ""}
        </MetaChip>
        <MetaChip icon={IconBriefcase}>{t(employmentTypeKey(position.employmentType))}</MetaChip>
        {position.experienceLevel !== "any" ? (
          <MetaChip icon={IconStar}>{t(experienceKey(position.experienceLevel))}</MetaChip>
        ) : null}
      </div>

      {/* Salary highlight */}
      {salaryText ? (
        <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-400">
          <IconCoin className="size-4" />
          {salaryText}
        </div>
      ) : null}

      {/* Skills (truncated) */}
      {position.requiredSkills.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {position.requiredSkills.slice(0, 4).map((s) => (
            <span
              key={s}
              className="rounded-md border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary"
            >
              {s}
            </span>
          ))}
          {position.requiredSkills.length > 4 ? (
            <span className="rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              +{position.requiredSkills.length - 4}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Progress */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <IconUsers className="size-3" />
            {filled}/{total} {t("filled")}
          </span>
          {pendingApplicantCount > 0 ? (
            <span className="font-semibold text-amber-400">
              {t("pendingApplicantsBadge", { count: pendingApplicantCount })}
            </span>
          ) : null}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              isFrozen ? "bg-muted-foreground/40" : isFull ? "bg-green-400" : "bg-amber-400"
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Footer stats */}
      {/* Structural divider INSIDE the card — per DESIGN.md exception,
          a single-axis hairline is allowed to separate header/footer
          from body. */}
      <div className="mt-auto flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
        <span>
          {t("applicantCountFooter", { count: applicantCount })} · {timeAgo(position.createdAt, t)}
        </span>
        {daysLeft != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              daysLeft < 0 && "text-rose-400",
              daysLeft >= 0 && daysLeft <= 7 && "text-amber-400"
            )}
          >
            <IconCalendar className="size-3" />
            {daysLeft < 0
              ? t("positionExpired")
              : daysLeft === 0
                ? t("positionClosesToday")
                : t("positionClosesInDays", { count: daysLeft })}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function StatusPill({
  isFrozen,
  isFull,
  t,
}: {
  isFrozen: boolean;
  isFull: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  if (isFrozen) {
    return (
      <span className="shrink-0 rounded-full border border-muted-foreground/30 bg-muted-foreground/10 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
        {t("statusFrozen")}
      </span>
    );
  }
  if (isFull) {
    return (
      <span className="shrink-0 rounded-full border border-green-400/30 bg-green-400/10 px-2 py-0.5 text-[10px] font-semibold text-green-400">
        {t("statusFull")}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
      {t("statusRecruiting")}
    </span>
  );
}

function MetaChip({
  icon: Icon,
  children,
}: {
  icon: typeof IconMapPin;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-muted-foreground">
      <Icon className="size-3" />
      {children}
    </span>
  );
}
