"use client";

import { useCurrentUser } from "@/src/hooks/use-user";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "@/src/i18n/i18n";
import { crewApi } from "../_hooks/api";

export function TaskUnreadMarker({ taskId }: { taskId: string }) {
  const t = useTranslations("crewTaskCenter");
  const { user } = useCurrentUser();
  const { data } = useQuery({
    queryKey: ["notifications", "crew-task-unread", user?.id ?? null],
    enabled: Boolean(user?.id),
    queryFn: () =>
      crewApi.get<Array<{ taskId: string; count: number }>>("/notifications/unread-crew-tasks"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const count = data?.find((item) => item.taskId === taskId)?.count ?? 0;
  if (!count) return null;
  const label = t("unreadNotifications", { count });
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className="ml-2 inline-flex shrink-0 items-center gap-1 text-xs text-primary"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
      <span aria-hidden="true">{count}</span>
    </span>
  );
}
