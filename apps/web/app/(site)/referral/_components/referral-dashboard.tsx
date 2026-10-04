"use client";

/**
 * Invite-reward dashboard body. Server-owned copy: milestone/reward titles
 * and subtitles come from the API verbatim; the only client-side formatting
 * is the typed reward VALUE (cash / points / membership-days), handled by an
 * exhaustive switch — no prefix matching, no fabricated units.
 */
import Link from "next/link";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import {
  IconCheck,
  IconCircleDashed,
  IconCopy,
  IconGift,
  IconLoader2,
  IconLock,
  IconShare2,
  IconUsers,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import {
  claimReferralReward,
  fetchReferralDashboard,
  referralKeys,
  type ReferralMilestone,
  type ReferralPayoutType,
  type ReferralReward,
  type ReferralRewardStatus,
} from "../_hooks/api";

function formatMoney(minor: string, currency: string, locale: string): string {
  const value = Number(minor);
  if (!Number.isFinite(value)) return `${currency} —`;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value / 100);
  } catch {
    return `${currency} ${(value / 100).toFixed(2)}`;
  }
}

function sumMinor(a: string, b: string): string {
  try {
    return (BigInt(a) + BigInt(b)).toString();
  } catch {
    return "0";
  }
}

/** Typed reward value → display string. Exhaustive on purpose: an unknown
 *  payout type renders nothing rather than a mislabeled number. */
function rewardValueLabel(
  entry: {
    payoutType: ReferralPayoutType;
    amountMinor: string;
    days: number;
    currency: string | null;
  },
  t: (key: string, values?: Record<string, string | number>) => string,
  locale: string
): string | null {
  switch (entry.payoutType) {
    case "cash":
      return entry.currency ? `+${formatMoney(entry.amountMinor, entry.currency, locale)}` : null;
    case "points_compute":
      return t("valuePointsCompute", { count: entry.amountMinor });
    case "points_community":
      return t("valuePointsCommunity", { count: entry.amountMinor });
    case "membership_compute":
      return t("valueMembershipCompute", { days: entry.days });
    case "membership_community":
      return t("valueMembershipCommunity", { days: entry.days });
    case "membership_both":
      return t("valueMembershipBoth", { days: entry.days });
    default:
      return null;
  }
}

/** The bundle is authoritative; flat fields describe only its primary reward. */
function rewardBundleLabel(
  entry: ReferralMilestone | ReferralReward,
  currency: string | null,
  t: Parameters<typeof rewardValueLabel>[1],
  locale: string
): string | null {
  if (!entry.items?.length) return rewardValueLabel(entry, t, locale);
  return (
    entry.items
      .map((item) =>
        rewardValueLabel(
          {
            payoutType: item.kind,
            amountMinor: item.amountMinor,
            days: item.days,
            currency: item.currency ?? entry.currency ?? currency,
          },
          t,
          locale
        )
      )
      .filter((label): label is string => label !== null)
      .join("\n") || null
  );
}

const STATUS_KEY: Record<ReferralRewardStatus, string> = {
  pending: "statusPending",
  qualified: "statusQualified",
  accrued: "statusAccrued",
  reversed: "statusReversed",
  voided: "statusVoided",
  paid_out: "statusPaidOut",
};

export function ReferralDashboardPage({ embedded = false }: { embedded?: boolean }) {
  const { user } = useCurrentUser();
  if (!user) return null;
  return <AccountReferralDashboard key={user.id} accountId={user.id} embedded={embedded} />;
}

