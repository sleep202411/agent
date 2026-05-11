"use client";

/**
 * Inline applicant list for the recruitment tab's accordion. Handles
 * its own loading / empty / error states so the parent row can mount
 * it lazily on expand without juggling that lifecycle itself.
 *
 * Owner sees Approve / Reject buttons on pending rows; non-owners
 * see a read-only roster. Approve/reject mutations are still pointed
 * at the mock implementations in `use-applications.ts` — when backend
 * ships the real endpoints (likely `/project/crew/job/apply/agree`
 * and `.../reject`), swap the mutationFn there and this component
 * doesn't need to change.
 */

import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { ossUrl } from "@/src/lib/asset-paths";
import { UserAvatar } from "@/components/user-avatar";
import {
  useJobApplicants,
  useAgreeApplicant,
  useRejectApplicant,
  type ApplicationStatus,
} from "@/app/(site)/crews/_hooks/use-crew";

interface JobApplicantsListProps {
  jobId: number;
  /** Owner sees action buttons; members see the roster only. */
  canManage: boolean;
}

const STATUS_CHIP: Record<ApplicationStatus, { labelKey: string; className: string }> = {
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

export function JobApplicantsList({ jobId, canManage }: JobApplicantsListProps) {
  const t = useTranslations("workspace");
  const { data: applicants = [], isLoading, isError } = useJobApplicants(jobId);
  const agree = useAgreeApplicant(jobId);
  const reject = useRejectApplicant(jobId);

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

  return (
    <div className="divide-y divide-border/60">
      {applicants.map((a) => {
        const chip = STATUS_CHIP[a.status];
        const busy =
          (agree.isPending && agree.variables === a.id) ||
          (reject.isPending && reject.variables?.applicantId === a.id);
        return (
          <div key={a.id} className="flex items-start gap-3 py-3">
            <UserAvatar
              src={a.userAvatar?.startsWith("http") ? a.userAvatar : ossUrl(a.userAvatar)}
              seed={a.userId}
              name={a.userName}
              className="size-9 shrink-0"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {a.userName || `#${a.userId}`}
                </span>
                {a.level ? (
                  <span className="text-[11px] text-muted-foreground">{a.level}</span>
                ) : null}
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                    chip.className
                  )}
                >
                  {t(chip.labelKey)}
                </span>
                {a.appliedAt ? (
                  <span className="text-[11px] text-muted-foreground">{a.appliedAt}</span>
                ) : null}
              </div>
              {a.message ? (
                <p className="line-clamp-3 text-xs text-foreground/75">{a.message}</p>
              ) : null}
              {a.portfolioUrl ? (
                <a
                  href={a.portfolioUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-primary hover:underline"
                >
                  {t("viewPortfolio")}
                </a>
              ) : null}
            </div>
            {canManage && a.status === "pending" ? (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => agree.mutate(a.id)}
                  className="flex items-center gap-1 rounded-md border border-green-400/30 bg-green-400/10 px-2 py-1 text-xs font-semibold text-green-400 transition-colors hover:bg-green-400/20 disabled:opacity-50"
                >
                  <IconCheck className="size-3.5" />
                  {t("approve")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => reject.mutate({ applicantId: a.id })}
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
  );
}
