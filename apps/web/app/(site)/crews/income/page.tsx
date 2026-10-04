"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from "@/components/ui/sheet";
import { ReferralDashboardPage } from "../../referral/_components/referral-dashboard";
import EarningsContent from "../../profile/earnings/earnings-content";
import { EarningTrend } from "../_components/earning-trend";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { isCrewCursorError } from "../_hooks/api";

import { PayoutHistory } from "./payout-history";
import Link from "next/link";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { CREW_CURRENCY, formatCrewMoney } from "@/src/lib/crew-money";
import { useMyCrewEarnings } from "../_hooks/use-earnings";

export default function PersonalCrewIncome() {
  const { user } = useCurrentUser();
  return <PersonalIncomeSession key={user?.id ?? "anonymous"} />;
}

function PersonalIncomeSession() {
  const client = useQueryClient();
  const [incomePanel, setIncomePanel] = useState<"referral" | "work" | null>(null);
  const [crewId, setCrewId] = useState<string>();
  const t = useTranslations("crewPersonalIncome");
  const locale = useLocale() as Locale;
  const { user, isLoading } = useCurrentUser();
  const { open } = useAuthDialog();
  const currency = CREW_CURRENCY;
  const feed = useMyCrewEarnings(currency, crewId);
  function selectCrew(next?: string) {
    if (next === crewId || !user) return;
    // Clear the destination cursor before switching, even when returning to cached history.
    for (const kind of ["crew-personal-earnings", "crew-personal-payouts"]) {
      void client.resetQueries({
        queryKey: [kind, user.id, currency, ...(next ? [next] : [])],
        exact: true,
      });
    }
    setCrewId(next);
  }
  const pages = user ? feed.data?.pages : undefined;
  const summary = pages?.[0]?.summary;
  const items = pages?.flatMap((page) => page.items) ?? [];
  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-2">
          <Link href={localizePath("/crews", locale)} className="text-sm text-muted-foreground">
            {t("back")}
          </Link>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </header>
        <nav aria-label={t("incomeSources")} className="grid gap-3 md:grid-cols-3">
          {(["referral", "work"] as const).map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => (user ? setIncomePanel(source) : open())}
              className="rounded-xl bg-white/[0.035] p-5 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="block text-sm font-semibold">
                {t(source === "referral" ? "referralIncome" : "workIncome")}
              </span>
              <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                {t(`${source}SourceHint`)}
              </span>
            </button>
          ))}
          <a
            href="#production-ledger"
            className="rounded-xl bg-white/[0.035] p-5 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="block text-sm font-semibold">{t("productionSource")}</span>
            <span className="mt-2 block text-xs leading-5 text-muted-foreground">
              {t("productionSourceHint")}
            </span>
          </a>
        </nav>
        <Sheet
          open={Boolean(incomePanel)}
          onOpenChange={(value) => {
            if (!value) setIncomePanel(null);
          }}
        >
          <SheetContent side="right" className="w-full sm:max-w-3xl">
            <SheetHeader>
              <SheetTitle>
                {t(incomePanel === "referral" ? "referralIncome" : "workIncome")}
              </SheetTitle>
              <SheetDescription>{t("incomeSourcesHint")}</SheetDescription>
            </SheetHeader>
            <SheetBody>
              {user && incomePanel === "referral" && <ReferralDashboardPage embedded />}
              {user && incomePanel === "work" && <EarningsContent embedded />}
            </SheetBody>
          </SheetContent>
        </Sheet>
        <p className="text-xs text-muted-foreground">{t("incomeSourcesHint")}</p>
        {isLoading ? (
          <p role="status">{t("loading")}</p>
        ) : !user ? (
          <div className="space-y-3">
            <p>{t("signInRequired")}</p>
            <Button onClick={() => open()}>{t("signIn")}</Button>
          </div>
        ) : (
          <>
            <div
              id="production-ledger"
              className="scroll-mt-28 flex flex-wrap items-center gap-3"
              aria-label={t("crewFilter")}
            >
              <p>{crewId ? t("selectedCrew", { id: crewId }) : t("allCrews")}</p>
              {crewId && (
                <Button variant="outline" onClick={() => selectCrew()}>
                  {t("allCrews")}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground">{t("currency")}</p>
                <p className="font-medium">{currency}</p>
              </div>
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
                    void (feed.isFetchNextPageError &&
                    !isCrewCursorError(feed.error, "CREW_EARNING_CURSOR_INVALID")
                      ? feed.fetchNextPage()
                      : feed.refetch())
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
            <EarningTrend
              value={summary?.postedDaily}
              failed={feed.isError}
              loading={feed.isPending}
              locale={locale}
              currency={currency}
            />
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
                          {!crewId && (
                            <Button
                              variant="outline"
                              disabled={feed.isError}
                              onClick={() => selectCrew(item.crewId)}
                            >
                              {t("showCrew")}
                            </Button>
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
        {user && !isLoading && (
          <PayoutHistory
            key={crewId ?? "all"}
            currency={currency}
            crewId={crewId}
            onCrewFilter={selectCrew}
          />
        )}
      </div>
    </main>
  );
}
