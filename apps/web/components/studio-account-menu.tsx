"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  IconBell,
  IconBolt,
  IconChevronRight,
  IconCopy,
  IconCrown,
  IconFileInvoice,
  IconLogout,
  IconPlug,
  IconPlus,
  IconRefresh,
  IconShieldCheck,
  IconUser,
  IconWallet,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { CreditsRechargeDialog } from "@/components/payment/credits-recharge-dialog";
import { UpgradeDialog } from "@/components/payment/upgrade-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { backendApi, type Paginated } from "@/src/lib/api";
import { encodeUserId } from "@/src/lib/user-id-codec";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useLogout } from "@/src/hooks/use-logout";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAppDispatch, useAppSelector } from "@/src/store";
import {
  setCredits,
  setCreditsLoading,
  setIntegralRecords,
  setIntegralRecordsLoading,
  touchCredits,
} from "@/src/store/slices/userSlice";
import type { IntegralRecord } from "@/src/types/workspace";

type StudioAccountMenuProps = {
  className?: string;
  showStoreButton?: boolean;
  showStatusDot?: boolean;
  onCreateTeam?: () => void;
  triggerMode?: "full" | "avatar";
};

type CreditRecordType = "consume" | "gift" | "recharge" | "unknown";

function parseCreditValue(data: Record<string, unknown> | null | undefined): number {
  const value = Number(
    data?.scoreBalance ?? data?.score ?? data?.credits ?? data?.integral ?? data?.value ?? 0
  );
  return Number.isFinite(value) ? value : 0;
}

function recordTypeOf(record: IntegralRecord): CreditRecordType {
  switch (String(record.recordType)) {
    case "1":
      return "recharge";
    case "2":
      return "consume";
    case "3":
      return "gift";
    default:
      return "unknown";
  }
}

function aiRecordLabel(record: IntegralRecord): string {
  if (record.aiName) return String(record.aiName);
  if (record.modelCode) return String(record.modelCode);
  if (record.apiPath) {
    return String(record.apiPath).split("/").filter(Boolean).pop() ?? "";
  }
  return "";
}

function maskAccount(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  if (clean.includes("@")) {
    const [name, domain] = clean.split("@");
    if (!name || !domain) return clean;
    return `${name.slice(0, 2)}***@${domain}`;
  }
  if (clean.length <= 6) return clean;
  return `${clean.slice(0, 3)}****${clean.slice(-4)}`;
}

function isPaidMember(level: string | undefined) {
  if (!level) return false;
  const normalized = level.toLowerCase();
  return (
    normalized.includes("vip") || normalized.includes("member") || normalized.includes("creator")
  );
}

