import { useEffect, useState } from "react";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
export function taskDeadlineState(
  dueAt: string | null,
  status: string,
  now: number,
  warningHours = 48
) {
  const due = dueAt ? Date.parse(dueAt) : NaN;
  if (!Number.isFinite(due) || status === "approved" || status === "cancelled") return null;
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
function Clock({ dueAt, status, warningHours = 48 }: Props) {
  const t = useTranslations();
  const [now, setNow] = useState(() => Date.now());
  const live =
    !!dueAt &&
    Number.isFinite(Date.parse(dueAt)) &&
    status !== "approved" &&
    status !== "cancelled";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [live]);
  const value = taskDeadlineState(dueAt, status, now, warningHours);
  return value ? (
    <ThemedText>{` · ${t(`crewDeadline.${value.state}`).replace("{count}", String(value.hours))}`}</ThemedText>
  ) : null;
}
