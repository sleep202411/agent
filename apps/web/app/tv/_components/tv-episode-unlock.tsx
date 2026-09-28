"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconLock } from "@tabler/icons-react";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { CommunityRechargeDialog } from "@/components/payment/community-recharge-dialog";
import { CommunityMembershipDialog } from "@/components/payment/community-membership-dialog";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { api, ApiRequestError } from "@/src/lib/api";
import type { IpAccess, CreateIpPurchaseInput } from "@/src/lib/ip-commerce/api";

/** An explicit, priced purchase action. Selecting a thumbnail never spends points. */
export function TvEpisodeUnlock({ ipId, episodeId }: { ipId: string; episodeId: string }) {
  const { user } = useCurrentUser();
  const auth = useAuthDialog();
  const locale = useLocale();
  const t = useTranslations("tv");
  const commerce = useTranslations("newIpDetail");
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [membershipOpen, setMembershipOpen] = useState(false);
  const inFlight = useRef(false);
  const requestKey = useRef<{ signature: string; key: string } | null>(null);
  const access = useQuery({
    queryKey: ["tv", "episode-access", ipId, episodeId, locale, user?.id ?? "guest"],
    queryFn: ({ signal }) =>
      api.get<IpAccess>(`/aurora/ip-commerce/ips/${encodeURIComponent(ipId)}/access`, {
        signal,
        params: { episodeIds: episodeId, locale },
      }),
    enabled: Boolean(user?.id),
    staleTime: 0,
    retry: false,
  });
  const entry = access.data?.episodes.find((item) => item.id === episodeId);
  // Package-only episodes have no individual quote; the package quote is
  // returned separately on the IP access entry.
  const price = entry?.price ?? access.data?.ip?.price;
  const amount = price?.memberAmount ?? price?.amount;
  const pending = entry?.access.startsWith("pending_unlock");
  const granted =
    entry && ["free", "free_preview", "owned", "owned_ip", "owned_episode"].includes(entry.access);
  const memberFree = entry?.access === "member_free";
  const memberLocked = entry?.access === "member_locked";
  const balance = access.data?.wallet?.availableBalance;
  const insufficient =
    !memberFree &&
    amount != null &&
    balance != null &&
    /^\d+$/.test(amount) &&
    /^\d+$/.test(balance) &&
    BigInt(balance) < BigInt(amount);
  const unlocksAt =
    access.data?.entitlements.find(
      (item) =>
        (item.targetType === "ip" || item.episodeId === episodeId) &&
        new Date(item.startsAt).getTime() > access.dataUpdatedAt
    )?.startsAt ?? price?.unlocksAt;

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["tv"] }),
      qc.invalidateQueries({ queryKey: ["ip-commerce"] }),
      qc.invalidateQueries({ queryKey: ["creator-earnings"] }),
    ]);
  }

  async function unlock() {
    if (inFlight.current || !user || !entry || pending || memberLocked || (!price && !memberFree))
      return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const targetType = memberFree ? "ip" : price!.targetType;
    const signature = JSON.stringify([user.id, ipId, episodeId, targetType, price?.id, amount]);
    if (requestKey.current?.signature !== signature)
      requestKey.current = { signature, key: crypto.randomUUID() };
    const input: CreateIpPurchaseInput = {
      ipId,
      targetType,
      ...(targetType === "episode" ? { episodeId } : {}),
      ...(!memberFree ? { priceRuleId: price!.id } : {}),
      idempotencyKey: requestKey.current.key,
    };
    try {
      await api.post("/aurora/ip-commerce/purchases", { data: input });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : commerce("commerce.purchaseFailed"));
      if (err instanceof ApiRequestError && err.code === "INSUFFICIENT_COMMUNITY_POINTS") {
        setRechargeOpen(true);
        requestKey.current = null;
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!user)
    return (
      <Button size="sm" onClick={() => auth.open()}>
        {commerce("commerce.loginToUnlock")}
      </Button>
    );
  if (access.isPending)
    return (
      <p role="status" className="text-xs text-white/60">
        {t("checkingAccess")}
      </p>
    );
  if (access.isError || !entry)
    return (
      <div role="alert" className="text-sm">
        <p>{access.error instanceof Error ? access.error.message : t("accessUnavailable")}</p>
        <Button size="sm" disabled={access.isFetching} onClick={() => void access.refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  if (pending)
    return (
      <p role="status" className="text-sm text-white/60">
        {t("unlockScheduled", {
          date: unlocksAt ? new Date(unlocksAt).toLocaleString(locale) : "",
        })}
      </p>
    );
  if (granted)
    return (
      <Button size="sm" onClick={() => void refresh()}>
        {t("refreshEpisode")}
      </Button>
    );

  return (
    <div className="space-y-2">
      {!memberFree && !memberLocked && price && amount != null && (
        <p className="text-xs text-white/70">
          {t(price.targetType === "ip" ? "unlockPackagePrice" : "unlockEpisodePrice", { amount })}
          {unlocksAt && new Date(unlocksAt).getTime() > access.dataUpdatedAt && (
            <> · {t("unlockScheduled", { date: new Date(unlocksAt).toLocaleString(locale) })}</>
          )}
        </p>
      )}
      <Button
        size="sm"
        disabled={busy || access.isFetching || (!price && !memberFree && !memberLocked)}
        onClick={() => {
          if (memberLocked) setMembershipOpen(true);
          else if (insufficient) setRechargeOpen(true);
          else void unlock();
        }}
      >
        <IconLock aria-hidden="true" className="size-4" />
        {busy
          ? commerce("commerce.purchasing")
          : memberLocked
            ? commerce("commerce.memberJoinToWatch")
            : memberFree
              ? commerce("commerce.memberFreeWatch")
              : insufficient
                ? commerce("commerce.topUpToUnlock")
                : price
                  ? t("quickUnlock")
                  : commerce("commerce.notForSale")}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <CommunityRechargeDialog
        open={rechargeOpen}
        onOpenChange={setRechargeOpen}
        onSuccess={refresh}
      />
      <CommunityMembershipDialog
        open={membershipOpen}
        onOpenChange={setMembershipOpen}
        onSuccess={refresh}
      />
    </div>
  );
}
