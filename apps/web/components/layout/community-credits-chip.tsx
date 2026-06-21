"use client";

/**
 * Wallet entry point in the site-wide nav — a liquid-glass popover that
 * surfaces BOTH credit ledgers in one place:
 *
 *  - 算力积分 (compute credits)   — the studio currency spent on AI image /
 *                                   video generation. Balance via useCredits;
 *                                   top-up via CreditsRechargeDialog (studio).
 *  - 社区积分 (community credits)  — spent unlocking paid IP content; earned
 *                                   when a creator's work sells. Balance via
 *                                   useCommunityPointBalance; top-up via
 *                                   CommunityRechargeDialog. Still BETA.
 *
 * The surface uses a frosted-glass treatment (backdrop blur + saturate with a
 * hairline highlight) so the wallet reads as a distinct, premium affordance.
 * Records / earn stay coming-soon until their backing surfaces ship.
 */

import { useRef, useState } from "react";
import {
  IconBolt,
  IconCoins,
  IconCrown,
  IconReceipt2,
  IconRocket,
  IconSparkles,
} from "@tabler/icons-react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { useCommunityPointBalance } from "@/src/lib/ip-commerce";
import { useCredits } from "@/src/hooks/use-user";
import { useMembershipPreview } from "@/src/hooks/use-membership-preview";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CommunityRechargeDialog } from "@/components/payment/community-recharge-dialog";
import { CommunityMembershipDialog } from "@/components/payment/community-membership-dialog";
import { CreditsRechargeDialog } from "@/components/payment/credits-recharge-dialog";
import { cn } from "@/lib/utils";

interface CommunityCreditsChipProps {
  /** Compact mode for the mobile drawer (full-width rows, no popover). */
  layout?: "chip" | "row";
  className?: string;
}

