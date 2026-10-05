"use client";

import { ApplicationAmendmentsPanel } from "./application-amendments-panel";
import { ApplicationInterviewPanel } from "./application-interview-panel";
import { ApplicationTermsPanel } from "./application-terms-panel";
import { isCrewCursorError } from "@/app/(site)/crews/_hooks/api";

/**
 * One-shot application-review dialog. Opens directly from the owner's
 * notification deeplink (`?application=<id>`) so the approve / reject
 * decision needs zero further navigation.
 *
 * Data sources are all already-cached queries — no extra round trip:
 *   - useCrewApplication(crewId, id) → the exact application row
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

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
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
  useCrewApplication,
  useCrewDetail,
  useCrewPositions,
  useRejectApplication,
  type CrewApplicationStatus,
  type CurrencyCode,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";
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

export function ApplicationReviewDialog(props: ApplicationReviewDialogProps) {
  const { user } = useCurrentUser();
  if (props.applicationId === null) return null;
  return (
    <ApplicationReviewSession
      key={JSON.stringify([user?.id, props.crewId, props.applicationId])}
      {...props}
    />
  );
}

function ApplicationReviewSession({
  crewId,
  applicationId,
  onClose,
}: ApplicationReviewDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const translatePosition = useTranslatePositionValue();

  const open = applicationId !== null;

  const applicationQuery = useCrewApplication(crewId, applicationId, open);
  const { data: application, isLoading: appsLoading } = applicationQuery;
  const positionsQuery = useCrewPositions(crewId);
  const positions = positionsQuery.data;
  const crewQuery = useCrewDetail(crewId);
  const { data: crew } = crewQuery;
  const loadErrors = [
    { key: "application", query: applicationQuery, retry: () => applicationQuery.refetch() },
    {
      key: "positions",
      query: positionsQuery,
      retry: () =>
        positionsQuery.isFetchNextPageError &&
        !isCrewCursorError(positionsQuery.error, "CREW_POSITION_CURSOR_INVALID")
          ? positionsQuery.fetchNextPage()
          : positionsQuery.refetch(),
    },
    { key: "crew", query: crewQuery, retry: () => crewQuery.refetch() },
  ].filter(({ query }) => query.isError);

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
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const pending = useRef(false);
  const alive = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const busy = decision !== null;
  const [termsReady, setTermsReady] = useState(false);
  const [interviewReady, setInterviewReady] = useState(false);
  const termsText = useTranslations("crewTerms");
  const interviewBlocked =
    application?.interview?.state === "proposed" || application?.interview?.state === "confirmed";

  const handleDecision = (next: "approve" | "reject") => {
    if (
      !alive.current ||
      pending.current ||
      application?.status !== "pending" ||
      !position ||
      loadErrors.length > 0 ||
      (next === "approve" && (!termsReady || !interviewReady || interviewBlocked))
    )
      return;
    pending.current = true;
    setDecision(next);
    const mutation = next === "approve" ? approve : reject;
    const successKey =
      next === "approve" ? "reviewDialogApproveSuccess" : "reviewDialogRejectSuccess";
    mutation.mutate(application.id, {
      onSuccess: () => {
        if (!alive.current) return;
        toast.success(t(successKey));
        onClose();
      },
      onError: (err) => {
        if (alive.current)
          reportError(
            err,
            t(next === "approve" ? "reviewDialogApproveFailed" : "reviewDialogRejectFailed")
          );
      },
      onSettled: () => {
        if (!alive.current) return;
        pending.current = false;
        setDecision(null);
      },
    });
  };

  // Dialog body branches: loading → spinner; missing → not-found;
  // otherwise → full review layout.
  const body = (() => {
    if (
      (appsLoading && !application) ||
      (application &&
        !position &&
        !positionsQuery.isError &&
        (positionsQuery.isLoading || positionsQuery.isFetching || positionsQuery.hasNextPage))
    ) {
      return (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <IconLoader2 className="size-4 animate-spin" />
          <span>{t("reviewDialogLoading")}</span>
        </div>
      );
    }

    if (!application || !position) {
      if (loadErrors.length > 0) return null;
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
              <div className="text-sm font-semibold text-foreground">
                {translatePosition(position.positionType)}
              </div>
              {crew?.name ? <div className="text-xs text-muted-foreground">{crew.name}</div> : null}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <PositionMeta icon={<IconMapPin className="size-3" />}>
                  {t(
                    `workMode${position.workMode.charAt(0).toUpperCase()}${position.workMode.slice(1)}`
                  )}
                  {position.location ? ` · ${position.location}` : ""}
                </PositionMeta>
                <PositionMeta icon={<IconShield className="size-3" />}>
                  {t(
                    `experience${position.experienceLevel.charAt(0).toUpperCase()}${position.experienceLevel.slice(1)}`
                  )}
                </PositionMeta>
                {position.salary.negotiable || position.salary.minAmount != null ? (
                  <PositionMeta icon={<IconCoin className="size-3 text-amber-400" />}>
                    {formatSalary(position.salary, t)}
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
                {t("reviewDialogAppliedAt", {
                  when: formatRelative(application.createdAt, locale),
                })}
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

  const showActions = application?.status === "pending" && !!position;

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
        {loadErrors.map(({ key, query, retry }) => (
          <div
            key={key}
            role="alert"
            className="mx-4 mb-3 rounded-lg border border-destructive/30 p-3 text-sm"
          >
            <p>{query.error instanceof Error ? query.error.message : tc("loadFailed")}</p>
            <Button
              type="button"
              variant="outline"
              color="muted"
              disabled={query.isFetching}
              onClick={() => void retry()}
            >
              {tc("retry")}
            </Button>
          </div>
        ))}
        {body}
        {application && position && loadErrors.length === 0 && (
          <ApplicationTermsPanel
            applicationId={application.id}
            applicantId={application.applicantId}
            status={application.status}
            taskLinked={Boolean(position.taskId)}
            advertisedPaymentTerms={position.paymentTerms}
            reviewer
            onReady={setTermsReady}
          />
        )}
        {application && position && loadErrors.length === 0 && (
          <ApplicationInterviewPanel
            applicationId={application.id}
            applicantId={application.applicantId}
            reviewer
            onReady={setInterviewReady}
            onUpdated={() => {
              void applicationQuery.refetch();
            }}
          />
        )}
        {application && position && loadErrors.length === 0 && (
          <ApplicationAmendmentsPanel
            applicationId={application.id}
            applicantId={application.applicantId}
            crewId={crewId}
            taskId={position.taskId ?? null}
            status={application.status}
            reviewer
          />
        )}
        {interviewBlocked && (
          <p className="px-4 text-sm text-muted-foreground">{termsText("interviewBlocked")}</p>
        )}
        <DialogFooter>
          {showActions ? (
            <>
              <Button
                type="button"
                variant="outline"
                color="muted"
                onClick={() => handleDecision("reject")}
                disabled={busy || loadErrors.length > 0}
              >
                {decision === "reject" ? (
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
                onClick={() => handleDecision("approve")}
                disabled={
                  busy ||
                  loadErrors.length > 0 ||
                  !termsReady ||
                  !interviewReady ||
                  interviewBlocked
                }
              >
                {decision === "approve" ? (
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

function formatSalary(
  salary: {
    period: string | null;
    currency: CurrencyCode | null;
    minAmount: number | null;
    maxAmount: number | null;
    negotiable: boolean;
  },
  t: ReturnType<typeof useTranslations>
): string {
  if (salary.negotiable) return t("salaryNegotiable");
  if (salary.minAmount == null || salary.currency == null) return "—";
  const symbol = CURRENCY_SYMBOLS[salary.currency] ?? salary.currency;
  const lo = displayUnit(salary.minAmount, salary.currency);
  const hi = salary.maxAmount != null ? displayUnit(salary.maxAmount, salary.currency) : null;
  const periodKey =
    salary.period === "month"
      ? "salaryPeriodMonth"
      : salary.period === "episode"
        ? "salaryPeriodEpisode"
        : salary.period === "project"
          ? "salaryPeriodProject"
          : null;
  const periodSuffix = periodKey ? `/${t(periodKey)}` : "";
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

function formatRelative(iso: string, locale: Locale): string {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return iso;
  const seconds = (timestamp - Date.now()) / 1000;
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return relative.format(0, "second");
  if (Math.abs(seconds) < 3600) return relative.format(Math.trunc(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return relative.format(Math.trunc(seconds / 3600), "hour");
  if (Math.abs(seconds) < 30 * 86400) return relative.format(Math.trunc(seconds / 86400), "day");
  return new Date(iso).toLocaleDateString(locale);
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
