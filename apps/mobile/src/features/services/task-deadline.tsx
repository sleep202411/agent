import { useEffect, useState } from "react";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
export function taskDeadlineState(
  dueAt: string | null,
  status: string,
  now: number,
  warningHours = 72
) {
  const due = dueAt ? Date.parse(dueAt) : NaN;
  if (!Number.isFinite(due) || ["approved", "cancelled", "submitted"].includes(status)) return null;
  const remaining = due - now;
  return {
    state:
      remaining < 0
        ? ("overdue" as const)
        : remaining <= warningHours * 3_600_000
          ? ("soon" as const)
          : ("upcoming" as const),
    hours: Math.max(1, Math.ceil(Math.abs(remaining) / 3_600_000)),
  };
}
type Props = { dueAt: string | null; status: string; warningHours?: number };
export function TaskDeadline(props: Props) {
  const active = useScreenActive();
  return active ? <Clock {...props} /> : null;
}
export function TaskStateLabel(props: Props & { label: string }) {
  const active = useScreenActive();
  return active ? <Clock {...props} /> : <ThemedText type="small">{props.label}</ThemedText>;
}
function Clock({ dueAt, status, warningHours = 72, label }: Props & { label?: string }) {
  const t = useTranslations();
  const [now, setNow] = useState(() => Date.now());
  const live =
    !!dueAt &&
    Number.isFinite(Date.parse(dueAt)) &&
    status !== "approved" &&
    status !== "cancelled" &&
    status !== "submitted";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [live]);
  const value = taskDeadlineState(dueAt, status, now, warningHours);
  if (label !== undefined) {
    const text =
      value?.state === "overdue"
        ? t("crewDeadline.overdueLabel")
        : status === "revision_requested"
          ? label
          : value?.state === "soon"
            ? t("crewDeadline.urgentLabel")
            : label;
    return <ThemedText type="small">{text}</ThemedText>;
  }
  return value ? (
    <ThemedText>{` · ${t(`crewDeadline.${value.state}`).replace("{count}", String(value.hours))}`}</ThemedText>
  ) : null;
}
