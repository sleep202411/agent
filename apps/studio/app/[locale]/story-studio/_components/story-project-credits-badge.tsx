"use client";

import { IconBolt } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { GlassRim } from "@/components/ui/glass-rim";
import { getStoryBillingBalance, storyBillingBalanceQueryKey } from "@/lib/story-projects-api";
import { openSettings } from "@/lib/settings-hash";

function formatPoints(value: string | undefined): string {
  if (!value || !/^\d+$/.test(value)) return "—";
  return BigInt(value).toLocaleString();
}

/**
 * Project-payer balance for Story Studio. The server resolves the billing
 * subject, so this never follows the shell's active Workspace by accident.
 */
export function StoryProjectCreditsBadge({ projectId }: { projectId: string }) {
  const t = useTranslations("shell");
  const balanceQuery = useQuery({
    queryKey: storyBillingBalanceQueryKey(projectId),
    queryFn: () => getStoryBillingBalance(projectId),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const balance = balanceQuery.data;
  const title = balance
    ? t("credits.tooltipDetailed", {
        available: formatPoints(balance.availablePoints),
        held: formatPoints(balance.heldPoints),
        total: formatPoints(balance.totalPoints),
      })
    : t("credits.tooltip");

  return (
    <button
      type="button"
      onClick={() => openSettings("billing")}
      aria-label={t("credits.manage")}
      title={title}
      className="relative inline-flex h-9 items-center gap-1.5 rounded-[14px] bg-white/[0.06] px-3 text-xs font-semibold text-white/82 tabular-nums backdrop-blur-md backdrop-saturate-150 transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
    >
      <GlassRim />
      <IconBolt className="size-4" stroke={1.8} />
      {formatPoints(balance?.availablePoints)}
    </button>
  );
}
