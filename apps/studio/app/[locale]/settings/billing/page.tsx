"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { IconReceipt } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/app/_components/workspace-context";
import { SubscriptionDialog } from "@/app/_components/subscription-dialog";
import { PageHeader, Panel, TeamBadge } from "../_components/settings-ui";
import { TeamCreditsPanel } from "../_components/team-credits-panel";
import { RedeemVoucherPanel } from "../_components/redeem-voucher-panel";

/**
 * Plan & Billing — the compute-credit balance + recharge (and, for teams, the
 * shared-pool toggle) are real and wired via {@link TeamCreditsPanel}. Per-user
 * membership plans remain in the subscription dialog.
 */
export default function BillingSettingsPage() {
  const t = useTranslations("settings");
  const { activeWorkspace: ws } = useWorkspace();
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader
        title={t("planAndBilling")}
        badge={
          ws ? <TeamBadge label={ws.type === "personal" ? t("personal") : t("team")} /> : undefined
        }
        subtitle={t("billingSubtitle")}
      />

      {ws && <TeamCreditsPanel ws={ws} />}

      <RedeemVoucherPanel />

      <Panel
        title={t("yourSubscription")}
        icon={<IconReceipt className="size-4 text-muted-foreground" />}
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{t("subscriptionDescription")}</p>
          <Button className="shrink-0" onClick={() => setSubscriptionOpen(true)}>
            {t("managePlan")}
          </Button>
        </div>
      </Panel>

      <SubscriptionDialog open={subscriptionOpen} onOpenChange={setSubscriptionOpen} />
    </main>
  );
}
