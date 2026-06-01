"use client";

/**
 * Community-credits entry point in the site-wide nav. Shows the live
 * user balance and a popover with recharge / records / earn actions.
 *
 * Recharge is wired through CreditsRechargeDialog — same dialog used
 * by the studio nav, paywall, user menu, etc. Single source of truth
 * so packages / pricing / checkout flow stay consistent everywhere
 * credits get bought.
 *
 * Records / earn / openWallet are still coming-soon: a wallet history
 * surface doesn't exist yet, the earn paths (referrals / promotions)
 * land later, and there's no standalone wallet page to "open" to. The
 * BETA badge stays until those ship.
 *
 * Visual treatment is intentionally neutral (muted-foreground, no
 * color accent). Matches the rhythm of the other nav glyphs (theme
 * toggle, language, user guide) so the chip reads as "another tool
 * affordance" rather than competing with the Studio CTA's red bloom
 * or the paywall amber accents elsewhere on the page.
 */

import Link from "next/link";
import { useState } from "react";
import { IconCoins, IconReceipt2, IconRocket, IconSparkles } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { useCommunityPointBalance } from "@/src/lib/ip-commerce";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CommunityRechargeDialog } from "@/components/payment/community-recharge-dialog";
import { cn } from "@/lib/utils";

interface CommunityCreditsChipProps {
  /** Compact mode for the mobile drawer (full-width row, no popover). */
  layout?: "chip" | "row";
  className?: string;
}

export function CommunityCreditsChip({ layout = "chip", className }: CommunityCreditsChipProps) {
  const t = useTranslations("communityCredits");
  const [open, setOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const { balance, refetch } = useCommunityPointBalance();

  const openRecharge = () => {
    setOpen(false);
    setRechargeOpen(true);
  };

  // Records / earn / openWallet aren't wired yet — surfaces don't
  // exist. Toast keeps the affordance discoverable without lying
  // about coverage.
  const onComingSoon = () => {
    toast.info(t("comingSoonToast"));
    setOpen(false);
  };

  const dialog = (
    <CommunityRechargeDialog
      open={rechargeOpen}
      onOpenChange={setRechargeOpen}
      onSuccess={() => void refetch()}
    />
  );

  if (layout === "row") {
    // Mobile-drawer treatment — same neutral row aesthetic as the
    // other entries in the drawer (Profile / Logout / theme / etc.).
    // Tapping the row goes straight to recharge (the action a user
    // hunting their balance in mobile is most likely after).
    return (
      <>
        <button
          type="button"
          onClick={openRecharge}
          className={cn(
            "flex w-full items-center justify-between rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
            className
          )}
        >
          <span className="inline-flex items-center gap-3">
            <IconCoins className="size-4" />
            {t("label")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="tabular-nums">{balance}</span>
            <BetaBadge label={t("betaTag")} />
          </span>
        </button>
        {dialog}
      </>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("ariaLabel", { balance })}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
              className
            )}
          >
            <IconCoins className="size-4" />
            <span className="tabular-nums">{balance}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          {/* Header — balance + beta badge. Neutral card surface; no
              gradient, no accent. */}
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("label")}
              </span>
              <BetaBadge label={t("betaTag")} />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <IconCoins className="size-5 self-center text-foreground" />
              <span className="text-2xl font-bold tabular-nums text-foreground">{balance}</span>
              <span className="text-xs text-muted-foreground">{t("unit")}</span>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{t("blurb")}</p>
          </div>

          {/* Actions — recharge is live; the other two remain stubs
              until their backing surfaces ship. */}
          <div className="p-1">
            <ActionRow
              icon={<IconRocket className="size-4" />}
              label={t("recharge")}
              onClick={openRecharge}
            />
            <ActionRow
              icon={<IconReceipt2 className="size-4" />}
              label={t("records")}
              onClick={onComingSoon}
            />
            <ActionRow
              icon={<IconSparkles className="size-4" />}
              label={t("earn")}
              onClick={onComingSoon}
            />
          </div>

          <div className="border-t border-border px-3 py-2">
            <Link
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onComingSoon();
              }}
              className="block text-center text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("openWallet")}
            </Link>
          </div>
        </PopoverContent>
      </Popover>
      {dialog}
    </>
  );
}

function BetaBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border bg-foreground/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {label}
    </span>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-foreground/5"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}
