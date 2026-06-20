"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconConfetti } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { claimCampaign, listActiveCampaigns, type ActiveCampaign } from "@/lib/billing";
import { computeWalletBalanceQueryKey } from "@/app/_components/credits-badge";
import { useAuth } from "@/app/_components/auth-provider";
import { Panel } from "./settings-ui";

const ACTIVE_CAMPAIGNS_KEY = ["fizzstudio", "billing", "active-campaigns"] as const;

/**
 * Active free-credits campaigns the user can claim (once each). Renders nothing
 * when there are none, so the billing page stays clean. Claiming credits the
 * personal-workspace pot and refreshes the balance.
 */
export function CampaignsPanel() {
  const t = useTranslations("settings");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ACTIVE_CAMPAIGNS_KEY,
    queryFn: () => listActiveCampaigns(),
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  const campaigns = data?.items ?? [];
  if (campaigns.length === 0) return null;

  async function claim(campaign: ActiveCampaign) {
    if (claimingId) return;
    setClaimingId(campaign.id);
    try {
      const result = await claimCampaign(campaign.id);
      const amount = Number(result.granted.amount).toLocaleString();
      toast.success(
        result.alreadyClaimed ? t("campaigns.alreadyClaimed") : t("campaigns.success", { amount })
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey }),
        queryClient.invalidateQueries({ queryKey: ACTIVE_CAMPAIGNS_KEY }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("campaigns.error"));
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <Panel
      title={t("campaigns.title")}
      icon={<IconConfetti className="size-4 text-muted-foreground" />}
    >
      <ul className="flex flex-col gap-2">
        {campaigns.map((campaign) => (
          <li
            key={campaign.id}
            className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.04] px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{campaign.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("campaigns.amount", {
                  amount: campaign.computeCreditAmount.toLocaleString(),
                })}
                {campaign.description ? ` · ${campaign.description}` : ""}
              </p>
            </div>
            <Button
              variant={campaign.claimed ? "outline" : "default"}
              disabled={campaign.claimed || claimingId === campaign.id}
              onClick={() => claim(campaign)}
              className="shrink-0"
            >
              {campaign.claimed ? t("campaigns.claimed") : t("campaigns.claim")}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
