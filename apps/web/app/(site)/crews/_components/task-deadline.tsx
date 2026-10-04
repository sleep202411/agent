"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";

export function taskDeadlineState(
  dueAt: string | null,
  status: string,
  now: number,
  warningHours = 72
) {
  const due = dueAt ? Date.parse(dueAt) : NaN;
  if (!Number.isFinite(due)) return null;
  if (status === "approved" || status === "cancelled" || status === "submitted")
    return { state: "closed" as const, hours: 0 };
  const remaining = due - now;
  const hours = Math.max(1, Math.ceil(Math.abs(remaining) / 3_600_000));
  return {
    state:
      remaining < 0
        ? ("overdue" as const)
        : remaining <= warningHours * 3_600_000
          ? ("soon" as const)
          : ("upcoming" as const),
    hours,
  };
}

/** The clock refreshes visible deadline labels; it does not send notifications. */
export function TaskDeadline({
  dueAt,
  status,
  warningHours = 72,
}: {
  dueAt: string | null;
  status: string;
  warningHours?: number;
}) {
  const locale = useLocale();
  const t = useTranslations("crewDeadline");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const value = taskDeadlineState(dueAt, status, now, warningHours);
  if (!value || !dueAt) return null;
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dueAt));
  return (
    <time
      dateTime={dueAt}
      title={date}
      className={cn(
        "text-xs tabular-nums",
        value.state === "overdue"
          ? "text-red-300"
          : value.state === "soon"
            ? "text-amber-300"
            : "text-muted-foreground"
      )}
    >
      {date}
      {value.state !== "closed" ? ` · ${t(value.state, { count: value.hours })}` : ""}
    </time>
  );
}

/** Deadline signals take precedence over an active workflow label, never over a closed task. */
export function TaskStateBadge({
  dueAt,
  status,
  label,
  warningHours = 72,
}: {
  dueAt: string | null;
  status: string;
  label: string;
  warningHours?: number;
}) {
  const t = useTranslations("crewDeadline");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  // Submitted work is awaiting review, not an overdue delivery.
  const deadline =
    status === "submitted" ? null : taskDeadlineState(dueAt, status, now, warningHours);
  const overdue = deadline?.state === "overdue";
  const urgent = deadline?.state === "soon";
  return (
    <span
      className={cn(
        "rounded-full px-3 py-1 text-xs",
        overdue || status === "revision_requested"
          ? "bg-red-500/10 text-red-400"
          : urgent
            ? "bg-amber-500/10 text-amber-300"
            : status === "approved"
              ? "bg-green-500/10 text-green-400"
              : "bg-white/5 text-muted-foreground"
      )}
    >
      {overdue
        ? t("overdueLabel")
        : status === "revision_requested"
          ? label
          : urgent
            ? t("urgentLabel")
            : label}
    </span>
  );
}
