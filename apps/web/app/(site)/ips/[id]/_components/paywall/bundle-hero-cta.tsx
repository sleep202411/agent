"use client";

/**
 * Top-of-page "buy the whole IP" hero card. The dominant CTA on a
 * monetized IP — viewer's eye lands here before scanning the episode
 * list, so the framing matters more than the episode chips.
 *
 * Hides when:
 *   • paywall is inactive (no-paywall / owner-bypass)
 *   • bundle wasn't enabled by the creator
 *   • current viewer already owns the bundle (in which case the
 *     episode chips already say "整套 ✓ 解锁" — no need to re-CTA)
 */

import { useState } from "react";
import { IconCheck, IconCoin, IconInfinity, IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { usePricing } from "./pricing-context";
import { UnlockConfirmDialog } from "./unlock-confirm-dialog";

export function BundleHeroCta() {
  const t = useTranslations("paywall");
  const { state, bundle } = usePricing();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (state !== "active" || !bundle) return null;

  if (bundle.owned) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border border-violet-400/30 bg-violet-400/5 px-5 py-4",
          "animate-in fade-in slide-in-from-top-2 duration-300"
        )}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-violet-400/15 text-violet-400">
          <IconCheck className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{t("bundleOwnedTitle")}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{t("bundleOwnedSubtitle")}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "group relative overflow-hidden rounded-2xl border border-amber-400/30",
          "bg-gradient-to-br from-amber-500/[0.08] via-orange-500/[0.05] to-rose-500/[0.04]",
          "px-5 py-5 transition-colors hover:border-amber-400/60"
        )}
      >
        {/* Decorative sparkles in the corner. Hidden on small screens
            to keep the CTA tight on phones. */}
        <IconSparkles
          className="absolute right-5 top-5 hidden size-5 text-amber-400/40 sm:block"
          aria-hidden
        />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              {t("bundleEyebrow")}
            </div>
            <h3 className="mt-1 text-lg font-bold text-foreground sm:text-xl">
              {t("bundleTitle")}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <IconInfinity className="size-3.5 text-amber-400/80" />
                {t("bundlePermanent")}
              </span>
              <span className="inline-flex items-center gap-1">
                <IconSparkles className="size-3.5 text-amber-400/80" />
                {t("bundleCoversFuture")}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full bg-amber-400 px-5 py-2.5 text-sm font-semibold text-amber-950",
              "transition-transform hover:scale-[1.02] hover:bg-amber-300 active:scale-[0.98]",
              "shadow-lg shadow-amber-500/20"
            )}
          >
            <IconCoin className="size-4" />
            <span className="tabular-nums">{t("bundleBuyCta", { price: bundle.price })}</span>
          </button>
        </div>
      </div>

      <UnlockConfirmDialog mode="bundle" open={confirmOpen} onOpenChange={setConfirmOpen} />
    </>
  );
}
