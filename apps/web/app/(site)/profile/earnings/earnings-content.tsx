"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  IconArrowLeft,
  IconBook2,
  IconCheck,
  IconChevronRight,
  IconCoins,
  IconLoader2,
  IconMovie,
  IconReceipt,
  IconRefresh,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from "@/components/ui/sheet";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useEarnings, formatEarnings, type EarningsEntry } from "./_hooks/use-earnings";

function incomeType(entry: EarningsEntry) {
  return entry.kind === "story" ? "story" : entry.episodeId ? "ipEpisode" : "ip";
}

export default function EarningsContent({ embedded = false }: { embedded?: boolean }) {
  return (
    <Suspense fallback={<Loading />}>
      <EarningsGate embedded={embedded} />
    </Suspense>
  );
}
function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}
function EarningsGate({ embedded }: { embedded: boolean }) {
  const { user, isFetched } = useCurrentUser();
  const search = useSearchParams();
  const { open } = useAuthDialog();
  const router = useRouter();
  const locale = useLocale() as Locale;
  useEffect(() => {
    if (isFetched && !user)
      open({ mode: "stay", onDismiss: () => router.replace(localizePath("/", locale)) });
  }, [isFetched, user, open, router, locale]);
  return user ? (
    <Earnings key={`${user.id}:${search.toString()}`} userId={user.id} embedded={embedded} />
  ) : (
    <Loading />
  );
}
function Earnings({ userId, embedded }: { userId: string; embedded: boolean }) {
  const t = useTranslations("creatorEarnings");
  const locale = useLocale() as Locale;
  const search = useSearchParams();
  const router = useRouter();
  const [panelFilters, setPanelFilters] = useState(() => new URLSearchParams());
  const activeFilters = embedded ? panelFilters : search;
  const rawWork = activeFilters.get("work");
  const work = rawWork && /^(story|ip):[0-9a-f-]{36}$/i.test(rawWork) ? rawWork : "all";
  const days = ["30", "90"].includes(activeFilters.get("days") ?? "")
    ? activeFilters.get("days")!
    : "all";
  const query = useEarnings(userId, locale, work, days);
  const summary = query.data?.pages[0];
  const [pageIndex, setPageIndex] = useState(0);
  const listRef = useRef<HTMLElement>(null);
  const visibleIndex = Math.min(pageIndex, Math.max(0, (query.data?.pages.length ?? 1) - 1));
  const entries = query.data?.pages[visibleIndex]?.entries ?? [];
  const canNext = Boolean(query.data?.pages[visibleIndex]?.nextCursor);
  function goToPage(index: number) {
    setPageIndex(index);
    listRef.current?.scrollIntoView?.({ block: "start" });
  }
  async function nextPage() {
    if (!canNext || query.isFetching) return;
    if (query.data?.pages[visibleIndex + 1]) {
      goToPage(visibleIndex + 1);
      return;
    }
    const result = await query.fetchNextPage({ cancelRefetch: false });
    if (!result.isError && result.data?.pages[visibleIndex + 1]) goToPage(visibleIndex + 1);
  }
  const [selected, setSelected] = useState<EarningsEntry | null>(null);
  const points = (value: string) => formatEarnings(value, locale);
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  function filter(key: string, value: string) {
    const next = new URLSearchParams(activeFilters.toString());
    if (value === "all") next.delete(key);
    else next.set(key, value);
    if (embedded) {
      setPanelFilters(next);
      setPageIndex(0);
      return;
    }
    router.replace(`${localizePath("/profile/earnings", locale)}${next.size ? `?${next}` : ""}`, {
      scroll: false,
    });
  }
  return (
    <main
      className={embedded ? "w-full p-4" : "mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10"}
    >
      {!embedded && (
        <Link
          href={localizePath("/profile", locale)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconArrowLeft className="size-3.5" />
          {t("back")}
        </Link>
      )}
      <header className="mt-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs text-muted-foreground">
          <IconCoins className="size-3.5 text-[#FFD84D]" />
          {t("unit")}
        </span>
      </header>
      {!embedded && (
        <nav
          aria-label={t("incomeSources")}
          className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm"
        >
          <Link href={localizePath("/referral", locale)} className="text-primary hover:underline">
            {t("referralIncome")}
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
      <section
        aria-label={t("overview")}
        className="mt-7 grid grid-cols-2 rounded-2xl bg-card px-5 py-6 sm:px-7 sm:py-7"
      >
        {[
          { key: "lifetime", value: summary?.lifetimeEarned },
          { key: "balance", value: summary?.withdrawableBalance },
        ].map((metric, i) => (
          <div key={metric.key} className={i ? "border-l border-border/50 pl-5 sm:pl-8" : "pr-4"}>
            <p className="text-xs text-muted-foreground">{t(metric.key)}</p>
            <p className="mt-3 text-3xl font-medium tracking-tight tabular-nums sm:text-4xl">
              {metric.value === undefined ? "—" : points(metric.value)}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{t(`${metric.key}Hint`)}</p>
          </div>
        ))}
      </section>
      <section ref={listRef} className="mt-9 scroll-mt-28" aria-label={t("transactions")}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-sm font-semibold">{t("transactions")}</h2>
          <div className="flex items-center gap-2">
            <Select value={work} onValueChange={(value) => filter("work", value)}>
              <SelectTrigger aria-label={t("workFilter")} className="h-9 max-w-52 rounded-lg px-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allWorks")}</SelectItem>
                {summary?.works.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.title || t("unknownWork")}
                  </SelectItem>
                ))}
                {work !== "all" && !summary?.works.some((item) => item.key === work) ? (
                  <SelectItem value={work}>{t("selectedWork")}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            <Select value={days} onValueChange={(value) => filter("days", value)}>
              <SelectTrigger aria-label={t("timeFilter")} className="h-9 rounded-lg px-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all", "30", "90"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`period.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl bg-card/40">
          <div className="hidden grid-cols-[1fr_110px_110px_80px_16px] gap-4 border-b border-border/50 px-5 py-3 text-xs text-muted-foreground sm:grid">
            <span>{t("work")}</span>
            <span className="text-right">{t("sale")}</span>
            <span className="text-right">{t("credited")}</span>
            <span className="text-right">{t("status")}</span>
            <span />
          </div>
          {query.isPending ? (
            <div className="space-y-5 px-5 py-6" aria-label={t("loading")} aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-secondary/60" />
              ))}
            </div>
          ) : null}
          {!query.isPending && entries.length === 0 && !query.isError ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
              <div className="mb-4 grid size-11 place-items-center rounded-full bg-secondary text-muted-foreground">
                <IconReceipt className="size-5" stroke={1.5} />
              </div>
              <h3 className="text-sm font-medium">
                {t(work !== "all" || days !== "all" ? "noMatches" : "emptyTitle")}
              </h3>
              <p className="mt-2 max-w-sm text-xs leading-6 text-muted-foreground">
                {t(work !== "all" || days !== "all" ? "noMatchesHint" : "emptyHint")}
              </p>
              {work !== "all" || days !== "all" ? (
                <Button
                  variant="ghost"
                  color="muted"
                  className="mt-3"
                  onClick={() => {
                    if (embedded) {
                      setPanelFilters(new URLSearchParams());
                      setPageIndex(0);
                    } else {
                      router.replace(localizePath("/profile/earnings", locale), { scroll: false });
                    }
                  }}
                >
                  {t("clearFilters")}
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="divide-y divide-border/40">
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelected(entry)}
                className="grid w-full grid-cols-[1fr_auto] items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-secondary/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 sm:grid-cols-[1fr_110px_110px_80px_16px]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground sm:flex">
                    {entry.kind === "story" ? (
                      <IconMovie className="size-4" />
                    ) : (
                      <IconBook2 className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="min-w-0 truncate text-sm font-medium">
                        {entry.workTitle || t("unknownWork")}
                      </p>
                      <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium leading-4 text-muted-foreground">
                        {t(`incomeTypes.${incomeType(entry)}`)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {[entry.contentTitle, date(entry.createdAt)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
                <span className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">
                  {entry.sourceAmount === null ? "—" : points(entry.sourceAmount)}
                </span>
                <span className="text-right text-sm font-medium tabular-nums">
                  +{points(entry.amount)}
                </span>
                <span className="hidden text-right text-xs text-muted-foreground sm:block">
                  {t("posted")}
                </span>
                <IconChevronRight className="hidden size-3.5 text-muted-foreground sm:block" />
              </button>
            ))}
          </div>
          {query.isError ? (
            <div role="alert" className="px-5 py-8 text-center">
              <p className="text-sm">
                {query.error instanceof Error ? query.error.message : t("loadFailed")}
              </p>
              <Button
                variant="ghost"
                color="muted"
                className="mt-3"
                onClick={() =>
                  query.isFetchNextPageError ? void nextPage() : void query.refetch()
                }
              >
                <IconRefresh className="size-3.5" />
                {t("retry")}
              </Button>
            </div>
          ) : null}
        </div>
        {query.data && entries.length > 0 ? (
          <nav
            aria-label={t("pagination.label")}
            className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"
          >
            <span>{t("pagination.pageSize")}</span>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                color="muted"
                disabled={visibleIndex === 0 || query.isFetching}
                onClick={() => goToPage(visibleIndex - 1)}
              >
                {t("pagination.previous")}
              </Button>
              <span aria-live="polite" className="tabular-nums">
                {t("pagination.page", { page: visibleIndex + 1 })}
              </span>
              <Button
                variant="ghost"
                color="muted"
                disabled={!canNext || query.isFetching}
                onClick={() => void nextPage()}
              >
                {query.isFetchingNextPage ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : null}
                {t("pagination.next")}
              </Button>
            </div>
          </nav>
        ) : null}
        <p className="mt-4 text-xs leading-5 text-muted-foreground">{t("ledgerNote")}</p>
      </section>
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader className="px-6 py-5">
            <SheetTitle>{t("detail")}</SheetTitle>
            <SheetDescription>{selected ? date(selected.createdAt) : ""}</SheetDescription>
          </SheetHeader>
          {selected ? (
            <SheetBody className="space-y-0 px-6 py-6">
              <div className="pb-7">
                <p className="text-xs text-muted-foreground">{t("credited")}</p>
                <p className="mt-3 flex items-baseline gap-2 text-3xl font-medium tabular-nums">
                  +{points(selected.amount)}
                  <span className="text-xs font-normal text-muted-foreground">{t("unit")}</span>
                </p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <IconCheck className="size-3.5" />
                  {t("posted")}
                </span>
              </div>
              <dl className="space-y-5 border-t border-border/60 pt-6">
                {[
                  [t("incomeType"), t(`incomeTypes.${incomeType(selected)}`)],
                  [t("work"), selected.workTitle || t("unknownWork")],
                  [t("content"), selected.contentTitle || "—"],
                  [
                    t("sale"),
                    selected.sourceAmount === null
                      ? "—"
                      : `${points(selected.sourceAmount)} ${t("unit")}`,
                  ],
                  [t("order"), selected.orderNo || "—"],
                  [t("transaction"), selected.transactionId],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1.5 break-words text-sm leading-6">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-7 rounded-xl bg-secondary/50 p-4 text-xs leading-6 text-muted-foreground">
                {t(selected.kind === "story" ? "storyRevenueNote" : "splitNote")}
              </p>
            </SheetBody>
          ) : null}
        </SheetContent>
      </Sheet>
    </main>
  );
}