export function CommunityCreditsChip({ layout = "chip", className }: CommunityCreditsChipProps) {
  const t = useTranslations("communityCredits");
  const tp = useTranslations("payment");
  const [open, setOpen] = useState(false);
  const [communityRechargeOpen, setCommunityRechargeOpen] = useState(false);
  const [studioRechargeOpen, setStudioRechargeOpen] = useState(false);
  const [membershipOpen, setMembershipOpen] = useState(false);

  const { balance: communityBalance, refetch: refetchCommunity } = useCommunityPointBalance();
  const { data: creditsData } = useCredits();
  const studioBalance = Number.isFinite(Number(creditsData)) ? Number(creditsData) : 0;
  // Preview-gated until membership benefits (Phases 2–5) ship.
  const membershipPreview = useMembershipPreview();

  const scopeRef = useRef<HTMLDivElement>(null);

  // Re-runs on each open: the popover content mounts only when `open` flips to
  // true, so the refs aren't in the DOM until then.
  useGSAP(
    () => {
      if (!scopeRef.current) return;
      gsap.from("[data-anim]", {
        y: 10,
        opacity: 0,
        duration: 0.4,
        stagger: 0.07,
        ease: "power2.out",
      });
    },
    { scope: scopeRef, dependencies: [open] }
  );

  const openCommunityRecharge = () => {
    setOpen(false);
    setCommunityRechargeOpen(true);
  };
  const openStudioRecharge = () => {
    setOpen(false);
    setStudioRechargeOpen(true);
  };
  const openMembership = () => {
    setOpen(false);
    setMembershipOpen(true);
  };
  const onComingSoon = () => {
    toast.info(t("comingSoonToast"));
    setOpen(false);
  };

  const dialogs = (
    <>
      <CommunityRechargeDialog
        open={communityRechargeOpen}
        onOpenChange={setCommunityRechargeOpen}
        onSuccess={() => refetchCommunity().then(() => {})}
      />
      <CreditsRechargeDialog open={studioRechargeOpen} onOpenChange={setStudioRechargeOpen} />
      <CommunityMembershipDialog
        open={membershipOpen}
        onOpenChange={setMembershipOpen}
        onSuccess={() => refetchCommunity().then(() => {})}
      />
    </>
  );

  if (layout === "row") {
    // Mobile drawer — two stacked wallet rows; tapping a row jumps straight
    // to that ledger's top-up (the action a balance-hunting mobile user wants).
    return (
      <>
        <div className={cn("space-y-1", className)}>
          <WalletRow
            icon={<IconBolt className="size-4" />}
            label={t("studioLabel")}
            balance={studioBalance}
            onClick={openStudioRecharge}
          />
          <WalletRow
            icon={<IconCoins className="size-4" />}
            label={t("label")}
            balance={communityBalance}
            onClick={openCommunityRecharge}
          />
          {membershipPreview && (
            <button
              type="button"
              onClick={openMembership}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <IconCrown className="size-4" />
              {tp("communityMembershipTitle")}
            </button>
          )}
        </div>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("walletAria", { studio: studioBalance, community: communityBalance })}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-sm font-medium text-muted-foreground backdrop-blur-md transition-colors hover:bg-white/10 hover:text-foreground",
              className
            )}
          >
            <span className="inline-flex items-center gap-1">
              <IconBolt className="size-3.5 text-amber-500 dark:text-amber-400" />
              <span className="tabular-nums">{studioBalance}</span>
            </span>
            <span className="h-3.5 w-px bg-border" />
            <span className="inline-flex items-center gap-1">
              <IconCoins className="size-3.5 text-primary" />
              <span className="tabular-nums">{communityBalance}</span>
            </span>
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          sideOffset={10}
          className={cn(
            // Liquid-glass surface — override the solid popover bg with a
            // translucent, blurred, saturated panel.
            "relative w-80 overflow-hidden rounded-2xl border-white/15 bg-background/55 p-0",
            "shadow-2xl shadow-black/40 ring-1 ring-white/10 backdrop-blur-2xl backdrop-saturate-150",
            "dark:bg-background/45"
          )}
        >
          {/* Hairline top highlight. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
          />

          <div ref={scopeRef} className="relative z-10">
            <div className="flex items-center justify-between px-4 pt-3.5">
              <span className="text-sm font-semibold text-foreground">{t("title")}</span>
            </div>

            <div className="space-y-2.5 px-3 py-3">
              <WalletCard
                icon={<IconBolt className="size-4" />}
                iconWrapClass="bg-amber-500/15 text-amber-500 dark:text-amber-400"
                label={t("studioLabel")}
                balance={studioBalance}
                unit={t("unit")}
                blurb={t("studioBlurb")}
                rechargeLabel={t("recharge")}
                onRecharge={openStudioRecharge}
              />
              <WalletCard
                icon={<IconCoins className="size-4" />}
                iconWrapClass="bg-primary/15 text-primary"
                label={t("label")}
                balance={communityBalance}
                unit={t("unit")}
                blurb={t("blurb")}
                rechargeLabel={t("recharge")}
                onRecharge={openCommunityRecharge}
              />
            </div>

            <div className="flex items-center justify-between border-t border-white/10 px-3 py-2">
              {membershipPreview && (
                <FooterAction
                  icon={<IconCrown className="size-3.5" />}
                  label={tp("communityMembershipTitle")}
                  onClick={openMembership}
                />
              )}
              <FooterAction
                icon={<IconReceipt2 className="size-3.5" />}
                label={t("records")}
                onClick={onComingSoon}
              />
              <FooterAction
                icon={<IconSparkles className="size-3.5" />}
                label={t("earn")}
                onClick={onComingSoon}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {dialogs}
    </>
  );
}

function WalletCard({
  icon,
  iconWrapClass,
  label,
  balance,
  unit,
  blurb,
  badge,
  rechargeLabel,
  onRecharge,
}: {
  icon: React.ReactNode;
  iconWrapClass: string;
  label: string;
  balance: number | string;
  unit: string;
  blurb: string;
  badge?: string;
  rechargeLabel: string;
  onRecharge: () => void;
}) {
  return (
    <div
      data-anim
      className="relative overflow-hidden rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm transition-colors hover:bg-white/[0.07]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={cn("grid size-6 shrink-0 place-items-center rounded-lg", iconWrapClass)}
            >
              {icon}
            </span>
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            {badge ? <BetaBadge label={badge} /> : null}
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-2xl font-bold tabular-nums text-foreground">{balance}</span>
            <span className="text-[11px] text-muted-foreground">{unit}</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{blurb}</p>
        </div>
        <button
          type="button"
          onClick={onRecharge}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-foreground ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/20"
        >
          <IconRocket className="size-3.5" />
          {rechargeLabel}
        </button>
      </div>
    </div>
  );
}

function FooterAction({
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
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
    >
      {icon}
      {label}
    </button>
  );
}

function WalletRow({
  icon,
  label,
  balance,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  balance: number | string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
    >
      <span className="inline-flex items-center gap-3">
        {icon}
        {label}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="tabular-nums">{balance}</span>
        {badge ? <BetaBadge label={badge} /> : null}
      </span>
    </button>
  );
}

function BetaBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {label}
    </span>
  );
}
