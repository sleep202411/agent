"use client";

import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import type { AssignmentStatus, EpisodeStatus } from "@/app/(site)/crews/_hooks/use-episodes";

const EP_COLORS: Record<EpisodeStatus, string> = {
  not_started: "border-border bg-secondary text-muted-foreground",
  in_production: "border-blue-400/30 bg-blue-400/10 text-blue-400",
  approved: "border-green-400/30 bg-green-400/10 text-green-400",
};

const ASSIGNMENT_COLORS: Record<AssignmentStatus, string> = {
  in_progress: "border-amber-400/30 bg-amber-400/10 text-amber-400",
  submitted: "border-blue-400/30 bg-blue-400/10 text-blue-400",
  approved: "border-green-400/30 bg-green-400/10 text-green-400",
  rejected: "border-red-400/30 bg-red-400/10 text-red-400",
};

const EP_LABEL: Record<EpisodeStatus, string> = {
  not_started: "epStatusNotStarted",
  in_production: "epStatusInProduction",
  approved: "epStatusApproved",
};

const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = {
  in_progress: "assignmentStatusInProgress",
  submitted: "assignmentStatusSubmitted",
  approved: "assignmentStatusApproved",
  rejected: "assignmentStatusRejected",
};

export function EpisodeStatusBadge({ status }: { status: EpisodeStatus }) {
  const t = useTranslations("workspace");
  return (
    <span
      className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", EP_COLORS[status])}
    >
      {t(EP_LABEL[status])}
    </span>
  );
}

export function AssignmentStatusBadge({ status }: { status: AssignmentStatus }) {
  const t = useTranslations("workspace");
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs font-semibold",
        ASSIGNMENT_COLORS[status]
      )}
    >
      {t(ASSIGNMENT_LABEL[status])}
    </span>
  );
}
