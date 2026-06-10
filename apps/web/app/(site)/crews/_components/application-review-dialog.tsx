"use client";

/**
 * One-shot application-review dialog. Opens directly from the owner's
 * notification deeplink (`?application=<id>`) so the approve / reject
 * decision needs zero further navigation.
 *
 * Data sources are all already-cached queries — no extra round trip:
 *   - useCrewApplications(crewId)  → the application row
 *   - useCrewPositions(crewId)     → the position being applied for
 *   - useCrewDetail(crewId)        → crew name for breadcrumb
 *   - useUserDisplays([applicantId]) → applicant nickname / avatar
 *
 * States the dialog handles cleanly:
 *   - loading        → spinner + "Loading…" body
 *   - not found      → friendly "withdrawn" message (e.g. user clicks an
 *                      old notification long after the applicant deleted
 *                      the application)
 *   - already decided → render the dialog but disable both buttons and
 *                       show a status chip; click "View position" to
 *                       continue managing
 *   - pending        → the happy path: approve / reject inline
 *
 * Decision actions reuse the existing useApproveApplication /
 * useRejectApplication mutations — both already invalidate every
 * touched cache (applications, members, positions, crew detail), so
 * other surfaces refresh too.
 */

import { useMemo } from "react";
import { encodeUserId } from "@/src/lib/user-id-codec";
import Link from "next/link";
import {
  IconBriefcase,
  IconCalendar,
  IconCheck,
  IconCoin,
  IconExternalLink,
  IconLoader2,
  IconMapPin,
  IconShield,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import {
  CURRENCY_SYMBOLS,
  CrewApiError,
  ZERO_DECIMAL_CURRENCIES,
  useApproveApplication,
  useCrewApplications,
  useCrewDetail,
  useCrewPositions,
  useRejectApplication,
  type CrewApplicationStatus,
  type CurrencyCode,
} from "@/app/(site)/crews/_hooks/use-crew";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";

interface ApplicationReviewDialogProps {
  crewId: string;
  /** Application id from the notification deeplink, or null when the
   *  dialog should stay closed. */
  applicationId: string | null;
  /** Parent owns the close handler so it can also clear the URL query
   *  param (preventing reopen on refresh / back-nav). */
  onClose: () => void;
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

export function ApplicationReviewDialog({
  crewId,
  applicationId,
  onClose,
}: ApplicationReviewDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;

  const open = applicationId !== null;

  const { data: applications = [], isLoading: appsLoading } = useCrewApplications(crewId, open);
  const { data: positions = [] } = useCrewPositions(crewId);
  const { data: crew } = useCrewDetail(crewId);

  const application = useMemo(
    () => (applicationId ? (applications.find((a) => a.id === applicationId) ?? null) : null),
    [applicationId, applications]
  );
  const position = useMemo(
    () => (application ? (positions.find((p) => p.id === application.positionId) ?? null) : null),
    [application, positions]
  );

  // Batch-resolve nickname even though it's a single id — the hook
  // dedupes and caches across the whole workspace, so this is free.
  const applicantIds = useMemo(() => (application ? [application.applicantId] : []), [application]);
  const displays = useUserDisplays(applicantIds);

  const approve = useApproveApplication(crewId);
  const reject = useRejectApplication(crewId);
  const busy = approve.isPending || reject.isPending;

  const handleApprove = () => {
    if (!application) return;
    approve.mutate(application.id, {
      onSuccess: () => {
        toast.success(t("reviewDialogApproveSuccess"));
        onClose();
      },
      onError: (err) => reportError(err, t("reviewDialogApproveSuccess") + " failed"),
    });
  };

  const handleReject = () => {
    if (!application) return;
    reject.mutate(application.id, {
      onSuccess: () => {
        toast.success(t("reviewDialogRejectSuccess"));
        onClose();
      },
      onError: (err) => reportError(err, t("reviewDialogRejectSuccess") + " failed"),
    });
  };

  // Dialog body branches: loading → spinner; missing → not-found;
  // otherwise → full review layout.
  const body = (() => {
    if (appsLoading && !application) {
      return (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin" />
          <span>{t("reviewDialogLoading")}</span>
        </div>
      );
    }

    if (!application || !position) {
      return (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {t("reviewDialogNotFound")}
        </div>
      );
    }

    const lookup = displays.get(application.applicantId);
    const displayName = displayNameOf(application.applicantId, displays);
    const chip = STATUS_CHIP[application.status];
    const isPending = application.status === "pending";

    return (
      <div className="space-y-4 p-4">
        {/* Position card */}
        <section className="rounded-xl border border-border/60 bg-card/50 p-4">
          <header className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("reviewDialogPositionSection")}
            </div>
            <Link
              href={localizePath(`/crews/${crewId}/workspace`, locale)}
              onClick={onClose}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t("reviewDialogViewPosition")}
              <IconExternalLink className="size-3" />
            </Link>
          </header>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <IconBriefcase className="size-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="text-sm font-semibold text-foreground">{position.positionType}</div>
              {crew?.name ? <div className="text-xs text-muted-foreground">{crew.name}</div> : null}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <PositionMeta icon={<IconMapPin className="size-3" />}>
                  {position.workMode}
                  {position.location ? ` · ${position.location}` : ""}
                </PositionMeta>
                <PositionMeta icon={<IconShield className="size-3" />}>
                  {position.experienceLevel}
                </PositionMeta>
                {position.salary.negotiable || position.salary.minAmount != null ? (
                  <PositionMeta icon={<IconCoin className="size-3 text-amber-400" />}>
                    {formatSalary(position.salary)}
                  </PositionMeta>
                ) : null}
                <PositionMeta>
                  {position.recruitedCount}/{position.targetCount} {t("filled")}
                </PositionMeta>
              </div>
            </div>
          </div>
        </section>

        {/* Applicant card */}
        <section className="rounded-xl border border-border/60 bg-card/50 p-4">
          <header className="mb-3 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("reviewDialogApplicantSection")}
            </div>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                chip.className
              )}
            >
              {t(chip.labelKey)}
            </span>
          </header>
          <div className="flex items-start gap-3">
            <UserAvatar
              src={lookup?.avatar}
              seed={application.applicantId}
              name={displayName}
              className="size-12 shrink-0 rounded-full"
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-foreground">{displayName}</span>
                {application.yearsExperience != null ? (
                  <span className="text-[11px] text-muted-foreground">
                    {t("reviewDialogYears", { count: application.yearsExperience })}
                  </span>
                ) : null}
              </div>
              {application.expectedCompensation ? (
                <div className="text-[11px] text-amber-400">
                  {t("reviewDialogExpected", {
                    amount: formatMoney(
                      application.expectedCompensation.amount,
                      application.expectedCompensation.currency
                    ),
                  })}
                </div>
              ) : null}
              {application.availableStartDate ? (
                <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <IconCalendar className="size-3" />
                  {t("reviewDialogAvailable", { date: application.availableStartDate })}
                </div>
              ) : null}
              <div className="text-[11px] text-muted-foreground">
                {t("reviewDialogAppliedAt", { when: formatRelative(application.createdAt) })}
              </div>
            </div>
          </div>

          {application.message ? (
            <p className="mt-3 whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-xs leading-relaxed text-foreground/85">
              {application.message}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
            <Link
              href={localizePath(`/creators/${encodeUserId(application.applicantId)}`, locale)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <IconUser className="size-3" />
              {t("reviewDialogViewProfile")}
              <IconExternalLink className="size-3" />
            </Link>
            {application.portfolioUrl ? (
              <a
                href={application.portfolioUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {t("viewPortfolio")}
                <IconExternalLink className="size-3" />
              </a>
            ) : null}
          </div>

          {!isPending ? (
            <p className="mt-3 text-[11px] text-muted-foreground">
              {t("reviewDialogAlreadyDecided")}
            </p>
          ) : null}
        </section>
      </div>
    );
  })();

  const showActions = application !== null && application.status === "pending";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block external close (overlay click / Esc) while a decision is
        // in flight so we don't leave a half-applied mutation hidden.
        if (!next && busy) return;
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("reviewDialogTitle")}</DialogTitle>
        </DialogHeader>
        {body}
        <DialogFooter>
          {showActions ? (
            <>
              <Button
                type="button"
                variant="outline"
                color="muted"
                onClick={handleReject}
                disabled={busy}
              >
                {reject.isPending ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : (
                  <IconX className="size-3.5" />
                )}
                {t("reject")}
              </Button>
              <Button
                type="button"
                variant="solid"
                color="primary"
                onClick={handleApprove}
                disabled={busy}
              >
                {approve.isPending ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : (
                  <IconCheck className="size-3.5" />
                )}
                {t("approve")}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" color="muted" onClick={onClose}>
              {tc("close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ───────────────────────────────────────────────

function PositionMeta({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {icon}
      {children}
    </span>
  );
}

function formatSalary(salary: {
  period: string | null;
  currency: CurrencyCode | null;
  minAmount: number | null;
  maxAmount: number | null;
  negotiable: boolean;
}): string {
  if (salary.negotiable) return "面议";
  if (salary.minAmount == null || salary.currency == null) return "—";
  const symbol = CURRENCY_SYMBOLS[salary.currency] ?? salary.currency;
  const lo = displayUnit(salary.minAmount, salary.currency);
  const hi = salary.maxAmount != null ? displayUnit(salary.maxAmount, salary.currency) : null;
  const periodSuffix = salary.period ? `/${salary.period}` : "";
  const range = hi != null ? `${lo}-${hi}` : `${lo}`;
  return `${symbol}${range}${periodSuffix}`;
}

function displayUnit(amount: number, currency: CurrencyCode): string {
  const value = ZERO_DECIMAL_CURRENCIES.has(currency) ? amount : amount / 100;
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K` : String(value);
}

function formatMoney(amount: number, currency: CurrencyCode): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${symbol}${displayUnit(amount, currency)}`;
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
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