function AccountReferralDashboard({
  accountId,
  embedded,
}: {
  accountId: string;
  embedded: boolean;
}) {
  const t = useTranslations("referral");
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const {
    data: dashboard,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: referralKeys.account(accountId),
    queryFn: ({ signal }) => fetchReferralDashboard(signal),
  });

  const claim = useMutation({
    mutationFn: claimReferralReward,
    onMutate: () => setClaimError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: referralKeys.account(accountId) });
    },
    onError: (err: Error) => {
      // Surface the backend message verbatim (house error-reporting rule).
      setClaimError(err.message);
    },
  });

  const cashTotals = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.cashTotals?.length
      ? dashboard.cashTotals
      : [{ currency: dashboard.currency, ...dashboard.totals }];
  }, [dashboard]);

  const cashLabel = (key: "pendingMinor" | "confirmedMinor" | "total") =>
    cashTotals
      .map((row) => {
        const value = key === "total" ? sumMinor(row.pendingMinor, row.confirmedMinor) : row[key];
        return row.currency ? formatMoney(value, row.currency, locale) : "—";
      })
      .join("\n");

  const copyInvite = useCallback(async () => {
    const text = dashboard?.inviteUrl;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions) — the field is selectable.
    }
  }, [dashboard]);

  const shareInvite = useCallback(async () => {
    if (!dashboard?.inviteUrl) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: t("shareTitle"), url: dashboard.inviteUrl });
        return;
      } catch {
        // Cancelled or unsupported payload — fall through to copy.
      }
    }
    await copyInvite();
  }, [copyInvite, dashboard, t]);

  if (isLoading) {
    return (
      <div className="flex h-[calc(100dvh-56px)] items-center justify-center">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-24 text-center">
        <p className="text-lg font-semibold text-foreground">{t("loadErrorTitle")}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : ""}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-6 inline-flex h-10 items-center rounded-full bg-muted px-5 text-sm font-semibold text-foreground transition hover:bg-white/15"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  return (
    <div className={embedded ? "w-full p-4" : "mx-auto w-full max-w-5xl px-6 pb-24 pt-10"}>
      <header>
        <h1 className="text-3xl font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {!embedded && (
        <nav
          aria-label={t("incomeSources")}
          className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm"
        >
          <Link
            href={localizePath("/profile/earnings", locale)}
            className="text-primary hover:underline"
          >
            {t("workIncome")}
          </Link>
          <Link
            href={localizePath("/crews/income", locale)}
            className="text-primary hover:underline"
          >
            {t("crewIncome")}
          </Link>
        </nav>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{t("incomeSourcesHint")}</p>

      {!dashboard.programAvailable ? (
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
          <p className="text-sm font-semibold text-foreground">{t("programUnavailableTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("programUnavailableBody")}</p>
        </div>
      ) : null}

      {/* Hero: cash headline (the typed rewards below carry their own values). */}
      <section className="relative mt-8 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-7 backdrop-blur-xl before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)]">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="min-w-[240px]">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <IconGift className="size-4" />
              {t("cashTotal")}
            </p>
            <p className="mt-3 whitespace-pre-line text-4xl font-semibold tabular-nums text-foreground">
              {cashLabel("total")}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{t("heroHint")}</p>

            <div className="mt-6 grid grid-cols-3 gap-3">
              {(
                [
                  ["statPending", cashLabel("pendingMinor"), true],
                  ["statConfirmed", cashLabel("confirmedMinor"), true],
                  ["statInvitees", String(dashboard.totals.inviteeCount), false],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="rounded-2xl bg-white/[0.04] px-4 py-3">
                  <p className="whitespace-pre-line text-lg font-semibold tabular-nums text-foreground">
                    {value}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{t(key)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="w-full max-w-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t("inviteCodeLabel")}
            </p>
            <div className="mt-3 rounded-2xl border border-dashed border-white/15 bg-black/20 px-5 py-4 text-center">
              <p className="font-mono text-2xl font-semibold tracking-[0.3em] text-foreground">
                {dashboard.inviteCode ?? "········"}
              </p>
              {dashboard.inviteUrl ? (
                <p className="mt-2 break-all text-[11px] text-muted-foreground">
                  {dashboard.inviteUrl}
                </p>
              ) : null}
            </div>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => void copyInvite()}
                disabled={!dashboard.inviteUrl}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-muted text-sm font-semibold text-foreground transition hover:bg-white/15 disabled:opacity-40"
              >
                <IconCopy className="size-4" />
                {copied ? t("copied") : t("copy")}
              </button>
              <button
                type="button"
                onClick={() => void shareInvite()}
                disabled={!dashboard.inviteUrl}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-white transition hover:bg-primary-hover disabled:opacity-40"
              >
                <IconShare2 className="size-4" />
                {t("share")}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Milestones — admin-authored copy + server-computed status, verbatim. */}
      {dashboard.milestones.length > 0 ? (
        <section className="mt-12">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-base font-semibold text-foreground">{t("milestonesTitle")}</h2>
            <p className="text-xs text-muted-foreground">
              <IconUsers className="mr-1 inline size-3.5 align-[-2px]" />
              {t("milestonesInvitees", { count: dashboard.totals.inviteeCount })}
            </p>
          </div>
          <ol className="mt-4 space-y-2">
            {dashboard.milestones.map((milestone: ReferralMilestone) => {
              const value = rewardBundleLabel(milestone, dashboard.currency, t, locale);
              return (
                <li
                  key={milestone.id}
                  className={`flex flex-col gap-2 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center sm:gap-4 ${
                    milestone.status === "active"
                      ? "border-white/20 bg-white/[0.05]"
                      : "border-white/8 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-4 sm:items-center">
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-full ${
                        milestone.status === "complete"
                          ? "bg-white text-black"
                          : milestone.status === "active"
                            ? "bg-white/15 text-foreground"
                            : "bg-white/[0.06] text-muted-foreground"
                      }`}
                    >
                      {milestone.status === "complete" ? (
                        <IconCheck className="size-4" />
                      ) : milestone.status === "active" ? (
                        <IconCircleDashed className="size-4" />
                      ) : (
                        <IconLock className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {milestone.title}
                        <span className="ml-2 inline-block rounded-full bg-white/[0.07] px-2 py-0.5 align-middle text-[11px] font-medium text-muted-foreground">
                          {t("milestoneThreshold", { count: milestone.inviteeThreshold })}
                        </span>
                      </p>
                      {milestone.detail ? (
                        <p className="mt-1 text-xs text-muted-foreground">{milestone.detail}</p>
                      ) : null}
                    </div>
                  </div>
                  {value ? (
                    // Indent under the text column when stacked (icon 32 + gap 16).
                    <p className="whitespace-pre-line pl-12 text-sm font-semibold tabular-nums text-foreground sm:pl-0 sm:text-right">
                      {value}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {/* Rewards ledger. */}
      <section className="mt-12">
        <h2 className="text-base font-semibold text-foreground">{t("rewardsTitle")}</h2>
        {claimError ? <p className="mt-2 text-xs text-primary">{claimError}</p> : null}
        {dashboard.rewards.length === 0 ? (
          <div className="mt-4 grid min-h-[200px] place-items-center rounded-[8px] border border-white/10 bg-[#141416] text-center">
            <div>
              <p className="text-sm font-semibold text-foreground">{t("rewardsEmpty")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("rewardsEmptyHint")}</p>
            </div>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-white/8 rounded-[8px] border border-white/10 bg-[#141416]">
            {dashboard.rewards.map((reward: ReferralReward) => {
              const value = rewardBundleLabel(reward, dashboard.currency, t, locale);
              const isClaiming = claim.isPending && claim.variables === reward.id;
              return (
                <li
                  key={reward.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{reward.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {reward.subtitle ?? t(STATUS_KEY[reward.status])}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    {value ? (
                      <p className="whitespace-pre-line text-sm font-semibold tabular-nums text-foreground sm:text-right">
                        {value}
                      </p>
                    ) : null}
                    {reward.claimable ? (
                      <button
                        type="button"
                        onClick={() => claim.mutate(reward.id)}
                        disabled={claim.isPending}
                        className="inline-flex h-9 shrink-0 items-center rounded-full bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-hover disabled:opacity-50"
                      >
                        {isClaiming ? t("claiming") : t("claim")}
                      </button>
                    ) : (
                      <span className="shrink-0 rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-medium text-muted-foreground">
                        {t(STATUS_KEY[reward.status])}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
