"use client";

/**
 * Per-position applicants list rendered inside the workspace recruitment
 * accordion. The applications endpoint is crew-scoped (returns every
 * pending + recent decision), so we filter to the open row client-side
 * — fine at Phase-1 volumes and saves a per-position roundtrip.
 *
 * Owner sees Approve / Reject buttons on pending rows; non-owners see
 * the roster read-only.
 */

import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { encodeUserId } from "@/src/lib/user-id-codec";
import Link from "next/link";
import { useMemo } from "react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import {
  CURRENCY_SYMBOLS,
  CrewApiError,
  ZERO_DECIMAL_CURRENCIES,
  useApproveApplication,
  useCrewApplications,
  useRejectApplication,
  type CrewApplicationStatus,
  type CurrencyCode,
} from "@/app/(site)/crews/_hooks/use-crew";
import { toast } from "sonner";

interface JobApplicantsListProps {
  crewId: string;
  positionId: string;
  /** Owner sees action buttons; members see the roster only. */
  canManage: boolean;
}

const STATUS_CHIP: Record<CrewApplicationStatus, { labelKey: string; className: string }> = {
  pending: {
    labelKey: "applicantStatusPending",
    className: "border-amber-400/30 bg-amber-400/10 text-amber-400",
  },
  approved: {
    labelKey: "applicantStatusApproved",
    className: "border-green-400/30 bg-green-400/10 text-green-400",
  },
  rejected: {
    labelKey: "applicantStatusRejected",
    className: "border-rose-400/30 bg-rose-400/10 text-rose-400",
  },
};

export function JobApplicantsList({ crewId, positionId, canManage }: JobApplicantsListProps) {
  const locale = useLocale();
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const inbox = useCrewApplications(crewId, canManage, { positionId });
  const { data: applicants, isLoading, isError } = inbox;
  const approve = useApproveApplication(crewId);
  const reject = useRejectApplication(crewId);

  // Batch-resolve nicknames for everyone in the visible list. Empty
  // list when there are no applicants — useUserDisplays no-ops on that.
  const applicantIds = useMemo(() => applicants.map((a) => a.applicantId), [applicants]);
  const displays = useUserDisplays(applicantIds);

  if (!canManage) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
        <IconLoader2 className="size-4 animate-spin" />
        <span>{t("applicantsLoading")}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-4 text-center text-xs text-rose-400">{t("applicantsLoadFailed")}</div>
    );
  }

  if (applicants.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">{t("noApplicantsYet")}</div>
    );
  }

  const handleApprove = (id: string) =>
    approve.mutate(id, {
      onError: (err) => reportError(err, t("approve") + " failed"),
    });
  const handleReject = (id: string) =>
    reject.mutate(id, {
      onError: (err) => reportError(err, t("reject") + " failed"),
    });

  return (
    <div>
      <div className="divide-y divide-border/60">
        {applicants.map((a) => {
          const chip = STATUS_CHIP[a.status];
          const busy =
            (approve.isPending && approve.variables === a.id) ||
            (reject.isPending && reject.variables === a.id);
          const lookup = displays.get(a.applicantId);
          const displayName = displayNameOf(a.applicantId, displays);
          const initial = (lookup?.nickname?.trim() || a.applicantId).charAt(0).toUpperCase();
          return (
            <div key={a.id} className="flex items-start gap-3 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-foreground">
                {initial}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{displayName}</span>
                  {a.yearsExperience != null ? (
                    <Chip>{t("applicantYears", { count: a.yearsExperience })}</Chip>
                  ) : null}
                  {a.expectedCompensation ? (
                    <Chip className="text-amber-400">
                      {t("applicantExpected")}{" "}
                      {formatMoney(a.expectedCompensation.amount, a.expectedCompensation.currency)}
                    </Chip>
                  ) : null}
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      chip.className
                    )}
                  >
                    {t(chip.labelKey)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDate(a.createdAt)}
                  </span>
                </div>
                {a.message ? (
                  <p className="line-clamp-3 text-xs text-foreground/75">{a.message}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                  {/* /creators/[id] is the canonical public profile —
                    bio + published works combined. `/profile` is the
                    viewer's OWN page with no dynamic segment, so a
                    `/profile/<id>` URL would 404. */}
                  <Link
                    href={`/${locale}/creators/${encodeUserId(a.applicantId)}`}
                    className="text-primary hover:underline"
                  >
                    {t("applicantProfile")}
                  </Link>
                  {a.portfolioUrl ? (
                    <a
                      href={a.portfolioUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {t("applicantPortfolio")}
                    </a>
                  ) : null}
                  {a.availableStartDate ? (
                    <span className="text-muted-foreground">
                      {t("applicantAvailable")} {a.availableStartDate}
                    </span>
                  ) : null}
                </div>
              </div>
              {canManage && a.status === "pending" ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleApprove(a.id)}
                    className="flex items-center gap-1 rounded-md border border-green-400/30 bg-green-400/10 px-2 py-1 text-xs font-semibold text-green-400 transition-colors hover:bg-green-400/20 disabled:opacity-50"
                  >
                    <IconCheck className="size-3.5" />
                    {t("approve")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleReject(a.id)}
                    className="flex items-center gap-1 rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-xs font-semibold text-rose-400 transition-colors hover:bg-rose-400/20 disabled:opacity-50"
                  >
                    <IconX className="size-3.5" />
                    {t("reject")}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {inbox.hasNextPage ? (
        <button
          type="button"
          disabled={inbox.isFetchingNextPage}
          onClick={() => void inbox.fetchNextPage()}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          {inbox.isFetchingNextPage ? <IconLoader2 className="size-4 animate-spin" /> : null}
          {tc("loadMore")}
        </button>
      ) : null}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function formatMoney(amount: number, currency: CurrencyCode): string {
  const display = ZERO_DECIMAL_CURRENCIES.has(currency) ? amount : amount / 100;
  const compact =
    display >= 1000
      ? `${(display / 1000).toFixed(display % 1000 === 0 ? 0 : 1)}K`
      : String(display);
  return `${CURRENCY_SYMBOLS[currency]}${compact}`;
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}

function reportError(err: unknown, fallback: string): void {
  if (err instanceof CrewApiError) {
    const detail =
      typeof err.body === "object" && err.body && "message" in err.body
        ? String((err.body as { message: unknown }).message)
        : err.message;
    toast.error(`HTTP ${err.status}`, { description: detail, duration: 8000 });
    return;
  }
  const msg = err instanceof Error ? err.message : "";
  toast.error(msg || fallback);
}
