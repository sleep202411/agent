"use client";

import { PayoutHistory } from "./payout-history";
import { useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { CREW_CURRENCY, formatCrewMoney, type CrewLedgerCurrency } from "@/src/lib/crew-money";
import { useMyCrewEarnings } from "../_hooks/use-earnings";

export default function PersonalCrewIncome() {
  const t = useTranslations("crewPersonalIncome");
  const locale = useLocale() as Locale;
  const { user, isLoading } = useCurrentUser();
  const { open } = useAuthDialog();
  const [currency, setCurrency] = useState<CrewLedgerCurrency>(CREW_CURRENCY);
  const feed = useMyCrewEarnings(currency);
  const pages = user ? feed.data?.pages : undefined;
  const summary = pages?.[0]?.summary;
  const items = pages?.flatMap((page) => page.items) ?? [];
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <Link href={localizePath("/crews", locale)} className="text-sm text-muted-foreground">
          {t("back")}
        </Link>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      {isLoading ? (
        <p role="status">{t("loading")}</p>
      ) : !user ? (
        <div className="space-y-3">
          <p>{t("signInRequired")}</p>
          <Button onClick={() => open()}>{t("signIn")}</Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              {t("currency")}
              <NativeSelect
                aria-label={t("currency")}
                value={currency}
                onChange={(value) => setCurrency(value as CrewLedgerCurrency)}
              >
                <NativeSelectOption value="USD">USD</NativeSelectOption>
                <NativeSelectOption value="CNY">CNY</NativeSelectOption>
              </NativeSelect>
            </label>
            <Button
              variant="outline"
              disabled={feed.isFetching}
              onClick={() => void feed.refetch()}
            >
              {t("refresh")}
            </Button>
          </div>
          {feed.isPending && <p role="status">{t("loading")}</p>}
          {feed.isError && (
            <div role="alert" className="space-y-2 text-destructive">
              <p>{feed.error.message}</p>
              <Button
                variant="outline"
                disabled={feed.isFetching}
                onClick={() =>
                  void (feed.isFetchNextPageError ? feed.fetchNextPage() : feed.refetch())
                }
              >
                {t("retry")}
              </Button>
            </div>
          )}
          {summary && (
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(["posted", "pending", "rejected", "reversed"] as const).map((status) => (
                <div key={status} className="rounded-lg bg-secondary p-4">
                  <dt className="text-sm text-muted-foreground">{t(status)}</dt>
                  <dd className="mt-2 text-xl font-semibold">
                    {formatCrewMoney(summary.byStatus[status].amountMinor, locale, currency)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-sm text-muted-foreground">{t("settlementNote")}</p>
          {pages && !items.length && <p>{t("empty")}</p>}
          {items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["record", "status", "amount", "date"].map((key) => (
                      <th key={key} className="p-3">
                        {t(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-border">
                      <td className="p-3">
                        <p className="font-medium">{item.title}</p>
                        {item.description && (
                          <p className="text-muted-foreground">{item.description}</p>
                        )}
                        <details className="mt-1 text-xs text-muted-foreground">
                          <summary>{t("references")}</summary>
                          <p>
                            {t("crew")}: {item.crewId}
                          </p>
                          <p>
                            {t("record")}: {item.id}
                          </p>
                          {item.task && (
                            <p>
                              {t("task")}: #{item.task.number} {item.task.title}
                            </p>
                          )}
                        </details>
                      </td>
                      <td className="p-3">{t(item.status)}</td>
                      <td className="whitespace-nowrap p-3">
                        {formatCrewMoney(item.amountMinor, locale, item.currency)}
                      </td>
                      <td className="whitespace-nowrap p-3">
                        {new Date(item.postedAt ?? item.createdAt).toLocaleDateString(locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {feed.hasNextPage && (
            <Button
              variant="outline"
              disabled={feed.isFetching}
              onClick={() => void feed.fetchNextPage()}
            >
              {t("loadMore")}
            </Button>
          )}
        </>
      )}
      {user && !isLoading && <PayoutHistory currency={currency} />}
    </main>
  );
}
