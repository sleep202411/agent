"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconCalendarCheck, IconBolt } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dailyCheckIn, getCheckInStatus } from "@/lib/billing";
import { computeWalletBalanceQueryKey } from "@/app/_components/credits-badge";
import { useAuth } from "@/app/_components/auth-provider";
import { cn } from "@/lib/utils";
import { Panel } from "./settings-ui";

export const CHECK_IN_STATUS_KEY = ["fizzstudio", "billing", "check-in"] as const;

/**
 * Daily check-in (每日签到): streak count + reward-cycle strip + claim button.
 * Renders nothing when check-in is disabled or the user is signed out. Claiming
 * credits the personal-workspace pot and refreshes the balance.
 *
 * `compact` trims it to a single inline row for the home surface.
 */
export function CheckInCard({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("settings");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [claiming, setClaiming] = useState(false);

  const { data } = useQuery({
    queryKey: CHECK_IN_STATUS_KEY,
    queryFn: () => getCheckInStatus(),
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  if (!data?.enabled) return null;

  const todayIndex = (data.nextStreakDay - 1) % data.rewards.length;

  async function claim() {
    if (claiming || data?.checkedInToday) return;
    setClaiming(true);
    try {
      const result = await dailyCheckIn();
      const amount = Number(result.granted.amount).toLocaleString();
      toast.success(
        result.alreadyCheckedIn ? t("checkIn.alreadyToday") : t("checkIn.success", { amount })
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey }),
        queryClient.invalidateQueries({ queryKey: CHECK_IN_STATUS_KEY }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("checkIn.error"));
    } finally {
      setClaiming(false);
    }
  }

  const button = (
    <Button onClick={claim} disabled={data.checkedInToday || claiming} className="shrink-0">
      {data.checkedInToday
        ? t("checkIn.doneToday")
        : t("checkIn.claim", { amount: data.todayReward.toLocaleString() })}
    </Button>
  );

  const streakLine = (
    <p className="text-sm text-muted-foreground">
      {data.streak > 0 ? t("checkIn.streak", { days: data.streak }) : t("checkIn.start")}
    </p>
  );

  const cycle = (
    <div className="flex flex-wrap gap-1.5">
      {data.rewards.map((reward, i) => (
        <div
          key={i}
          className={cn(
            "flex min-w-12 flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-center",
            i === todayIndex && !data.checkedInToday
              ? "bg-white/[0.12] ring-1 ring-white/25"
              : "bg-white/[0.04]"
          )}
        >
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("checkIn.day", { n: i + 1 })}
          </span>
          <span className="flex items-center gap-0.5 text-xs font-medium tabular-nums text-foreground">
            <IconBolt className="size-3 text-white/70" stroke={1.8} />
            {reward.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-2xl bg-white/[0.04] px-4 py-3">
        <div className="flex items-center gap-3">
          <IconCalendarCheck className="size-5 text-white/70" stroke={1.7} />
          <div>
            <p className="text-sm font-medium text-foreground">{t("checkIn.title")}</p>
            {streakLine}
          </div>
        </div>
        {button}
      </div>
    );
  }

  return (
    <Panel
      title={t("checkIn.title")}
      icon={<IconCalendarCheck className="size-4 text-muted-foreground" />}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          {streakLine}
          {button}
        </div>
        {cycle}
      </div>
    </Panel>
  );
}
