"use client";

/**
 * QuotaBlocker — wraps an action button. Renders children unchanged
 * while the user has quota; turns the button into a disabled state
 * with an inline upgrade CTA when the daily cap is hit. The 80%
 * near-limit state shows a subtle warning chip beside the button.
 *
 *   <QuotaBlocker dimension="image" cost={1}>
 *     <Button>出图</Button>
 *   </QuotaBlocker>
 *
 * Phase 4 is UI-only — there is no `onUpgrade` callback yet; that
 * lands in Phase 5 with the UpgradeDialog. For now, the exhausted
 * state simply blocks the click and renders a quiet hint. Once the
 * dialog ships, this component will lift the click into the dialog
 * rather than swallowing it silently.
 */
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import type { QuotaDimension } from "@repo/shared";
import { useTranslations } from "@/src/i18n/i18n";
import { useQuota } from "@/src/lib/quota/use-quota";
import { cn } from "@/lib/utils";

export interface QuotaBlockerProps {
  dimension: QuotaDimension;
  /**
   * Cost the wrapped action consumes. Default 1 — same default as
   * QuotaService.consume. Use larger for batched actions (e.g.
   * a 4-image grid generation).
   */
  cost?: number;
  /**
   * Override what shows next to / instead of the button when blocked.
   * Default is a small "今日额度已用完" tooltip on hover.
   */
  blockedHint?: ReactNode;
  /**
   * If true, hide the warning chip even when ≥80%. Use when the
   * surrounding UI already renders a quota badge so we don't
   * double-render the same signal.
   */
  hideWarningChip?: boolean;
  children: ReactNode;
}

export function QuotaBlocker({
  dimension,
  cost = 1,
  blockedHint,
  hideWarningChip,
  children,
}: QuotaBlockerProps) {
  const q = useQuota(dimension);
  const t = useTranslations("quota");

  // Loading / unknown / unlimited → render children unchanged.
  if (q.loading || q.color === "gray" || q.unlimited) {
    return <>{children}</>;
  }

  const wouldExceed = !q.unlimited && q.used + cost > q.limit;
  const blocked = q.exhausted || wouldExceed;

  if (blocked) {
    // Inject `disabled` + `onClick: noop` into the (single) child
    // element if it looks button-shaped. Anything else just renders
    // greyed-out via opacity so the visual signal is consistent.
    const child = Children.only(children) as ReactNode;
    const disabledChild = isValidElement(child)
      ? cloneElement(child as ReactElement<DisableableProps>, {
          disabled: true,
          onClick: (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
          },
          "aria-disabled": true,
        })
      : child;
    return (
      <span
        className="inline-flex items-center gap-1.5"
        title={t("blocker.blockedTitle", {
          used: q.used,
          limit: q.limit,
          resetIn: q.resetIn ?? "",
        })}
      >
        {disabledChild}
        {blockedHint ?? (
          <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
            {t("blocker.fullChip")}
          </span>
        )}
      </span>
    );
  }

  if (q.near && !hideWarningChip) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {children}
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
            q.percent >= 80 ? "bg-amber-500/15 text-amber-400" : ""
          )}
          title={t("blocker.leftTitle", {
            remaining: q.remaining,
            limit: q.limit,
          })}
        >
          {t("blocker.leftChip", { n: q.remaining })}
        </span>
      </span>
    );
  }

  return <>{children}</>;
}

interface DisableableProps {
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  "aria-disabled"?: boolean;
}
