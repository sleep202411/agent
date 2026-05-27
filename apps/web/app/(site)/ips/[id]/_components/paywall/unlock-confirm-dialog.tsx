"use client";

/**
 * Two-purpose confirmation dialog:
 *
 *   • `mode="episode"` — confirm buying access to a single episode.
 *     Shows episode number + title and the price breakdown.
 *
 *   • `mode="bundle"` — confirm buying the whole-IP bundle. Shows
 *     "永久持有 + 含未来更新" reassurance.
 *
 * Auto-flips to InsufficientCreditsPrompt when `credits < price`,
 * preserving the same dialog frame so the transition isn't jarring.
 *
 * Buy action is dispatched via the context hook — the dialog doesn't
 * know whether the click hits a real backend or a preview mock; that
 * decision lives in PricingProvider.
 */

import { useState } from "react";
import {
  IconAlertTriangle,
  IconCoin,
  IconInfinity,
  IconLoader2,
  IconLock,
  IconSparkles,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditsRechargeDialog } from "@/components/payment/credits-recharge-dialog";
import { cn } from "@/lib/utils";
import { usePricing } from "./pricing-context";

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface EpisodeModeProps extends BaseProps {
  mode: "episode";
  episode: { id: string; title?: string; number: number };
}

interface BundleModeProps extends BaseProps {
  mode: "bundle";
}

type Props = EpisodeModeProps | BundleModeProps;

export function UnlockConfirmDialog(props: Props) {
  const t = useTranslations("paywall");
  const { credits, bundle, episodeAccess, unlockEpisode, buyBundle } = usePricing();
  const [busy, setBusy] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);

  // Resolve target price based on mode.
  const price =
    props.mode === "bundle"
      ? (bundle?.price ?? 0)
      : (() => {
          const a = episodeAccess(props.episode.id);
          return a.kind === "locked" ? a.price : 0;
        })();

  const affordable = credits >= price;
  const remaining = credits - price;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      if (props.mode === "bundle") {
        await buyBundle();
      } else {
        await unlockEpisode(props.episode.id);
      }
      props.onOpenChange(false);
    } catch (err) {
      // Errors are toast'd inside the actions; keep the dialog open
      // so the user can retry if appropriate.
      console.error("[Paywall] purchase failed:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={props.open} onOpenChange={(o) => !busy && props.onOpenChange(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {affordable ? (
                <IconLock className="size-4 text-amber-400" />
              ) : (
                <IconAlertTriangle className="size-4 text-rose-400" />
              )}
              {props.mode === "bundle"
                ? affordable
                  ? t("confirmBundleTitle")
                  : t("insufficientCreditsTitle")
                : affordable
                  ? t("confirmEpisodeTitle", { n: props.episode.number })
                  : t("insufficientCreditsTitle")}
            </DialogTitle>
            <DialogDescription>
              {props.mode === "bundle"
                ? t("confirmBundleSubtitle")
                : props.episode.title
                  ? props.episode.title
                  : t("confirmEpisodeUntitled", { n: props.episode.number })}
            </DialogDescription>
          </DialogHeader>

          {/* Bundle-mode highlight strip. Reinforces "永久 + 含未来" so
              the viewer is confident they aren't buying a time-bomb. */}
          {props.mode === "bundle" ? (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-400">
              <span className="inline-flex items-center gap-1">
                <IconInfinity className="size-3.5" /> {t("bundlePermanent")}
              </span>
              <span className="inline-flex items-center gap-1">
                <IconSparkles className="size-3.5" /> {t("bundleCoversFuture")}
              </span>
            </div>
          ) : null}

          {/* Price breakdown card. Same layout regardless of affordability;
              the "remaining" row recolors red when going negative. */}
          <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3 text-sm">
            <Row
              label={t("breakdownPrice")}
              value={
                <span className="inline-flex items-center gap-1 font-semibold">
                  <IconCoin className="size-3.5 text-amber-400" />
                  <span className="tabular-nums">{price}</span>
                </span>
              }
            />
            <Row
              label={t("breakdownCurrentBalance")}
              value={<span className="tabular-nums text-muted-foreground">{credits}</span>}
            />
            <div className="h-px bg-border" />
            <Row
              label={affordable ? t("breakdownRemaining") : t("breakdownShortBy")}
              value={
                <span
                  className={cn(
                    "tabular-nums font-semibold",
                    affordable ? "text-foreground" : "text-rose-400"
                  )}
                >
                  {affordable ? remaining : Math.abs(remaining)}
                </span>
              }
            />
          </div>

          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              color="muted"
              onClick={() => props.onOpenChange(false)}
              disabled={busy}
            >
              {t("cancel")}
            </Button>
            {affordable ? (
              <Button
                type="button"
                variant="solid"
                color="primary"
                onClick={handleConfirm}
                disabled={busy}
              >
                {busy ? <IconLoader2 className="size-4 animate-spin" /> : null}
                {props.mode === "bundle" ? t("confirmBuyBundle") : t("confirmBuyEpisode")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="solid"
                color="primary"
                onClick={() => {
                  props.onOpenChange(false);
                  setRechargeOpen(true);
                }}
              >
                <IconCoin className="size-4" /> {t("topUpCta")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TODO: switch to kind="community" once pricing-context reads a
          real community-credits balance hook — today the affordability
          check still uses Studio's scoreBalance as a placeholder, so
          topping up community credits here would leave paywall
          permanently unaffordable. Keep the recharge side in sync with
          whichever ledger the check reads. */}
      <CreditsRechargeDialog open={rechargeOpen} onOpenChange={setRechargeOpen} />
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
