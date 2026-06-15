"use client";

import { useState } from "react";
import { IconCreditCard, IconReceipt } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/app/_components/workspace-context";
import { SubscriptionDialog } from "@/app/_components/subscription-dialog";
import { EmptyState, PageHeader, Panel, TeamBadge } from "../_components/settings-ui";

/**
 * Plan & Billing — team-level plans/credit pools have no backend yet, so that
 * section renders an honest empty state. Per-user subscription + credit packs
 * are real (the subscription dialog), surfaced here as the wired actions.
 */
export default function BillingSettingsPage() {
  const { activeWorkspace: ws } = useWorkspace();
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader
        title="Plan & Billing"
        badge={ws ? <TeamBadge label={ws.type === "personal" ? "Personal" : "Team"} /> : undefined}
        subtitle="Manage your subscription and credits."
      />

      <Panel title="Team plan" icon={<IconCreditCard className="size-4 text-muted-foreground" />}>
        <EmptyState
          icon={<IconCreditCard className="size-5" />}
          title="Team plans aren't available yet"
          body="Shared team plans and a team credit pool are coming. For now, manage your personal subscription and credits below."
        />
      </Panel>

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
