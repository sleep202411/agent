"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconReceipt } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cancelSubscription, getMyEntitlement } from "@/lib/billing";
import { getAssetsRealtimeKernel } from "@/lib/canvas-authoring/assets-realtime-kernel";
import { useActiveWorkspaceId } from "@/app/_components/workspace-context";
import { Panel } from "./settings-ui";

export const myEntitlementQueryKey = ["billing", "my-entitlement"] as const;

/**
 * The signed-in user's current plan + renews-on/cancel affordance. Replaces the
 * old "Manage plan → purchase dialog" stub that the FAQ pointed at as a manage
 * surface. The plan comes from the Nest entitlement snapshot; cancel + "renews
 * on" come from the active /aurora subscription (null for legacy VIP plans, in
 * which case we show the plan with no cancel button).
 */
export function CurrentPlanPanel({ onManagePlan }: { onManagePlan: () => void }) {
  const t = useTranslations("settings");
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: myEntitlementQueryKey,
    queryFn: getMyEntitlement,
    staleTime: 30_000,
  });

  // Realtime: refresh the plan when the entitlement changes server-side (order
  // fulfilled, refund revoke/restore, expiry) — personal or workspace scope.
  const workspaceId = useActiveWorkspaceId();
  useEffect(() => {
    const sub = getAssetsRealtimeKernel({
      workspaceId: workspaceId ?? undefined,
    }).subscribe({
      onEvent: (event) => {
        if (event.kind === "entitlement_changed") {
          void queryClient.invalidateQueries({ queryKey: myEntitlementQueryKey });
        }
      },
    });
    return () => sub.close();
  }, [workspaceId, queryClient]);

  const cancel = useMutation({
    mutationFn: (id: string) => cancelSubscription(id),
    onSuccess: (sub) => {
      const date = sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : null;
      toast.success(date ? t("cancelPlanSuccess", { date }) : t("cancelPlanSuccessNoDate"));
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: myEntitlementQueryKey });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("cancelPlanError"));
    },
  });

  const subscription = data?.subscription ?? null;
  const planKey = data?.entitlement.planKey ?? "free";
  const planName = planKey === "free" ? t("freePlanName") : titleCase(planKey);
  const periodEnd = subscription?.currentPeriodEnd
    ? formatDate(subscription.currentPeriodEnd)
    : null;
  // A subscription is "ending" when it's been canceled (or scheduled to) — show
  // "Access until X" instead of "Renews on X", and hide the cancel button.
  const ending =
    !!subscription &&
    (subscription.cancelAtPeriodEnd ||
      subscription.status === "canceled" ||
      subscription.status === "expired");
  const cancelable = !!subscription && !ending && subscription.status === "active";

  return (
    <Panel
      title={t("yourSubscription")}
      icon={<IconReceipt className="size-4 text-muted-foreground" />}
      action={
        <Button variant="outline" size="sm" className="shrink-0" onClick={onManagePlan}>
          {subscription ? t("changePlan") : t("managePlan")}
        </Button>
      }
    >
      {isLoading ? (
        <div className="h-10 w-40 animate-pulse rounded-md bg-white/[0.06]" />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-foreground">{planName}</span>
              {ending && (
                <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t("planCanceledBadge")}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {subscription
                ? [
                    `${formatMoneyMinor(subscription.amountMinor, subscription.currency)}/${subscription.interval}`,
                    periodEnd
                      ? ending
                        ? t("planAccessUntil", { date: periodEnd })
                        : t("planRenewsOn", { date: periodEnd })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : t("subscriptionDescription")}
            </p>
          </div>

          {cancelable &&
            (confirming ? (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-muted-foreground">{t("cancelPlanConfirm")}</span>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(subscription.id)}
                >
                  {t("cancelPlan")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={cancel.isPending}
                  onClick={() => setConfirming(false)}
                >
                  {t("managePlan")}
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => setConfirming(true)}
              >
                {t("cancelPlan")}
              </Button>
            ))}
        </div>
      )}
    </Panel>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMoneyMinor(amountMinor: string, currency: string): string {
  const amount = Number(amountMinor) / 100;
  if (Number.isNaN(amount)) return `${currency} —`;
  return `${currency} ${amount.toFixed(2)}`;
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
