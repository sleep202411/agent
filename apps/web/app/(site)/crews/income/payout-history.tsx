"use client";

import { isCrewCursorError } from "../_hooks/api";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { formatCrewMoney, type CrewLedgerCurrency } from "@/src/lib/crew-money";
import { crewApi } from "../_hooks/api";
import type { CrewPayoutDTO, CrewPayoutStatus } from "../_hooks/types";

interface PersonalPayoutPage {
  items: CrewPayoutDTO[];
  nextCursor: string | null;
  summary: {
    byStatus: Array<{
      status: CrewPayoutStatus;
      count: number;
      amountMinor: string;
      netAmountMinor: string;
    }>;
  };
}
export function usePersonalPayouts(currency: CrewLedgerCurrency) {
  const { user } = useCurrentUser();
  return useInfiniteQuery({
    queryKey: ["crew-personal-payouts", user?.id ?? null, currency],
    enabled: Boolean(user?.id),
    refetchInterval: 60_000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<PersonalPayoutPage>("/me/crew-payouts", {
        signal,
        query: { currency, limit: 50, cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
export function PayoutHistory({ currency }: { currency: CrewLedgerCurrency }) {
  const { user } = useCurrentUser();
  const feed = usePersonalPayouts(currency);
  const t = useTranslations("crewPersonalPayouts");
  const locale = useLocale();
  if (!user) return null;
  const pages = feed.data?.pages;
  const items = pages?.flatMap((page) => page.items) ?? [];
  const money = (value: string) => formatCrewMoney(value, locale, currency);
  return (
    <section className="space-y-4" aria-label={t("title")}>
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <Button variant="outline" disabled={feed.isFetching} onClick={() => void feed.refetch()}>
        {t("refresh")}
      </Button>
      {feed.isPending && <p role="status">{t("loading")}</p>}
      {feed.isError && (
        <div role="alert">
          <p>{feed.error.message}</p>
          <Button
            disabled={feed.isFetching}
            onClick={() =>
              void (feed.isFetchNextPageError &&
              !isCrewCursorError(feed.error, "CREW_PAYOUT_CURSOR_INVALID")
                ? feed.fetchNextPage()
                : feed.refetch())
            }
          >
            {t("retry")}
          </Button>
        </div>
      )}
      {pages && (
        <dl className="grid gap-4 sm:grid-cols-3">
          {(["pending", "paid", "voided"] as const).map((status) => {
            const group = pages[0]?.summary.byStatus.find((item) => item.status === status);
            return (
              <div key={status} className="rounded-lg bg-secondary p-4">
                <dt>{t(status)}</dt>
                <dd className="mt-2 text-xl font-semibold">
                  {money(group?.netAmountMinor ?? "0")}
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {t("gross")}: {money(group?.amountMinor ?? "0")}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {pages && !items.length && <p>{t("empty")}</p>}
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="space-y-2 py-4">
            <div className="flex flex-wrap justify-between gap-2">
              <span>{t(item.status)}</span>
              <strong>{formatCrewMoney(item.netAmountMinor, locale, item.currency)}</strong>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("gross")}: {formatCrewMoney(item.amountMinor, locale, item.currency)} ·{" "}
              {t("withholding")}:{" "}
              {formatCrewMoney(item.withholdingAmountMinor, locale, item.currency)}
            </p>
            {item.paidAt && (
              <p>
                {t("paidAt")}: {new Date(item.paidAt).toLocaleDateString(locale)}
              </p>
            )}
            {item.paymentReference && (
              <p className="break-all">
                {t("reference")}: {item.paymentReference}
              </p>
            )}
            {item.voidReason && <p>{item.voidReason}</p>}
            <details className="text-sm">
              <summary>{t("sources")}</summary>
              <p>
                {t("crew")}: {item.crewId}
              </p>
              <p>
                {t("record")}: {item.id}
              </p>
              <ul>
                {item.allocations.map((allocation) => (
                  <li key={allocation.id}>
                    {allocation.earning.title} ·{" "}
                    {formatCrewMoney(allocation.amountMinor, locale, item.currency)}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
      {feed.hasNextPage && (
        <Button disabled={feed.isFetching} onClick={() => void feed.fetchNextPage()}>
          {t("more")}
        </Button>
      )}
    </section>
  );
}
