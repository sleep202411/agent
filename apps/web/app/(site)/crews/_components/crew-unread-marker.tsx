"use client";

import { useCurrentUser } from "@/src/hooks/use-user";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "@/src/i18n/i18n";
import { crewApi } from "../_hooks/api";

export function CrewUnreadMarker({ crewId }: { crewId: string }) {
  const t = useTranslations("crewTaskCenter");
  const { user } = useCurrentUser();
  const { data } = useQuery({
    queryKey: ["notifications", "crew-unread", user?.id ?? null],
    enabled: Boolean(user?.id),
    queryFn: () =>
      crewApi.get<Array<{ crewId: string; count: number }>>("/notifications/unread-crews"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const count = data?.find((item) => item.crewId === crewId)?.count ?? 0;
  if (!count) return null;
  const label = t("unreadCrewNotifications", { count });
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground"
    >
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
    </span>
  );
}
