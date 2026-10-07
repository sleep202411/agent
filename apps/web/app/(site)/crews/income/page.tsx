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
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { isCrewCursorError } from "../_hooks/api";

import { learningApi } from "../../courses/_learning/api";
import { CreatorWithdrawals } from "./withdrawals";
import { PayoutHistory } from "./payout-history";
import Link from "next/link";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { CREW_CURRENCY, formatCrewMoney } from "@/src/lib/crew-money";
import { useMyCrewEarnings, type PersonalEarningFilters } from "../_hooks/use-earnings";

export default function PersonalCrewIncome() {
  const { user } = useCurrentUser();
  return <PersonalIncomeSession key={user?.id ?? "anonymous"} />;
}

function PersonalIncomeSession() {
  const client = useQueryClient();
  const [incomePanel, setIncomePanel] = useState<"referral" | "work" | null>(null);
  const [crewId, setCrewId] = useState<string>();
  const [draftSource, setDraftSource] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [filters, setFilters] = useState<PersonalEarningFilters>({});
  const sourceT = useTranslations("crewIncome.sources");
  const t = useTranslations("crewPersonalIncome");
  const locale = useLocale() as Locale;
  const { user, isLoading } = useCurrentUser();
  const { open } = useAuthDialog();
  const teaching = useQuery({
    queryKey: ["academy-teaching-summary", user?.id],
    enabled: !!user,
    queryFn: ({ signal }) => learningApi.summary(signal),
    refetchInterval: 15000,
    retry: false,
  });
  const currency = CREW_CURRENCY;
  const feed = useMyCrewEarnings(currency, crewId, filters);
  function applyFilters(next: PersonalEarningFilters) {
    if (!user) return;
    void client.resetQueries({
      queryKey: [
        "crew-personal-earnings",
        user.id,
        currency,
        ...(crewId ? [crewId] : []),
        ...(Object.keys(next).length ? [next] : []),
      ],
      exact: true,
    });
    setFilters(next);
  }
  function selectCrew(next?: string) {
    if (next === crewId || !user) return;
    // Clear the destination cursor before switching, even when returning to cached history.
    for (const kind of ["crew-personal-earnings", "crew-personal-payouts"]) {
      void client.resetQueries({
        queryKey: [
          kind,
          user.id,
          currency,
          ...(next ? [next] : []),
          ...(kind === "crew-personal-earnings" && Object.keys(filters).length ? [filters] : []),
        ],
        exact: true,
      });
    }
    setCrewId(next);
  }
  const pages = user ? feed.data?.pages : undefined;
  const summary = pages?.[0]?.summary;
  const items = pages?.flatMap((page) => page.items) ?? [];
  const production = summary?.postedBySource?.find((source) => source.sourceType === "task_reward");
  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto space-y-8">
        <header className="space-y-2">
          <Link href={localizePath("/crews", locale)} className="text-sm text-muted-foreground">
            {t("back")}
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </header>
        {user && (
          <section aria-label={t("incomeOverview")} className="space-y-5">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{t("incomeOverview")}</h2>
              <p className="text-xs text-muted-foreground">
                {crewId ? t("selectedCrew", { id: crewId }) : t("allCrews")} · {currency}
                {filters.recordedFrom && ` · ${t("recordedFrom")}: ${filters.recordedFrom}`}
                {filters.recordedThrough &&
                  ` · ${t("recordedThrough")}: ${filters.recordedThrough}`}
              </p>
            </div>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="min-w-0 rounded-2xl bg-white/[0.035] p-6">
                <p className="text-xs font-medium text-muted-foreground">{t("posted")}</p>
                <p className="mt-3 text-4xl font-semibold tabular-nums">
                  {summary && !feed.isError
                    ? formatCrewMoney(summary.byStatus.posted.amountMinor, locale, currency)
                    : "—"}
                </p>
                {summary && !feed.isError && summary.postedThisMonthAmountMinor !== undefined && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t("postedThisMonth")} ·{" "}
                    {formatCrewMoney(summary.postedThisMonthAmountMinor, locale, currency)}
                  </p>
                )}
                <EarningTrend
                  value={summary?.postedDaily}
                  failed={feed.isError}
                  loading={feed.isPending}
                  locale={locale}
                  currency={currency}
                />
              </div>
              <div className="flex flex-col gap-4">
                <dl className="flex-1 rounded-2xl bg-white/[0.035] p-6">
                  <dt className="text-xs font-medium text-muted-foreground">{t("pending")}</dt>
                  <dd className="mt-3 text-2xl font-semibold tabular-nums">
                    {summary && !feed.isError
                      ? formatCrewMoney(summary.byStatus.pending.amountMinor, locale, currency)
                      : "—"}
                  </dd>
                  <div className="mt-6 grid grid-cols-2 gap-4">
                    {(["rejected", "reversed"] as const).map((status) => (
                      <div key={status}>
                        <dt className="text-xs text-muted-foreground">{t(status)}</dt>
                        <dd className="mt-2 text-sm tabular-nums">
                          {summary && !feed.isError
                            ? formatCrewMoney(
                                summary.byStatus[status].amountMinor,
                                locale,
                                currency
                              )
                            : "—"}
                        </dd>
                      </div>
                    ))}
                  </div>
                </dl>
                <div className="rounded-2xl bg-white/[0.035] p-6">
                  <p className="text-sm leading-6 text-muted-foreground">{t("settlementNote")}</p>
                  <Button asChild className="mt-4 w-full" variant="outline">
                    <a href="#withdrawals">{t("withdrawEarnings")}</a>
                  </Button>
                </div>
                <Button
                  variant="outline"
                  disabled={feed.isFetching}
                  onClick={() => void feed.refetch()}
                >
                  {t("refresh")}
                </Button>
              </div>
            </div>
          </section>
        )}
        {user && (
          <div id="withdrawals" className="scroll-mt-28">
            <CreatorWithdrawals />
          </div>
        )}
        <h2 className="text-lg font-semibold">{t("incomeSources")}</h2>
        <nav aria-label={t("incomeSources")} className="grid gap-5 md:grid-cols-3">
          {(["referral", "work"] as const).map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => (user ? setIncomePanel(source) : open())}
              className="rounded-2xl bg-white/[0.035] p-6 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-ring"
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
            onClick={() => {
              setDraftSource("task_reward");
              applyFilters({ ...filters, sourceType: "task_reward" });
            }}
            className="rounded-2xl bg-white/[0.035] p-6 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="block text-sm font-semibold">{t("productionOrders")}</span>
            {user && summary?.postedBySource && !feed.isError && (
              <span className="my-3 block space-y-1">
                <span className="block text-xl font-semibold tabular-nums">
                  {formatCrewMoney(production?.amountMinor ?? "0", locale, currency)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("productionRecorded", { count: production?.count ?? 0 })}
                </span>
              </span>
            )}
            <span className="mt-2 block text-xs leading-5 text-muted-foreground">
              {t("productionSourceHint")}
            </span>
          </a>
          <a
            href={`/${locale}/academy/teaching`}
            className="rounded-2xl bg-white/[0.035] p-6 text-left hover:bg-white/[0.07]"
          >
            <span className="block text-sm font-semibold">{t("teachingIncome")}</span>
            {teaching.data && (
              <span className="my-3 block text-xl font-semibold tabular-nums">
                {formatCrewMoney(teaching.data.earnedCredits, locale, "USD")}
              </span>
            )}
            {teaching.error && <span role="alert">{teaching.error.message}</span>}
            <span className="mt-2 block text-xs leading-5 text-muted-foreground">
              {t("teachingSourceHint")}
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
            <h2 className="text-lg font-semibold">{t("transactionHistory")}</h2>
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
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                const next = Object.fromEntries(
                  [...values.entries()].filter(([, value]) => value !== "")
                ) as PersonalEarningFilters;
                if (
                  next.recordedFrom &&
                  next.recordedThrough &&
                  next.recordedFrom > next.recordedThrough
                ) {
                  const through = event.currentTarget.elements.namedItem(
                    "recordedThrough"
                  ) as HTMLInputElement;
                  through.setCustomValidity(t("invalidDateRange"));
                  through.reportValidity();
                  return;
                }
                applyFilters(next);
              }}
            >
              <input type="hidden" name="sourceType" value={draftSource} />
              <input type="hidden" name="status" value={draftStatus} />
              <label className="grid gap-1 text-sm">
                {t("incomeType")}
                <NativeSelect
                  aria-label={t("incomeType")}
                  value={draftSource}
                  onChange={setDraftSource}
                  className="rounded-md border border-border bg-background p-2"
                >
                  <option value="">{t("allTypes")}</option>
                  {(
                    [
                      "task_reward",
                      "contract_compensation",
                      "milestone_bonus",
                      "revenue_share",
                      "discretionary_bonus",
                      "adjustment",
                    ] as const
                  ).map((source) => (
                    <option key={source} value={source}>
                      {sourceT(source)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="grid gap-1 text-sm">
                {t("status")}
                <NativeSelect
                  aria-label={t("status")}
                  value={draftStatus}
                  onChange={setDraftStatus}
                  className="rounded-md border border-border bg-background p-2"
                >
                  <option value="">{t("allStatuses")}</option>
                  {(["posted", "pending", "rejected", "reversed"] as const).map((status) => (
                    <option key={status} value={status}>
                      {t(status)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="grid gap-1 text-sm">
                {t("recordedFrom")}
                <input
                  type="date"
                  name="recordedFrom"
                  className="rounded-md border border-border bg-background p-2"
                  onChange={(event) =>
                    (
                      event.currentTarget.form!.elements.namedItem(
                        "recordedThrough"
                      ) as HTMLInputElement
                    ).setCustomValidity("")
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t("recordedThrough")}
                <input
                  type="date"
                  name="recordedThrough"
                  className="rounded-md border border-border bg-background p-2"
                  onChange={(event) => event.currentTarget.setCustomValidity("")}
                />
              </label>
              <Button type="submit">{t("applyFilters")}</Button>
            </form>
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
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("incomeCode")}:{" "}
                            <code className="select-all break-all">{item.id}</code>
                          </p>
                          {item.crew && (
                            <p className="text-xs text-muted-foreground">{item.crew.name}</p>
                          )}
                          {item.revenueDistribution && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t("confirmedRevenue")}
                              {item.revenueDistribution.shareBps !== null &&
                                ` · ${t("revenueShare", { percentage: item.revenueDistribution.shareBps / 100 })}`}
                            </p>
                          )}
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
                            {item.task && (
                              <p>
                                {t("task")}: #{item.task.number} {item.task.title}
                              </p>
                            )}
                            {item.revenueDistribution && (
                              <>
                                <p>
                                  {t("revenueReference")}:{" "}
                                  {item.revenueDistribution.revenueReference}
                                </p>
                                <p>
                                  {t("distributionContract")}:{" "}
                                  {item.revenueDistribution.contract.filename}
                                </p>
                                <p>
                                  {t("distributionReceipt")}: {item.revenueDistribution.id}
                                </p>
                              </>
                            )}
                          </details>
                        </td>
                        <td className="p-3">{t(item.status)}</td>
                        <td className="whitespace-nowrap p-3">
                          {formatCrewMoney(item.amountMinor, locale, item.currency)}
                        </td>
                        <td className="whitespace-nowrap p-3">
                          {new Date(item.createdAt).toLocaleDateString(locale, { timeZone: "UTC" })}
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
