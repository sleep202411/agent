"use client";

import { WorkspaceSettingsGate } from "../_components/workspace-settings-gate";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useBillingWorkspace } from "@/app/_components/workspace-context";
import { SubscriptionDialog } from "@/app/_components/subscription-dialog";
import { PageHeader } from "../_components/settings-ui";
import { WorkspaceCreditsPanel } from "../_components/workspace-credits-panel";
import { RedeemVoucherPanel } from "../_components/redeem-voucher-panel";
import { CampaignsPanel } from "../_components/campaigns-panel";
import { CheckInCard } from "../_components/check-in-card";
import { CurrentPlanPanel } from "../_components/current-plan-panel";

/**
 * Plan & Billing — the compute-credit balance + recharge (and, for teams, the
 * shared-pool toggle) are real and wired via {@link WorkspaceCreditsPanel}. Per-user
 * membership plans remain in the subscription dialog.
 */
export default function BillingSettingsPage() {
  const t = useTranslations("settings");
  return (
    <WorkspaceSettingsGate title={t("planAndBilling")}>
      <BillingSettingsPageContent />
    </WorkspaceSettingsGate>
  );
}
function BillingSettingsPageContent() {
  const t = useTranslations("settings");
  // Payer-rule mirror: the page always shows/recharges the pot the user pays
  // from — team pot when a team is active, otherwise the user's OWN personal
  // pot (never a host workspace they were invited into).
  const ws = useBillingWorkspace();
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const canManageBilling = ws?.role === "owner" || ws?.role === "admin" || ws?.role === "billing";

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader title={t("planAndBilling")} subtitle={t("billingSubtitle")} />

      {ws && <WorkspaceCreditsPanel ws={ws} />}

      <CheckInCard />

      <CampaignsPanel />

      <RedeemVoucherPanel />

      <CurrentPlanPanel
        canManage={canManageBilling}
        onManagePlan={() => setSubscriptionOpen(true)}
      />

      <SubscriptionDialog open={subscriptionOpen} onOpenChange={setSubscriptionOpen} />
    </main>
  );
}
