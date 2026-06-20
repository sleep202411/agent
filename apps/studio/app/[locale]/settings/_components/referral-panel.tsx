"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { IconCheck, IconCopy, IconUserPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { bindReferralCode, getMyReferral, type ReferralInvitee } from "@/lib/billing";
import { computeWalletBalanceQueryKey } from "@/app/_components/credits-badge";
import { useAuth } from "@/app/_components/auth-provider";
import { Panel } from "./settings-ui";

const MY_REFERRAL_KEY = ["fizzstudio", "billing", "my-referral"] as const;

/** A masked, privacy-preserving label for an invitee's opaque user id. */
function maskInvitee(id: string): string {
  return id.length <= 4 ? `#${id}` : `#${id.slice(-4)}`;
}

/**
 * Invite friends — shows the caller's referral code + a shareable link + their
 * invite stats, and (if they haven't redeemed one) lets them enter a friend's
 * code. Both sides earn compute credits once the invitee makes their first paid
 * order; qualification is re-checked server-side on every read here.
 */
export function ReferralPanel() {
  const t = useTranslations("settings");
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: MY_REFERRAL_KEY,
    queryFn: () => getMyReferral(),
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    // Prefill the "enter a code" field from a ?ref= invite link (client-only).
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) setCodeInput(ref.toUpperCase());
  }, []);

  if (!data?.enabled) return null;

  const inviteLink = origin ? `${origin}/?ref=${data.code}` : data.code;

  async function copy(value: string, which: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      toast.success(t("referral.copied"));
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error(t("referral.copied"));
    }
  }

  async function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = codeInput.trim().toUpperCase();
    if (!trimmed || applying) return;
    setApplying(true);
    try {
      await bindReferralCode(trimmed);
      toast.success(t("referral.applySuccess"));
      setCodeInput("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MY_REFERRAL_KEY }),
        queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("referral.applyError"));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Panel
      title={t("referral.title")}
      icon={<IconUserPlus className="size-4 text-muted-foreground" />}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t("referral.subtitle", {
            referrer: data.referrerReward.toLocaleString(),
            referee: data.refereeReward.toLocaleString(),
          })}
        </p>

        {/* Code + invite link */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-white/[0.04] px-4 py-3">
            <p className="text-xs text-muted-foreground">{t("referral.yourCode")}</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="font-mono text-lg font-semibold tracking-widest text-foreground">
                {data.code}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => copy(data.code, "code")}
                aria-label={t("referral.copyCode")}
              >
                {copied === "code" ? (
                  <IconCheck className="size-4" />
                ) : (
                  <IconCopy className="size-4" />
                )}
              </Button>
            </div>
          </div>
          <div className="rounded-xl bg-white/[0.04] px-4 py-3">
            <p className="text-xs text-muted-foreground">{t("referral.inviteLink")}</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-sm text-foreground/80">{inviteLink}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => copy(inviteLink, "link")}
                aria-label={t("referral.copyLink")}
              >
                {copied === "link" ? (
                  <IconCheck className="size-4" />
                ) : (
                  <IconCopy className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t("referral.statInvited")} value={data.stats.invited} />
          <Stat label={t("referral.statRewarded")} value={data.stats.rewarded} />
          <Stat
            label={t("referral.statEarned")}
            value={data.stats.creditsEarned.toLocaleString()}
          />
        </div>

        {/* Invitee list */}
        {data.invitees.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {t("referral.inviteesTitle")}
            </p>
            <ul className="flex flex-col gap-1.5">
              {data.invitees.map((invitee) => (
                <InviteeRow
                  key={invitee.refereeUserId}
                  invitee={invitee}
                  pendingLabel={t("referral.statusPending")}
                  rewardedLabel={t("referral.statusRewarded", {
                    amount: invitee.reward.toLocaleString(),
                  })}
                />
              ))}
            </ul>
          </div>
        ) : null}

        {/* Enter a code (or show the one already redeemed) */}
        <div className="border-t border-white/[0.06] pt-4">
          {data.redeemed ? (
            <div className="text-sm">
              <p className="text-foreground/90">
                {t("referral.redeemedNote", { code: data.redeemed.code })}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {data.redeemed.status === "rewarded"
                  ? t("referral.redeemedRewarded")
                  : t("referral.redeemedPending")}
              </p>
            </div>
          ) : (
            <form onSubmit={apply} className="flex flex-col gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">{t("referral.haveCode")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("referral.haveCodeSubtitle")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={codeInput}
                  onChange={(event) => setCodeInput(event.target.value)}
                  placeholder={t("referral.codePlaceholder")}
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="h-9 w-48 rounded-lg bg-white/[0.06] px-3 font-mono text-sm uppercase tracking-wide text-foreground placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                />
                <Button type="submit" disabled={applying || !codeInput.trim()} className="shrink-0">
                  {t("referral.apply")}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function InviteeRow({
  invitee,
  pendingLabel,
  rewardedLabel,
}: {
  invitee: ReferralInvitee;
  pendingLabel: string;
  rewardedLabel: string;
}) {
  const rewarded = invitee.status === "rewarded";
  return (
    <li className="flex items-center justify-between gap-4 rounded-lg bg-white/[0.03] px-3 py-2">
      <span className="font-mono text-xs text-muted-foreground">
        {maskInvitee(invitee.refereeUserId)}
      </span>
      <span
        className={
          rewarded ? "text-xs font-medium text-foreground" : "text-xs text-muted-foreground"
        }
      >
        {rewarded ? rewardedLabel : pendingLabel}
      </span>
    </li>
  );
}