export function StudioAccountMenu({
  className,
  showStoreButton = true,
  showStatusDot = true,
  onCreateTeam,
  triggerMode = "full",
}: StudioAccountMenuProps) {
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const logout = useLogout();
  const dispatch = useAppDispatch();
  const { user } = useCurrentUser();
  const credits = useAppSelector((state) => state.user.credits);
  const isCreditsLoading = useAppSelector((state) => state.user.isCreditsLoading);
  const creditsVersion = useAppSelector((state) => state.user.creditsVersion);
  const integralRecords = useAppSelector((state) => state.user.integralRecords);
  const isIntegralRecordsLoading = useAppSelector((state) => state.user.isIntegralRecordsLoading);
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const raw = user?.raw;
  const displayName =
    user?.nickname?.trim() || user?.email?.split("@")[0] || tc("accountMenuFallbackName");
  const accountLabel =
    maskAccount(String(raw?.phone ?? raw?.contact ?? user?.email ?? user?.id ?? displayName)) ||
    displayName;
  const level = user?.userLevel?.trim();
  const paidMember = isPaidMember(level);
  const membershipLabel = paidMember ? level : tc("accountMenuFreeUser");
  const displayCredits = Number.isFinite(credits) ? credits : 0;
  const publicUserId = encodeUserId(user?.id);
  const publicUserIdLabel =
    publicUserId.length > 12
      ? `${publicUserId.slice(0, 6)}...${publicUserId.slice(-4)}`
      : publicUserId;

  const refreshCredits = useCallback(async () => {
    dispatch(setCreditsLoading(true));
    try {
      const data = await backendApi.post<Record<string, unknown>>("/api/ai/record/myscore");
      dispatch(setCredits(parseCreditValue(data)));
    } catch (error) {
      console.error("[StudioAccountMenu] load credits failed:", error);
      dispatch(setCreditsLoading(false));
    }
  }, [dispatch]);

  const refreshRecords = useCallback(async () => {
    dispatch(setIntegralRecordsLoading(true));
    try {
      const data = await backendApi.post<Paginated<IntegralRecord>>(
        "/api/ai/record/integralrecord/list",
        { data: { page: 1, pageSize: 20 } }
      );
      dispatch(setIntegralRecords(data?.list ?? []));
    } catch (error) {
      console.error("[StudioAccountMenu] load credit records failed:", error);
      dispatch(setIntegralRecordsLoading(false));
    }
  }, [dispatch]);

  useEffect(() => {
    void refreshCredits();
  }, [creditsVersion, refreshCredits]);

  useEffect(() => {
    if (!open || !historyOpen) return;
    void refreshRecords();
  }, [historyOpen, open, refreshRecords]);

  const profileHref = localizePath("/profile", locale);
  const notificationsHref = localizePath("/notifications", locale);
  const assetsHref = localizePath("/fizzstudio", locale);

  const copyUserId = async () => {
    if (!publicUserId) return;
    try {
      await navigator.clipboard.writeText(publicUserId);
      toast.success(tc("accountMenuPublicIdCopied"));
    } catch {
      toast.error(tc("copyFailed"));
    }
  };

  const comingSoon = (label: string) => toast.info(tc("accountMenuComingSoon", { label }));

  const handleSuccessPayment = () => {
    dispatch(touchCredits());
    void refreshCredits();
  };

  const openUpgradeDialog = () => {
    setOpen(false);
    window.requestAnimationFrame(() => setUpgradeOpen(true));
  };

  return (
    <>
      <div className={cn("flex items-center gap-1.5", className)}>
        {showStoreButton ? (
          <button
            type="button"
            onClick={openUpgradeDialog}
            className="hidden h-9 items-center gap-2 rounded-xl border border-white/[0.1] bg-[#222225]/88 px-3 text-sm font-semibold text-cyan-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors hover:border-cyan-300/30 hover:bg-[#292a2e] hover:text-cyan-200 md:inline-flex"
          >
            <IconWallet className="size-4" />
            {tc("accountMenuMemberStore")}
          </button>
        ) : null}

        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            {triggerMode === "avatar" ? (
              <button
                type="button"
                className="relative flex size-10 items-center justify-center rounded-full border border-white/12 bg-[#202024] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors hover:border-white/22 hover:bg-[#28282d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/24"
                aria-label={tc("accountMenu")}
              >
                <UserAvatar
                  src={user?.avatar}
                  seed={user?.id ?? "me"}
                  name={displayName}
                  size={34}
                  className="ring-1 ring-white/12"
                />
                {showStatusDot ? (
                  <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-[#ff3b43] ring-2 ring-[#202024]" />
                ) : null}
              </button>
            ) : (
              <button
                type="button"
                className="group inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.1] bg-[#202024]/92 pl-2.5 pr-1 text-sm text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors hover:border-white/18 hover:bg-[#28282d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/24"
                aria-label={tc("accountMenu")}
              >
                <span className="hidden items-center gap-1.5 text-white/78 lg:inline-flex">
                  <IconCrown className="size-4 text-[#f7c75f]" />
                  <span>{tc("accountMenuMemberDeal")}</span>
                </span>
                <span className="hidden h-4 w-px bg-white/12 lg:block" aria-hidden />
                <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-white">
                  <IconBolt className="size-4 text-[#f7c75f]" />
                  {isCreditsLoading ? "..." : displayCredits.toLocaleString()}
                </span>
                <span className="relative ml-0.5">
                  <UserAvatar
                    src={user?.avatar}
                    seed={user?.id ?? "me"}
                    name={displayName}
                    size={30}
                    className="ring-1 ring-white/12"
                  />
                  {showStatusDot ? (
                    <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-[#ff3b43] ring-2 ring-[#202024]" />
                  ) : null}
                </span>
              </button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={12}
            className="z-[90] max-h-[calc(100vh-76px)] w-[min(430px,calc(100vw-24px))] overflow-y-auto rounded-[26px] border border-white/[0.12] bg-[#151516]/96 p-0 text-white shadow-[0_30px_90px_-42px_rgba(0,0,0,1),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl"
          >
            <div className="p-3">
              <div className="rounded-2xl bg-white/[0.055] p-3">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    src={user?.avatar}
                    seed={user?.id ?? "me"}
                    name={displayName}
                    size={52}
                    className="ring-1 ring-white/12"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-lg font-semibold leading-tight text-white">
                      {accountLabel}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-sm text-white/46">
                      <button
                        type="button"
                        onClick={copyUserId}
                        className="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-white/70"
                      >
                        <span>
                          {tc("accountMenuPublicId")} {publicUserIdLabel}
                        </span>
                        <IconCopy className="size-3.5 shrink-0" />
                      </button>
                      <span className="h-3 w-px bg-white/14" aria-hidden />
                      <button
                        type="button"
                        onClick={() => comingSoon(tc("accountMenuAccessKey"))}
                        className="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-white/70"
                      >
                        <span>{tc("accountMenuAccessKey")}</span>
                        <IconChevronRight className="size-3.5 shrink-0" />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onCreateTeam ?? (() => comingSoon(tc("accountMenuCreateTeam")))}
                    className="hidden shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-medium text-white/74 transition-colors hover:bg-white/[0.07] hover:text-white sm:inline-flex"
                  >
                    <IconPlus className="size-4" />
                    {tc("accountMenuCreateTeam")}
                  </button>
                </div>
              </div>

              <div className="mt-3 overflow-hidden rounded-2xl border border-[#3d321e]/70 bg-[#251f12]">
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="text-base font-semibold text-white">{membershipLabel}</div>
                    {paidMember && raw?.expireTime ? (
                      <div className="mt-1 text-xs text-white/46">
                        {tc("accountMenuExpiresAt", { value: String(raw.expireTime) })}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={openUpgradeDialog}
                    className="rounded-full bg-black/72 px-4 py-2 text-sm font-semibold text-[#ffe8b0] transition-colors hover:bg-black"
                  >
                    {paidMember ? tc("accountMenuRenewMember") : tc("accountMenuOpenMember")}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={openUpgradeDialog}
                  className="flex w-full items-center justify-between bg-white/[0.055] px-4 py-2.5 text-left text-sm text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white/78"
                >
                  <span className="truncate">{tc("accountMenuBenefit")}</span>
                  <span className="shrink-0">{tc("accountMenuViewMore")}</span>
                </button>
              </div>

              <div className="mt-3 rounded-2xl border border-white/[0.11] bg-white/[0.025] p-3">
                <div className="flex w-full items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setHistoryOpen((current) => !current)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-cyan-300">
                      <IconBolt className="size-4" />
                      {tc("accountMenuCreditBalance", {
                        value: isCreditsLoading ? "..." : displayCredits.toLocaleString(),
                      })}
                      <IconChevronRight
                        className={cn("size-4 transition-transform", historyOpen && "rotate-90")}
                      />
                    </div>
                    <div className="mt-1 text-sm text-white/48">
                      {tc("accountMenuGeneralCredits", {
                        value: isCreditsLoading ? "..." : displayCredits.toLocaleString(),
                      })}
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-2 text-sm text-white/58">
                    <button
                      type="button"
                      onClick={() => setRechargeOpen(true)}
                      className="transition-colors hover:text-white"
                    >
                      {tc("rechargeCredits")}
                    </button>
                    <span className="h-4 w-px bg-white/14" aria-hidden />
                    <button
                      type="button"
                      onClick={() => comingSoon(tc("accountMenuSpendOrder"))}
                      className="transition-colors hover:text-white"
                    >
                      {tc("accountMenuSpendOrder")}
                    </button>
                  </div>
                </div>

                {historyOpen ? (
                  <div className="mt-3 max-h-48 overflow-auto border-t border-white/[0.08] pt-2">
                    {isIntegralRecordsLoading ? (
                      <div className="flex h-20 items-center justify-center text-white/42">
                        <IconRefresh className="size-4 animate-spin" />
                      </div>
                    ) : integralRecords.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/[0.1] px-3 py-5 text-center text-sm text-white/38">
                        {tc("accountMenuNoCreditRecords")}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {integralRecords.map((record, index) => {
                          const change = Number(record.integralChange ?? record.integralCost ?? 0);
                          const type = recordTypeOf(record);
                          const aiLabel = type === "consume" ? aiRecordLabel(record) : "";
                          return (
                            <div
                              key={`${record.id ?? "record"}-${index}`}
                              className="rounded-xl bg-white/[0.035] px-3 py-2"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="truncate text-sm text-white/72">
                                  {tc(`accountMenuRecordType_${type}`)}
                                </span>
                                <span
                                  className={cn(
                                    "shrink-0 text-sm font-semibold tabular-nums",
                                    change > 0
                                      ? "text-emerald-300"
                                      : change < 0
                                        ? "text-red-300"
                                        : "text-white/42"
                                  )}
                                >
                                  {change > 0 ? `+${change}` : change}
                                </span>
                              </div>
                              {aiLabel ? (
                                <div className="mt-0.5 truncate text-xs text-white/42">
                                  {aiLabel}
                                </div>
                              ) : null}
                              {record.createTime ? (
                                <div className="mt-1 text-xs text-white/30">
                                  {String(record.createTime)}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="mt-3 rounded-2xl border border-white/[0.11] bg-white/[0.025] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-white/46">{tc("accountMenuStorage")}</div>
                    <div className="mt-1 text-xl font-semibold text-white">
                      0G <span className="text-sm font-normal text-white/44">/ 3G</span>
                    </div>
                  </div>
                  <Link
                    href={assetsHref}
                    onClick={() => setOpen(false)}
                    className="text-sm text-white/62 transition-colors hover:text-white"
                  >
                    {tc("accountMenuManageAssets")}
                  </Link>
                </div>
              </div>

              <div className="mt-3 space-y-1">
                <AccountMenuRow
                  href={profileHref}
                  icon={<IconUser />}
                  label={tc("accountMenuProfile")}
                />
                <AccountMenuRow
                  icon={<IconFileInvoice />}
                  label={tc("accountMenuBillingInvoices")}
                  onClick={() => comingSoon(tc("accountMenuBillingInvoices"))}
                />
                <AccountMenuRow
                  icon={<IconShieldCheck />}
                  label={tc("accountMenuWatermark")}
                  onClick={() => comingSoon(tc("accountMenuWatermark"))}
                />
                <AccountMenuRow
                  icon={<IconPlug />}
                  label={tc("accountMenuCliSkill")}
                  onClick={() => comingSoon(tc("accountMenuCliSkill"))}
                />
                <AccountMenuRow
                  href={notificationsHref}
                  icon={<IconBell />}
                  label={tc("accountMenuNotifications")}
                  badge="3"
                />
                <AccountMenuRow
                  danger
                  icon={<IconLogout />}
                  label={tc("logout")}
                  onClick={() => void logout()}
                />
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        onSuccess={handleSuccessPayment}
      />
      <CreditsRechargeDialog
        open={rechargeOpen}
        onOpenChange={setRechargeOpen}
        onSuccess={handleSuccessPayment}
      />
    </>
  );
}

function AccountMenuRow({
  badge,
  danger,
  href,
  icon,
  label,
  onClick,
}: {
  badge?: string;
  danger?: boolean;
  href?: string;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="flex size-8 items-center justify-center text-white/82 [&_svg]:size-5">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-base font-semibold">{label}</span>
      {badge ? (
        <span className="flex size-5 items-center justify-center rounded-full bg-[#ff3b43] text-xs font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </>
  );

  const classes = cn(
    "flex h-10 w-full items-center gap-2 rounded-xl px-2 text-left transition-colors",
    danger
      ? "text-white/82 hover:bg-red-500/10 hover:text-red-200"
      : "text-white/84 hover:bg-white/[0.06] hover:text-white"
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  );
}
