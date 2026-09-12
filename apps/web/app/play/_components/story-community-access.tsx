"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconLock } from "@tabler/icons-react";
import type {
  ExperienceAccessRequirement,
  ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import type { ExperiencePlayerProps } from "@repo/experience-player-react";
import { api } from "@/src/lib/api";
import { useTranslations } from "@/src/i18n/i18n";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { CommunityRechargeDialog } from "@/components/payment/community-recharge-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type Quote = {
  requirements: ExperienceAccessRequirement[];
  ownedKeys: string[];
  balance: string | null;
  authenticated: boolean;
};
type Request = { requirement: ExperienceAccessRequirement; resolve: (allowed: boolean) => void };

export function useStoryCommunityAccess(runtime: ExperienceRuntimeManifest, locale: string) {
  const t = useTranslations("experiencePlayer.communityAccess");
  const queryClient = useQueryClient();
  const auth = useAuthDialog();
  const { user } = useCurrentUser();
  const [request, setRequest] = useState<Request | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recharge, setRecharge] = useState(false);
  const pending = useRef<Request | null>(null);
  const payingRef = useRef(false);
  const path = `/aurora/story-projects/${encodeURIComponent(runtime.gameId)}/builds/${encodeURIComponent(runtime.buildId)}/community-access`;
  const queryKey = useMemo(
    () => ["story-community-access", runtime.gameId, runtime.buildId, user?.id ?? "anonymous"],
    [runtime.buildId, runtime.gameId, user?.id]
  );
  const quote = useQuery({
    queryKey,
    queryFn: () => api.get<Quote>(path, { cache: "no-store" }),
    enabled: Boolean(request),
    staleTime: 0,
    retry: false,
  });
  const finish = useCallback((allowed: boolean) => {
    const current = pending.current;
    pending.current = null;
    setRequest(null);
    setError(null);
    current?.resolve(allowed);
  }, []);
  useEffect(
    () => () => {
      pending.current?.resolve(false);
      pending.current = null;
    },
    []
  );
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe(() => {
        const current = pending.current;
        if (
          current &&
          queryClient.getQueryData<Quote>(queryKey)?.ownedKeys.includes(current.requirement.key)
        )
          finish(true);
      }),
    [finish, queryClient, queryKey]
  );

  const handlers = useRef({ queryKey, path, t });
  useEffect(() => {
    handlers.current = { queryKey, path, t };
  }, [queryKey, path, t]);
  const access = useMemo<NonNullable<ExperiencePlayerProps["access"]>>(
    () => ({
      canAccess: (requirement) =>
        queryClient
          .getQueryData<Quote>(handlers.current.queryKey)
          ?.ownedKeys.includes(requirement.key) ?? false,
      checkAccess: async (requirement) => {
        const current = handlers.current;
        try {
          const latest = await queryClient.fetchQuery<Quote>({
            queryKey: current.queryKey,
            queryFn: () => api.get<Quote>(current.path, { cache: "no-store" }),
            staleTime: 0,
            retry: false,
          });
          return latest.ownedKeys.includes(requirement.key);
        } catch {
          // The confirmation owns the query error and its retry action.
          return false;
        }
      },
      requestAccess: (requirement) =>
        new Promise<boolean>((resolve) => {
          pending.current?.resolve(false);
          const next = { requirement, resolve };
          pending.current = next;
          setError(null);
          setRequest(next);
        }),
      formatPrice: (amount) => handlers.current.t("price", { amount }),
    }),
    [queryClient]
  );

  const price =
    request &&
    quote.data?.requirements.find((requirement) => requirement.key === request.requirement.key);
  const insufficient =
    price &&
    quote.data?.balance != null &&
    BigInt(quote.data.balance) < BigInt(price.communityPointPrice);
  const purchase = async () => {
    if (!request || !price || payingRef.current) return;
    payingRef.current = true;
    setPaying(true);
    setError(null);
    try {
      await api.post(path, { data: { key: price.key, expectedPrice: price.communityPointPrice } });
      queryClient.setQueryData<Quote>(queryKey, (old) =>
        old ? { ...old, ownedKeys: [...new Set([...old.ownedKeys, price.key])] } : old
      );
      void queryClient.invalidateQueries({ queryKey: ["ip-commerce", "wallet"] });
      finish(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("failed"));
      void quote.refetch();
    } finally {
      payingRef.current = false;
      setPaying(false);
    }
  };
  const title =
    price?.title[locale] ??
    price?.title[runtime.localization.defaultLocale] ??
    request?.requirement.title[locale];
  const dialog = (
    <>
      <Dialog
        open={Boolean(request) && !recharge && !auth.isOpen}
        onOpenChange={(open) => {
          if (!open && !payingRef.current) finish(false);
        }}
      >
        <DialogContent
          className="max-w-sm gap-5 p-6 ring-0"
          overlayClassName="bg-black/20"
          onEscapeKeyDown={(event) => {
            if (paying) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (paying) event.preventDefault();
          }}
        >
          <DialogHeader className="border-0 p-0">
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{title ?? t("checking")}</DialogDescription>
          </DialogHeader>
          {quote.data && price ? (
            <div className="space-y-2">
              <p
                className="flex items-center gap-2 text-2xl font-semibold tabular-nums"
                style={{ color: "var(--brand-yellow, #ffd84d)" }}
              >
                <IconLock className="size-5" aria-hidden />
                {t("price", { amount: price.communityPointPrice })}
              </p>
              <p className="text-sm text-muted-foreground">{t("once")}</p>
              {quote.data.balance != null ? (
                <p className="text-sm text-muted-foreground">
                  {t("balance", { amount: quote.data.balance })}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("checking")}</p>
          )}
          {error || quote.error ? (
            <p role="alert" className="text-sm text-destructive">
              {error ?? quote.error?.message}
            </p>
          ) : null}
          <DialogFooter className="border-0 p-0">
            <Button variant="ghost" disabled={paying} onClick={() => finish(false)}>
              {t("cancel")}
            </Button>
            {quote.error ? (
              <Button onClick={() => void quote.refetch()}>{t("retry")}</Button>
            ) : quote.data && !quote.data.authenticated ? (
              <Button
                onClick={() =>
                  auth.open({
                    mode: "stay",
                    onSuccess: () => {
                      void quote.refetch();
                    },
                  })
                }
              >
                {t("signIn")}
              </Button>
            ) : insufficient ? (
              <Button onClick={() => setRecharge(true)}>{t("recharge")}</Button>
            ) : (
              <Button
                disabled={!price || paying || quote.isFetching}
                onClick={() => void purchase()}
              >
                {t(paying ? "unlocking" : "unlock")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CommunityRechargeDialog
        open={recharge}
        onOpenChange={(open) => {
          setRecharge(open);
          if (!open) void quote.refetch();
        }}
        onSuccess={async () => {
          await quote.refetch();
          setRecharge(false);
        }}
      />
    </>
  );
  return { access, dialog };
}
