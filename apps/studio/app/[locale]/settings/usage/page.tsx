"use client";

import { WorkspaceSettingsGate } from "../_components/workspace-settings-gate";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { IconBolt } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/app/_components/auth-provider";
import { useMyEntitlement } from "@/app/_components/entitlement-context";
import { useComputeWalletBalance } from "@/app/_components/credits-badge";
import { SubscriptionDialog } from "@/app/_components/subscription-dialog";
import { useActiveWorkspace } from "@/app/_components/workspace-context";
import { PageHeader, Panel } from "../_components/settings-ui";
import { openSettings } from "@/lib/settings-hash";
import { CurrentPlanPanel } from "../_components/current-plan-panel";

/**
 * Usage — plan + compute credits + the plan's generation limits, in one place.
 * Everything here is REAL, server-backed data: the plan/limits come from the
 * entitlement snapshot (GET /aurora/billing/entitlement/me), credits from the
 * compute_point wallet. We deliberately do NOT render "% used" bars against the
 * daily caps: studio doesn't yet expose per-limit consumption, and faking the
 * ratio would be worse than showing the honest cap. (A usage-summary endpoint
 * would unlock real bars later.)
 */
export default function UsageSettingsPage() {
  const t = useTranslations("settings");
  return (
    <WorkspaceSettingsGate title={t("usageTitle")}>
      <UsageSettingsPageContent />
    </WorkspaceSettingsGate>
  );
}
function UsageSettingsPageContent() {
  const t = useTranslations("settings");
  const common = useTranslations("common");
  const { user } = useAuth();
  const workspace = useActiveWorkspace();
  const canManageBilling =
    workspace?.role === "owner" || workspace?.role === "admin" || workspace?.role === "billing";
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const {
    data: credits,
    error,
    isFetching,
    refetch,
  } = useComputeWalletBalance(Boolean(user && workspace), workspace?.id);
  const { data } = useMyEntitlement();

  const limits = data?.entitlement.limits;
  const available = credits?.available ?? null;
  const total = credits?.total ?? null;

  const unlimited = t("limitUnlimited");
  const fmtLimit = (value: number | null) => (value == null ? unlimited : value.toLocaleString());

  const limitRows = limits
    ? [
        { label: t("limitConcurrentJobs"), value: fmtLimit(limits.concurrentJobs) },
        { label: t("limitImageDaily"), value: fmtLimit(limits.imageDaily) },
        { label: t("limitVideoDaily"), value: fmtLimit(limits.videoDaily) },
        { label: t("limitChatDaily"), value: fmtLimit(limits.chatDaily) },
        { label: t("limitQueuePriority"), value: String(limits.queuePriority) },
      ]
    : [];

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader title={t("usageTitle")} subtitle={t("usageSubtitle")} />

      <CurrentPlanPanel canManage={canManageBilling} onManagePlan={() => setUpgradeOpen(true)} />

      <Panel
        title={t("computeCredits")}
        icon={<IconBolt className="size-4 text-muted-foreground" />}
      >
        {error && (
          <div
            role="alert"
            className="mb-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
          >
            <span>{error.message || t("creditsLoadFailed")}</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {common("retry")}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-2xl font-semibold tabular-nums text-foreground">
              {available != null ? available.toLocaleString() : "—"}
            </div>
            {available != null && total != null && (
              <div className="mt-0.5 text-[13px] text-muted-foreground">
                {t("creditsRemaining", {
                  available: available.toLocaleString(),
                  total: total.toLocaleString(),
                })}
              </div>
            )}
          </div>
          {canManageBilling ? (
            <Button size="sm" onClick={() => openSettings("billing")}>
              {t("rechargeCredits")}
            </Button>
          ) : null}
        </div>
        {available != null && total != null && Number(total) > 0 && (
          <UsageBar available={available} total={total} className="mt-3" />
        )}
      </Panel>

      {limits && (
        <Panel title={t("planLimits")}>
          <p className="-mt-1 mb-1 text-[13px] text-muted-foreground">{t("planLimitsHint")}</p>
          <div className="divide-y divide-white/[0.06]">
            {limitRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between py-2.5">
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className="text-sm font-medium tabular-nums text-foreground">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <SubscriptionDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </main>
  );
}

/** Remaining-balance bar (available / total). Monochrome per DESIGN.md. */
function UsageBar({
  available,
  total,
  className,
}: {
  available: bigint;
  total: bigint;
  className?: string;
}) {
  const tot = Number(total);
  const pct = tot > 0 ? (Number(available) / tot) * 100 : 0;
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08] ${className ?? ""}`}>
      <div
        className="h-full rounded-full bg-foreground/70 transition-all"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}
