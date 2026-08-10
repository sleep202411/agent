"use client";

/**
 * UpgradeDialog — modal shown after a 429 from QuotaGuard.
 *
 * Mounted once at the app shell via <UpgradeDialogHost/>. Any code
 * path that hits a quota-exceeded response calls `emitUpgrade(...)`
 * (or relies on the api-client 429 interceptor), and the host renders
 * the dialog with the structured payload.
 *
 * The dialog stays intentionally lightweight — it explains the cause
 * (今日 X/Y 张图额度用完) and presents the next tier's numbers + a
 * CTA. The actual purchase flow is owned by membership / billing
 * elsewhere; this component just calls back into it.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UpgradeDialog as MembershipUpgradeDialog } from "@/components/payment/upgrade-dialog";
import {
  dismissUpgrade,
  subscribeUpgrade,
  type UpgradePayload,
} from "@/src/lib/quota/upgrade-dialog-store";

function humanizeReset(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "现在";
  const min = Math.floor(ms / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function UpgradeDialogHost() {
  const [payload, setPayload] = useState<UpgradePayload | null>(null);
  const [membershipOpen, setMembershipOpen] = useState(false);
  const t = useTranslations("quota");

  useEffect(() => subscribeUpgrade(setPayload), []);

  const close = () => {
    setPayload(null);
    dismissUpgrade();
  };

  // MembershipUpgradeDialog is rendered at the host's TOP level (not
  // inside the explainer's <Dialog>), so closing the explainer with
  // `setPayload(null)` doesn't unmount the membership modal mid-
  // transition. When the user clicks "Upgrade now":
  //   1. setMembershipOpen(true)  — schedule mount with open=true
  //   2. close()                  — wipe payload, explainer unmounts
  //   3. Membership stays mounted and visible (own React subtree).
  const label = payload ? t(`dimension.${payload.dimension}`) : "";
  const unit = payload ? t(`unit.${payload.dimension}`) : "";
  const isUnlimitedNext = payload?.nextTierLimit != null && payload.nextTierLimit < 0;
  const nextLimitNumber =
    payload == null
      ? null
      : isUnlimitedNext
        ? "∞"
        : payload.nextTierLimit == null
          ? null
          : String(payload.nextTierLimit);

  return (
    <>
      {payload ? (
        <Dialog open onOpenChange={(o) => !o && close()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("upgradeDialog.title", { label })}</DialogTitle>
              <DialogDescription>
                {t("upgradeDialog.subtitle", {
                  used: payload.used,
                  limit: payload.limit,
                  unit,
                  resetIn: humanizeReset(payload.resetAt),
                })}
              </DialogDescription>
            </DialogHeader>

            {payload.nextTier && nextLimitNumber != null ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm">
                <div className="font-medium text-amber-400">
                  {isUnlimitedNext
                    ? t("upgradeDialog.nextTierPriority", {
                        tier: payload.nextTier,
                      })
                    : t("upgradeDialog.nextTier", {
                        tier: payload.nextTier,
                      })}
                </div>
                <div className="mt-1 text-muted-foreground">
                  {isUnlimitedNext
                    ? t("upgradeDialog.nextTierBodyUnlimited")
                    : t("upgradeDialog.nextTierBody", {
                        limit: nextLimitNumber,
                        unit,
                      })}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-700/40 bg-zinc-800/30 p-3 text-sm text-muted-foreground">
                {t("upgradeDialog.topTierBody")}
              </div>
            )}

            <DialogFooter className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                {t("upgradeDialog.later")}
              </Button>
              {payload.nextTier ? (
                <Button
                  onClick={() => {
                    setMembershipOpen(true);
                    close();
                  }}
                >
                  {t("upgradeDialog.upgradeNow")}
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {/* Mounted at host root so closing the explainer doesn't tear it
          down mid-open-transition. package fetch + payment QR live
          inside this dialog. */}
      <MembershipUpgradeDialog open={membershipOpen} onOpenChange={setMembershipOpen} />
    </>
  );
}
