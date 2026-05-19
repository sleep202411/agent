"use client";

import {
  IconCheck,
  IconCoin,
  IconCircleCheck,
  IconLoader2,
  IconMovie,
  IconSend,
  IconUserMinus,
  IconUserPlus,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  useEpisodeActivity,
  type EpisodeActivity,
  type EpisodeActivityType,
} from "@/app/(site)/crews/_hooks/use-episodes";
import { CURRENCY_SYMBOLS, ZERO_DECIMAL_CURRENCIES, type CurrencyCode } from "@repo/shared/crew";

interface ActivityLogProps {
  crewId: string;
  episodeId: string;
}

/**
 * Append-only event timeline per episode. Each event renders as an
 * icon + structured description + relative timestamp; the icon and
 * tone are derived from the activity type so admins can scan the
 * log without reading every line.
 *
 * Newest first. Unknown future types render as a neutral dot so the
 * timeline never crashes on a backend-added enum value.
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
            <ActivityRow key={a.id} activity={a} t={t} />
          ))}
        </ol>
      )}
    </div>
  );
}

// ─── Single row ────────────────────────────────────────

function ActivityRow({
  activity,
  t,
}: {
  activity: EpisodeActivity;
  t: ReturnType<typeof useTranslations>;
}) {
  const visual = ACTIVITY_VISUAL[activity.type as EpisodeActivityType] ?? UNKNOWN_VISUAL;

  return (
    <li className="flex items-start gap-3 border-b border-border/40 py-2.5 last:border-0">
      <div
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
          visual.bg
        )}
      >
        <visual.icon className={cn("size-3.5", visual.fg)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground/85">{renderActivity(activity, t)}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{formatTime(activity.createdAt)}</div>
      </div>
    </li>
  );
}

// ─── Per-type rendering ────────────────────────────────

interface ActivityVisual {
  icon: typeof IconCheck;
  bg: string;
  fg: string;
}

const ACTIVITY_VISUAL: Record<EpisodeActivityType, ActivityVisual> = {
  episode_created: { icon: IconMovie, bg: "bg-secondary", fg: "text-muted-foreground" },
  member_assigned: { icon: IconUserPlus, bg: "bg-primary/15", fg: "text-primary" },
  member_unassigned: {
    icon: IconUserMinus,
    bg: "bg-muted-foreground/15",
    fg: "text-muted-foreground",
  },
  submission_made: { icon: IconSend, bg: "bg-blue-400/15", fg: "text-blue-400" },
  submission_approved: { icon: IconCheck, bg: "bg-green-400/15", fg: "text-green-400" },
  submission_rejected: { icon: IconX, bg: "bg-rose-400/15", fg: "text-rose-400" },
  revenue_set: { icon: IconCoin, bg: "bg-amber-400/15", fg: "text-amber-400" },
  episode_approved: { icon: IconCircleCheck, bg: "bg-green-400/15", fg: "text-green-400" },
};

const UNKNOWN_VISUAL: ActivityVisual = {
  icon: IconCheck,
  bg: "bg-secondary",
  fg: "text-muted-foreground",
};

function renderActivity(a: EpisodeActivity, t: ReturnType<typeof useTranslations>): string {
  const actor = a.actorName;
  const role = String(a.payload.roleName ?? "");
  const target = String(a.payload.targetName ?? a.payload.targetUserId ?? "");
  const reason = String(a.payload.reason ?? "");
  const rawAmount = a.payload.amount;
  const currency = String(a.payload.currency ?? "CNY") as CurrencyCode;
  const formattedAmount = typeof rawAmount === "number" ? formatMoney(rawAmount, currency) : "—";

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
        amount: formattedAmount,
        currency,
      }),
    episode_approved: () => t("logEpisodeApproved", { actor }),
  };
  return (map as Record<string, (() => string) | undefined>)[a.type]?.() ?? "";
}

/** Render a smallest-unit amount as a localized currency string. */
function formatMoney(smallestUnit: number, currency: CurrencyCode): string {
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);
  const display = isZeroDecimal ? smallestUnit : smallestUnit / 100;
  const symbol = CURRENCY_SYMBOLS[currency] ?? "";
  const formatted =
    typeof Intl !== "undefined" && Intl.NumberFormat
      ? new Intl.NumberFormat(undefined, {
          minimumFractionDigits: isZeroDecimal ? 0 : 2,
          maximumFractionDigits: isZeroDecimal ? 0 : 2,
        }).format(display)
      : display.toFixed(isZeroDecimal ? 0 : 2);
  return `${symbol}${formatted}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 16);
}
