"use client";

import { useState } from "react";
import { IconReceipt } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/app/_components/workspace-context";
import { SubscriptionDialog } from "@/app/_components/subscription-dialog";
import { PageHeader, Panel, TeamBadge } from "../_components/settings-ui";
import { TeamCreditsPanel } from "../_components/team-credits-panel";

/**
 * Plan & Billing — the compute-credit balance + recharge (and, for teams, the
 * shared-pool toggle) are real and wired via {@link TeamCreditsPanel}. Per-user
 * membership plans remain in the subscription dialog.
 */
export default function BillingSettingsPage() {
  const { activeWorkspace: ws } = useWorkspace();
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader
        title="Plan & Billing"
        badge={ws ? <TeamBadge label={ws.type === "personal" ? "Personal" : "Team"} /> : undefined}
        subtitle="Manage your credits and subscription."
      />

      {ws && <TeamCreditsPanel ws={ws} />}

      <Panel
        title="Your subscription"
        icon={<IconReceipt className="size-4 text-muted-foreground" />}
      >
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Manage your personal plan, buy credit packs, and view pricing.
          </p>
          <Button className="shrink-0" onClick={() => setSubscriptionOpen(true)}>
            Manage plan
          </Button>
        </div>
      </Panel>

      <SubscriptionDialog open={subscriptionOpen} onOpenChange={setSubscriptionOpen} />
    </main>
  );
}
