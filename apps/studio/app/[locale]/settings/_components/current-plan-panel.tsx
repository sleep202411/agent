"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconReceipt } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cancelSubscription } from "@/lib/billing";
import { formatEntitlementPlanName, useMyEntitlement } from "@/app/_components/entitlement-context";
import { useAuth } from "@/app/_components/auth-provider";
import { useActiveWorkspaceId } from "@/app/_components/workspace-context";
import { Panel } from "./settings-ui";

/**
 * The signed-in user's current plan + renews-on/cancel affordance. Replaces the
 * old "Manage plan → purchase dialog" stub that the FAQ pointed at as a manage
 * surface. The plan comes from the Nest entitlement snapshot; cancel + "renews
 * on" come from the active /aurora subscription (null when a plan was granted
 * which case we show the plan with no cancel button).
 */
type PlanPanelProps = { onManagePlan: () => void; canManage: boolean };
export function CurrentPlanPanel(props: PlanPanelProps) {
  const { queryKey, data } = useMyEntitlement();
  return (
    <CurrentPlanBody
      key={`${JSON.stringify(queryKey)}:${data?.subscription?.id ?? "none"}:${props.canManage}`}
      {...props}
    />
  );
}

function CurrentPlanBody({ onManagePlan, canManage }: PlanPanelProps) {
  const t = useTranslations("settings");
  const common = useTranslations("common");
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const { data, isLoading, isError, error, queryKey, isFetching, retry } = useMyEntitlement();

  const { user, isCurrentAccount } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const owner = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    owner.current = controller;
    return () => controller.abort();
  }, []);
  const isCurrent = () =>
    user?.id != null &&
    isCurrentAccount(user.id) &&
    owner.current != null &&
    !owner.current.signal.aborted;
  const cancel = useMutation({
    mutationFn: (id: string) => {
      if (!canManage || !isCurrent())
        throw new DOMException("Billing session changed", "AbortError");
      return cancelSubscription(id, workspaceId, owner.current!.signal);
    },
    onSuccess: (sub) => {
      if (!isCurrent()) return;
      const date = sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : null;
      toast.success(date ? t("cancelPlanSuccess", { date }) : t("cancelPlanSuccessNoDate"));
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      if (!isCurrent()) return;
      toast.error(error instanceof Error ? error.message : t("cancelPlanError"));
    },
  });

  const subscription = data?.subscription ?? null;
  const planKey = data?.entitlement.planKey ?? null;
  const planName =
    planKey === "free" ? t("freePlanName") : planKey ? formatEntitlementPlanName(planKey) : null;
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
  const cancelable = canManage && !!subscription && !ending && subscription.status === "active";

  return (
    <Panel
      title={t("yourSubscription")}
      icon={<IconReceipt className="size-4 text-muted-foreground" />}
      action={
        canManage ? (
          <Button variant="outline" size="sm" className="shrink-0" onClick={onManagePlan}>
            {t("managePlan")}
          </Button>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="h-10 w-40 animate-pulse rounded-md bg-white/[0.06]" />
      ) : isError || !planName ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
        >
          <span>{error?.message || t("planLoadError")}</span>
          <Button variant="secondary" size="sm" disabled={isFetching} onClick={retry}>
            {common("retry")}
          </Button>
        </div>
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
                  {t("keepPlan")}
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
