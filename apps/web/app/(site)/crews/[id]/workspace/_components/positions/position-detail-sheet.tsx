"use client";

import { isCrewCursorError } from "@/app/(site)/crews/_hooks/api";

/**
 * Right-side Sheet drawer with full position info + applicants
 * triage. Owner-only — handles every position management action:
 *   - View metadata (description, skills, salary, dates)
 *   - Triage applicants (approve / reject from grouped sections)
 *   - Freeze / unfreeze / delete the position
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { encodeUserId } from "@/src/lib/user-id-codec";
import {
  IconBriefcase,
  IconCalendar,
  IconCheck,
  IconCoin,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconLoader2,
  IconMapPin,
  IconPercentage,
  IconStar,
  IconTrash,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import Link from "next/link";
import { toast } from "sonner";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CURRENCY_SYMBOLS,
  CrewApiError,
  ZERO_DECIMAL_CURRENCIES,
  useApproveApplication,
  useCrewApplications,
  useDeletePosition,
  useRejectApplication,
  useUpdatePosition,
  type CrewApplicationDTO,
  type CrewPositionDTO,
  type CurrencyCode,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";
import { PositionInvitationsPanel } from "@/app/(site)/crews/_components/position-invitations-panel";
import { CreateCrewJobDialog } from "@/app/(site)/crews/_components/create-crew-job-dialog";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import type { LookupUserDTO } from "@repo/shared/users";
import { employmentTypeKey, experienceKey, formatSalaryString, workModeKey } from "./position-meta";

interface PositionDetailSheetProps {
  crewId: string;
  position: CrewPositionDTO | null;
  canManage?: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PositionDetailSheet(props: PositionDetailSheetProps) {
  const { user } = useCurrentUser();
  if (!props.position) return null;
  return (
    <PositionDetailSession
      key={JSON.stringify([user?.id, props.crewId, props.position.id])}
      {...props}
      position={props.position}
    />
  );
}

function PositionDetailSession({
  crewId,
  position,
  canManage = false,
  onOpenChange,
}: PositionDetailSheetProps & { position: CrewPositionDTO }) {
  const paymentT = useTranslations("taskPaymentTerms");
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const translatePosition = useTranslatePositionValue();
  const updatePosition = useUpdatePosition(crewId);
  const deletePosition = useDeletePosition(crewId);
  const applicationInbox = useCrewApplications(crewId, canManage && !!position, {
    positionId: position?.id,
  });
  const applications = applicationInbox.data;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmFreeze, setConfirmFreeze] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const pending = applications.filter((a) => a.status === "pending");
  const approved = applications.filter((a) => a.status === "approved");
  const rejected = applications.filter((a) => a.status === "rejected");

  // One batched lookup for every applicant nickname; passed down to
  // each ApplicantRow so we don't fire N independent fetches.
  const applicantIds = useMemo(() => applications.map((a) => a.applicantId), [applications]);
  const displays = useUserDisplays(applicantIds);

  const alive = useRef(false);
  const pendingAction = useRef(false);
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const begin = () => {
    if (!alive.current || pendingAction.current || !canManage) return false;
    pendingAction.current = true;
    setBusy(true);
    return true;
  };
  const onSettled = () => {
    if (!alive.current) return;
    pendingAction.current = false;
    setBusy(false);
  };

  const label = translatePosition(position.positionType);
  const isFrozen = position.status === "frozen";
  const isFull = position.status === "full" || position.recruitedCount >= position.targetCount;
  const salaryText = formatSalaryString(position, t);
  const filled = position.recruitedCount;
  const targetCount = position.targetCount;
  const progressPct = targetCount > 0 ? Math.min(100, (filled / targetCount) * 100) : 0;
  const applicationCounts = applicationInbox.summary ??
    position.applicationStats ?? {
      total: applications.length,
      pending: pending.length,
      approved: approved.length,
      rejected: rejected.length,
    };

  const changeStatus = (status: "open" | "frozen") => {
    if (!begin()) return;
    updatePosition.mutate(
      { positionId: position.id, status },
      {
        onSettled,
        onSuccess: () => {
          if (!alive.current) return;
          toast.success(
            status === "open" ? t("unfreezeSuccess") : t("closeJobSuccess", { name: label })
          );
          setConfirmFreeze(false);
        },
        onError: (err) => {
          if (alive.current) surfaceErr(err, t("closeJobFailed"));
        },
      }
    );
  };

  const applicantReadUnavailable = applicationInbox.isLoading || applicationInbox.isError;
  const handleDelete = () => {
    if (applicantReadUnavailable || applicationCounts.pending > 0 || !begin()) return;
    deletePosition.mutate(position.id, {
      onSettled,
      onSuccess: () => {
        if (!alive.current) return;
        toast.success(t("positionDeleted"));
        setConfirmDelete(false);
        onOpenChange(false);
      },
      onError: (err) => {
        if (alive.current) surfaceErr(err, t("positionDeleteFailed"));
      },
    });
  };

  return (
    <>
      <Sheet open={position !== null} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-xl">
              {label}
              <StatusPill isFrozen={isFrozen} isFull={isFull} t={t} />
            </SheetTitle>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
              <MetaChip icon={IconMapPin}>
                {t(workModeKey(position.workMode))}
                {position.location ? ` · ${position.location}` : ""}
              </MetaChip>
              <MetaChip icon={IconBriefcase}>
                {t(employmentTypeKey(position.employmentType))}
              </MetaChip>
              {position.experienceLevel !== "any" ? (
                <MetaChip icon={IconStar}>{t(experienceKey(position.experienceLevel))}</MetaChip>
              ) : null}
              {position.paymentTerms && (
                <MetaChip icon={IconCoin}>{paymentT(position.paymentTerms)}</MetaChip>
              )}
              {salaryText ? (
                <MetaChip icon={IconCoin} highlight>
                  {salaryText}
                </MetaChip>
              ) : null}
              {position.durationMonths != null ? (
                <MetaChip icon={IconCalendar}>
                  {t("durationMonthsChip", { count: position.durationMonths })}
                </MetaChip>
              ) : null}
              {position.revenueSharePercent != null ? (
                <MetaChip icon={IconPercentage} highlight>
                  {t("revenueShareChip", { percent: position.revenueSharePercent })}
                </MetaChip>
              ) : null}
            </div>
          </SheetHeader>

          <SheetBody className="flex-1 overflow-y-auto">
            {/* ─── Description ─── */}
            <Section title={t("createJobDescriptionLabel")}>
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                {position.description}
              </p>
            </Section>

            {/* ─── Skills ─── */}
            {position.requiredSkills.length > 0 ? (
              <Section title={t("createJobRequiredSkillsLabel")}>
                <div className="flex flex-wrap gap-1.5">
                  {position.requiredSkills.map((s) => (
                    <span
                      key={s}
                      className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </Section>
            ) : null}

            {/* ─── Progress ─── */}
            <Section title={t("recruitmentProgress")}>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <IconUsers className="size-3.5 text-primary" />
                    <span className="font-semibold">
                      {filled} / {targetCount}
                    </span>
                    <span className="text-muted-foreground">{t("filled")}</span>
                  </span>
                  {position.closeDate ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <IconCalendar className="size-3.5" />
                      {t("closesOn", { date: position.closeDate })}
                    </span>
                  ) : null}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      isFrozen ? "bg-muted-foreground/40" : isFull ? "bg-green-400" : "bg-amber-400"
                    )}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            </Section>

            {/* ─── Applicants triage ─── */}
            {canManage ? (
              <Section
                title={t("applicantsTriageTitle", { count: applicationCounts.total })}
                defaultExpanded
              >
                {applicationInbox.isError ? (
                  <div
                    role="alert"
                    className="mb-3 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-300"
                  >
                    <p>{surfaceMessage(applicationInbox.error, t("applicantsLoadFailed"))}</p>
                    <Button
                      type="button"
                      variant="outline"
                      color="muted"
                      size="sm"
                      disabled={applicationInbox.isFetching}
                      onClick={() =>
                        void (applicationInbox.isFetchNextPageError &&
                        !isCrewCursorError(
                          applicationInbox.error,
                          "CREW_APPLICATION_CURSOR_INVALID"
                        )
                          ? applicationInbox.fetchNextPage()
                          : applicationInbox.refetch())
                      }
                    >
                      {tc("retry")}
                    </Button>
                  </div>
                ) : null}
                {applicationInbox.isLoading && applications.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                    <IconLoader2 className="size-4 animate-spin" />
                    {tc("loading")}
                  </div>
                ) : (
                  <>
                    <ApplicantSection
                      crewId={crewId}
                      titleKey="applicantSectionPending"
                      applicants={pending}
                      totalCount={applicationCounts.pending}
                      displays={displays}
                      canReview={!applicantReadUnavailable}
                      kind="pending"
                      t={t}
                    />
                    <ApplicantSection
                      crewId={crewId}
                      titleKey="applicantSectionApproved"
                      applicants={approved}
                      totalCount={applicationCounts.approved}
                      displays={displays}
                      kind="approved"
                      t={t}
                    />
                    <ApplicantSection
                      crewId={crewId}
                      titleKey="applicantSectionRejected"
                      applicants={rejected}
                      totalCount={applicationCounts.rejected}
                      displays={displays}
                      kind="rejected"
                      t={t}
                    />
                  </>
                )}
                {!applicationInbox.isLoading &&
                !applicationInbox.isError &&
                applications.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                    {t("noApplicantsYet")}
                  </p>
                ) : null}
                {applicationInbox.hasNextPage && !applicationInbox.isError ? (
                  <Button
                    type="button"
                    variant="outline"
                    color="muted"
                    size="sm"
                    className="mt-3 w-full"
                    disabled={applicationInbox.isFetching}
                    onClick={() => void applicationInbox.fetchNextPage()}
                  >
                    {applicationInbox.isFetchingNextPage ? (
                      <IconLoader2 className="size-4 animate-spin" />
                    ) : null}
                    {tc("loadMore")}
                  </Button>
                ) : null}
              </Section>
            ) : null}
            {canManage && position.taskId && <PositionInvitationsPanel positionId={position.id} />}
          </SheetBody>

          {canManage ? (
            <SheetFooter className="border-t border-border bg-background/50 p-4">
              <div className="flex w-full items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  color="destructive"
                  size="sm"
                  onClick={() => {
                    if (!pendingAction.current) setConfirmDelete(true);
                  }}
                  disabled={busy}
                >
                  <IconTrash className="size-3.5" />
                  {tc("delete")}
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    color="muted"
                    size="sm"
                    onClick={() => {
                      if (!pendingAction.current) setEditOpen(true);
                    }}
                    disabled={busy}
                  >
                    <IconPencil className="size-3.5" />
                    {t("editJobAction")}
                  </Button>
                  {isFrozen ? (
                    <Button
                      type="button"
                      variant="outline"
                      color="muted"
                      size="sm"
                      onClick={() => changeStatus("open")}
                      disabled={busy}
                    >
                      <IconLockOpen className="size-3.5" />
                      {t("unfreezeJob")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      color="muted"
                      size="sm"
                      onClick={() => {
                        if (!pendingAction.current) setConfirmFreeze(true);
                      }}
                      disabled={busy}
                    >
                      <IconLock className="size-3.5" />
                      {t("closeJob")}
                    </Button>
                  )}
                </div>
              </div>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Edit dialog — reuses CreateCrewJobDialog in edit mode
          (prefilled from `position`, submit hits useUpdatePosition,
          banner appears if applicants are pending). Conditional render
          rather than always-mounted so closing the sheet drops the
          dialog's local state too. */}
      {canManage && editOpen ? (
        <CreateCrewJobDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          crewId={crewId}
          editingPosition={position}
        />
      ) : null}

      {/* Confirm freeze */}
      <AlertDialog
        open={canManage && confirmFreeze}
        onOpenChange={(next) => {
          if (!pendingAction.current) setConfirmFreeze(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("closeJob")}</AlertDialogTitle>
            <AlertDialogDescription>{t("closeJobConfirm", { name: label })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="solid"
              color="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                changeStatus("frozen");
              }}
            >
              {busy ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {tc("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm delete */}
      <AlertDialog
        open={canManage && confirmDelete}
        onOpenChange={(next) => {
          if (!pendingAction.current) setConfirmDelete(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("positionDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {applicationCounts.pending > 0
                ? t("positionDeleteBlocked", { pending: applicationCounts.pending })
                : t("positionDeleteConfirm", { name: label })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="solid"
              color="destructive"
              disabled={busy || applicantReadUnavailable || applicationCounts.pending > 0}
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
            >
              {busy ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Section primitives ─────────────────────────────────────

function Section({
  title,
  children,
  defaultExpanded = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  void defaultExpanded;
  return (
    <section className="border-b border-border/60 py-4 last:border-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
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
      <span className="rounded-full border border-muted-foreground/30 bg-muted-foreground/10 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
        {t("statusFrozen")}
      </span>
    );
  }
  if (isFull) {
    return (
      <span className="rounded-full border border-green-400/30 bg-green-400/10 px-2 py-0.5 text-[10px] font-semibold text-green-400">
        {t("statusFull")}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
      {t("statusRecruiting")}
    </span>
  );
}

function MetaChip({
  icon: Icon,
  children,
  highlight,
}: {
  icon: typeof IconMapPin;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5",
        highlight
          ? "border-amber-400/30 bg-amber-400/10 text-amber-400"
          : "border-border bg-secondary/40 text-muted-foreground"
      )}
    >
      <Icon className="size-3" />
      {children}
    </span>
  );
}

// ─── Applicant grouped list ─────────────────────────────────

function ApplicantSection({
  crewId,
  titleKey,
  applicants,
  totalCount,
  displays,
  kind,
  canReview = true,
  t,
}: {
  crewId: string;
  titleKey: string;
  applicants: CrewApplicationDTO[];
  totalCount: number;
  displays: Map<string, LookupUserDTO>;
  kind: "pending" | "approved" | "rejected";
  canReview?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  if (applicants.length === 0) return null;
  return (
    <div className="mb-3 last:mb-0">
      <div
        className={cn(
          "mb-1.5 text-[11px] font-semibold uppercase tracking-wider",
          kind === "pending"
            ? "text-amber-400"
            : kind === "approved"
              ? "text-green-400"
              : "text-rose-400"
        )}
      >
        {t(titleKey, { count: totalCount })}
      </div>
      <div className="space-y-1.5">
        {applicants.map((a) => (
          <ApplicantRow
            key={a.id}
            crewId={crewId}
            applicant={a}
            displays={displays}
            canReview={canReview}
            kind={kind}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

function ApplicantRow({
  crewId,
  applicant,
  displays,
  kind,
  canReview,
  t,
}: {
  crewId: string;
  applicant: CrewApplicationDTO;
  displays: Map<string, LookupUserDTO>;
  kind: "pending" | "approved" | "rejected";
  canReview: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const locale = useLocale();
  const approve = useApproveApplication(crewId);
  const reject = useRejectApplication(crewId);
  const alive = useRef(false);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const decide = (decision: "approve" | "reject") => {
    if (
      !alive.current ||
      pending.current ||
      !canReview ||
      kind !== "pending" ||
      applicant.status !== "pending"
    )
      return;
    pending.current = true;
    setBusy(true);
    const mutation = decision === "approve" ? approve : reject;
    mutation.mutate(applicant.id, {
      onError: (error) => {
        if (alive.current)
          surfaceErr(
            error,
            t(decision === "approve" ? "reviewDialogApproveFailed" : "reviewDialogRejectFailed")
          );
      },
      onSettled: () => {
        if (!alive.current) return;
        pending.current = false;
        setBusy(false);
      },
    });
  };
  const lookup = displays.get(applicant.applicantId);
  const displayName = displayNameOf(applicant.applicantId, displays);
  const initial = (lookup?.nickname?.trim() || applicant.applicantId).charAt(0).toUpperCase();

  // Borderless per DESIGN.md — bg-secondary lifts the row enough.
  return (
    <div className="rounded-lg bg-secondary/40 p-2.5">
      <div className="flex items-start gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-foreground">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-foreground">{displayName}</span>
            {applicant.yearsExperience != null ? (
              <Tag>{t("applicantYears", { count: applicant.yearsExperience })}</Tag>
            ) : null}
            {applicant.expectedCompensation ? (
              <Tag highlight>
                {t("applicantExpected")}{" "}
                {formatMoney(
                  applicant.expectedCompensation.amount,
                  applicant.expectedCompensation.currency
                )}
              </Tag>
            ) : null}
          </div>
          {applicant.message ? (
            <p className="mt-1 line-clamp-3 text-xs text-foreground/75">{applicant.message}</p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[11px]">
            {/* /creators/[id] is the canonical public profile (bio +
                works). /profile is the viewer's own page with no
                dynamic segment. */}
            <Link
              href={`/${locale}/creators/${encodeUserId(applicant.applicantId)}`}
              className="text-primary hover:underline"
            >
              {t("applicantProfile")}
            </Link>
            {applicant.portfolioUrl ? (
              <a
                href={applicant.portfolioUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {t("applicantPortfolio")}
              </a>
            ) : null}
            {applicant.availableStartDate ? (
              <span className="text-muted-foreground">
                {t("applicantAvailable")} {applicant.availableStartDate}
              </span>
            ) : null}
          </div>
        </div>
        {kind === "pending" ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="soft"
              color="success"
              size="xs"
              disabled={busy || !canReview}
              onClick={() => decide("approve")}
            >
              <IconCheck className="size-3" />
              {t("approve")}
            </Button>
            <Button
              type="button"
              variant="soft"
              color="destructive"
              size="xs"
              disabled={busy || !canReview}
              onClick={() => decide("reject")}
            >
              <IconX className="size-3" />
              {t("reject")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Tag({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px]",
        highlight
          ? "border-amber-400/30 bg-amber-400/10 text-amber-400"
          : "border-border bg-secondary/50 text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

function formatMoney(amount: number, currency: CurrencyCode): string {
  const display = ZERO_DECIMAL_CURRENCIES.has(currency) ? amount : amount / 100;
  const compact =
    display >= 1000
      ? `${(display / 1000).toFixed(display % 1000 === 0 ? 0 : 1)}K`
      : String(display);
  return `${CURRENCY_SYMBOLS[currency]}${compact}`;
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

function surfaceMessage(err: unknown, fallback: string): string {
  if (err instanceof CrewApiError) {
    return typeof err.body === "object" && err.body && "message" in err.body
      ? String((err.body as { message: unknown }).message)
      : err.message;
  }
  return err instanceof Error ? err.message : fallback;
}
