"use client";

import Link from "next/link";
import {
  IconArrowRight,
  IconCalendarClock,
  IconCheck,
  IconChevronRight,
  IconCircleDashed,
  IconCircleDot,
  IconLock,
  IconPlus,
  IconSearch,
  IconShield,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import {
  CHECKLIST,
  COMMERCE_FLOW,
  IMPORT_STEPS,
  METRICS,
  NAV_ITEMS,
  REVIEW_ITEMS,
  REVENUE_SOURCES,
  TITLES,
  type IpCommerceStatus,
  type IpCommerceTitle,
} from "../_data/preview-data";

const LIFECYCLE: IpCommerceStatus[] = [
  "draft",
  "submitted",
  "approved",
  "scheduled",
  "published",
  "hidden",
];

const STATUS_TONE: Record<IpCommerceStatus, string> = {
  draft: "border-[#202020]/10 bg-[#202020]/5 text-[#575757]",
  submitted: "border-[#8b5e00]/20 bg-[#fff1cf] text-[#7b4b00]",
  approved: "border-[#2b9a66]/20 bg-[#e8f7ef] text-[#1e704a]",
  scheduled: "border-[#3569b8]/20 bg-[#eaf1ff] text-[#244f8f]",
  published: "border-[#202020] bg-[#202020] text-white",
  hidden: "border-[#202020]/15 bg-white text-[#646464]",
};

export function IpCommercePreview() {
  const t = useTranslations("ipCommerce");
  const locale = useLocale() as Locale;
  const featured = TITLES[0];

  return (
    <div className="min-h-screen bg-[#f9f7f3] text-[#202020]">
      <div className="mx-auto grid max-w-[1540px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[238px_minmax(0,1fr)] lg:px-8">
        <aside className="hidden lg:block">
          <div className="sticky top-24 rounded-[10px] border border-[#202020]/10 bg-white p-3">
            <Link
              href={localizePath("/ip-commerce", locale)}
              className="flex items-center gap-3 px-2 py-2"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-[#202020] text-white">
                <IconShield className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{t("shell.title")}</span>
                <span className="block truncate text-xs text-[#646464]">{t("shell.subtitle")}</span>
              </span>
            </Link>
            <nav className="mt-4 space-y-1" aria-label={t("shell.nav")}>
              {NAV_ITEMS.map((item, index) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.key}
                    href={item.href}
                    className={cn(
                      "flex h-10 items-center gap-3 rounded-full px-3 text-sm transition-colors",
                      index === 0
                        ? "bg-[#202020] text-white"
                        : "text-[#575757] hover:bg-[#f3f0e8] hover:text-[#202020]"
                    )}
                  >
                    <Icon className="size-4" />
                    <span>{t(`nav.${item.key}`)}</span>
                  </a>
                );
              })}
            </nav>
            <div className="mt-5 rounded-[8px] border border-[#202020]/10 bg-[#f3f0e8] p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[#646464]">
                <IconCircleDot className="size-3.5 text-[#ea2804]" />
                {t("shell.importStatus")}
              </div>
              <p className="mt-2 text-sm font-semibold">{t("migration.runTitle")}</p>
              <p className="mt-1 text-xs leading-5 text-[#646464]">{t("migration.runBody")}</p>
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <section className="rounded-[10px] border border-[#202020]/10 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex h-8 items-center rounded-full border border-[#202020]/10 bg-[#f3f0e8] px-3 text-xs font-semibold text-[#646464]">
                  {t("hero.eyebrow")}
                </div>
                <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-none tracking-[-0.03em] sm:text-5xl xl:text-6xl">
                  {t("hero.title")}
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-[#575757]">
                  {t("hero.body")}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 xl:w-[420px]">
                <Link
                  href={localizePath("/ips/create", locale)}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#ea2804] px-4 text-sm font-semibold text-white"
                >
                  <IconPlus className="size-4" />
                  {t("actions.create")}
                </Link>
                <a
                  href="#migration"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#202020] bg-white px-4 text-sm font-semibold"
                >
                  {t("actions.import")}
                </a>
                <a
                  href="#commerce"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#202020]/10 bg-[#f3f0e8] px-4 text-sm font-semibold"
                >
                  {t("actions.revenue")}
                </a>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {METRICS.map((metric) => {
                const Icon = metric.icon;
                return (
                  <div
                    key={metric.key}
                    className="rounded-[8px] border border-[#202020]/10 bg-[#f9f7f3] p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#646464]">
                        {t(`metrics.${metric.key}.label`)}
                      </span>
                      <Icon className="size-4 text-[#ea2804]" />
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <strong className="text-3xl leading-none tracking-[-0.03em]">
                        {metric.value}
                      </strong>
                      <span className="rounded-full border border-[#202020]/10 bg-white px-2.5 py-1 text-xs font-semibold text-[#575757]">
                        {metric.delta}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[#8d8d8d]">{t(`metrics.${metric.key}.hint`)}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section
            id="market"
            className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.28fr)_minmax(360px,0.72fr)]"
          >
            <FeaturedLaunch title={featured} />
            <StorefrontPanel />
          </section>

          <section
            id="operations"
            className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
          >
            <LifecycleBoard />
            <ReadinessPanel />
          </section>

          <section id="commerce" className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
            <CommerceFlowPanel />
            <RevenuePanel />
          </section>

          <section
            id="review"
            className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]"
          >
            <ReviewPanel />
            <EntitlementPanel />
          </section>

          <section id="migration" className="mt-6">
            <MigrationPanel />
          </section>
        </main>
      </div>
    </div>
  );
}

function FeaturedLaunch({ title }: { title: IpCommerceTitle }) {
  const t = useTranslations("ipCommerce");
  const pointsUnit = t("unit.points");

  return (
    <article className="relative min-h-[460px] overflow-hidden rounded-[10px] bg-[#202020] text-white">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-55"
        style={{ backgroundImage: `url(${title.image})` }}
      />
      <div className={cn("absolute inset-0 bg-linear-to-br", title.tone)} />
      <div className="absolute inset-0 bg-linear-to-t from-black/72 via-black/30 to-black/10" />
      <div className="relative flex min-h-[460px] flex-col justify-between p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={title.status} invert />
          <span className="rounded-full border border-white/16 bg-white/10 px-3 py-1 text-xs font-semibold">
            {t(`visibility.${title.visibility}`)}
          </span>
          <span className="rounded-full border border-white/16 bg-white/10 px-3 py-1 text-xs font-semibold">
            {t("unit.episodes", { count: title.episodes })}
          </span>
        </div>

        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-white/70">{t("featured.eyebrow")}</p>
          <h2 className="mt-3 max-w-2xl text-4xl font-semibold leading-none tracking-[-0.03em] sm:text-6xl">
            {t(`titles.${title.key}.title`)}
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-6 text-white/76 sm:text-base">
            {t(`titles.${title.key}.body`)}
          </p>
          <div className="mt-6 grid max-w-xl gap-3 sm:grid-cols-3">
            <LaunchStat
              label={t("featured.earlyBird")}
              value={formatPoints(title.earlyBirdPrice ?? title.price, pointsUnit)}
            />
            <LaunchStat
              label={t("featured.standard")}
              value={formatPoints(title.price, pointsUnit)}
            />
            <LaunchStat
              label={t("featured.unlock")}
              value={title.unlockDate ?? t("featured.now")}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3 rounded-full border border-white/12 bg-black/28 px-3 py-2 backdrop-blur">
            <IconCalendarClock className="size-4 shrink-0 text-[#f4a8a0]" />
            <span className="truncate text-sm font-semibold">
              {t("featured.countdown", { date: title.unlockDate ?? "-" })}
            </span>
          </div>
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#202020]"
          >
            {t("actions.openStorefront")}
            <IconArrowRight className="size-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

function StorefrontPanel() {
  const t = useTranslations("ipCommerce");

  return (
    <section className="rounded-[10px] border border-[#202020]/10 bg-white p-4 sm:p-5">
      <SectionHeader eyebrow={t("storefront.eyebrow")} title={t("storefront.title")} />
      <div className="mt-4 flex h-11 items-center gap-2 rounded-full border border-[#202020]/10 bg-[#f9f7f3] px-4 text-sm text-[#8d8d8d]">
        <IconSearch className="size-4 shrink-0" />
        <span className="truncate">{t("storefront.search")}</span>
      </div>
      <div className="mt-4 space-y-3">
        {TITLES.slice(1).map((title) => (
          <TitleListCard key={title.key} title={title} />
        ))}
      </div>
    </section>
  );
}

function TitleListCard({ title }: { title: IpCommerceTitle }) {
  const t = useTranslations("ipCommerce");
  const pointsUnit = t("unit.points");

  return (
    <article className="grid gap-3 rounded-[8px] border border-[#202020]/10 bg-[#f9f7f3] p-2.5 sm:grid-cols-[136px_minmax(0,1fr)]">
      <div
        className="aspect-video rounded-[7px] bg-cover bg-center"
        style={{ backgroundImage: `url(${title.image})` }}
      />
      <div className="min-w-0 py-1 pr-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{t(`titles.${title.key}.title`)}</h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#646464]">
              {t(`titles.${title.key}.body`)}
            </p>
          </div>
          <StatusBadge status={title.status} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#646464]">
          <span>{formatPoints(title.price, pointsUnit)}</span>
          <span className="text-[#bbbbbb]">/</span>
          <span>{t("unit.episodes", { count: title.episodes })}</span>
          <span className="text-[#bbbbbb]">/</span>
          <span>{t("unit.sold", { count: title.sold })}</span>
        </div>
      </div>
    </article>
  );
}

function LifecycleBoard() {
  const t = useTranslations("ipCommerce");
  const counts = LIFECYCLE.map((status) => ({
    status,
    count: TITLES.filter((title) => title.status === status).length,
  }));

  return (
    <section className="rounded-[10px] border border-[#202020]/10 bg-white p-4 sm:p-5">
      <SectionHeader eyebrow={t("lifecycle.eyebrow")} title={t("lifecycle.title")} />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {counts.map((item) => (
          <div
            key={item.status}
            className="rounded-[8px] border border-[#202020]/10 bg-[#f9f7f3] p-4"
          >
            <StatusBadge status={item.status} />
            <div className="mt-5 flex items-end justify-between">
              <strong className="text-4xl leading-none tracking-[-0.03em]">{item.count}</strong>
              <IconChevronRight className="size-5 text-[#bbbbbb]" />
            </div>
            <p className="mt-2 text-xs leading-5 text-[#646464]">
              {t(`lifecycle.hints.${item.status}`)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReadinessPanel() {
  const t = useTranslations("ipCommerce");
  const completed = CHECKLIST.filter((item) => item.done).length;
  const progress = Math.round((completed / CHECKLIST.length) * 100);

  return (
    <section className="rounded-[10px] border border-[#202020]/10 bg-[#202020] p-4 text-white sm:p-5">
      <SectionHeader eyebrow={t("readiness.eyebrow")} title={t("readiness.title")} dark />
      <div className="mt-5 rounded-[8px] border border-white/10 bg-white/6 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{t("readiness.score")}</p>
            <p className="mt-1 text-xs text-white/60">{t("readiness.scoreHint")}</p>
          </div>
          <strong className="text-4xl leading-none tracking-[-0.03em]">{progress}%</strong>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/12">
          <div className="h-full rounded-full bg-[#ea2804]" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {CHECKLIST.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.key}
              className="flex items-center gap-3 rounded-[8px] border border-white/10 bg-white/[0.04] p-3"
            >
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full",
                  item.done ? "bg-[#2b9a66] text-white" : "bg-white/10 text-white/58"
                )}
              >
                {item.done ? <IconCheck className="size-4" /> : <Icon className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {t(`readiness.items.${item.key}.title`)}
                </p>
                <p className="mt-0.5 truncate text-xs text-white/54">
                  {t(`readiness.items.${item.key}.body`)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CommerceFlowPanel() {
  const t = useTranslations("ipCommerce");

  return (
    <section className="rounded-[10px] border border-[#202020]/10 bg-white p-4 sm:p-5">
      <SectionHeader eyebrow={t("commerce.eyebrow")} title={t("commerce.title")} />
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {COMMERCE_FLOW.map((step, index) => {
          const Icon = step.icon;
          return (
            <div
              key={step.key}
              className="rounded-[8px] border border-[#202020]/10 bg-[#f9f7f3] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-[#202020] text-white">
                  <Icon className="size-4" />
                </span>
                <span className="font-mono text-xs text-[#8d8d8d]">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-4 text-sm font-semibold">
                {t(`commerce.steps.${step.key}.title`)}
              </h3>
              <p className="mt-2 text-xs leading-5 text-[#646464]">
                {t(`commerce.steps.${step.key}.body`)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RevenuePanel() {
  const t = useTranslations("ipCommerce");

  return (
    <section className="rounded-[10px] border border-[#202020]/10 bg-white p-4 sm:p-5">
      <SectionHeader eyebrow={t("revenue.eyebrow")} title={t("revenue.title")} />
      <div className="mt-5 space-y-3">
        {REVENUE_SOURCES.map((source) => {
          const Icon = source.icon;
          return (
            <div
              key={source.key}
              className="flex items-center gap-3 rounded-[8px] border border-[#202020]/10 bg-[#f9f7f3] p-3"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-white text-[#ea2804]">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {t(`revenue.sources.${source.key}.title`)}
                </p>
                <p className="mt-0.5 truncate text-xs text-[#646464]">
                  {t(`revenue.sources.${source.key}.body`)}
                </p>
              </div>
              <strong className="shrink-0 text-sm">{source.amount}</strong>
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-[8px] bg-[#202020] p-4 text-white">
        <p className="text-xs font-semibold uppercase text-white/50">{t("revenue.ledger")}</p>
        <div className="mt-3 flex items-end justify-between gap-3">
          <strong className="text-3xl leading-none tracking-[-0.03em]">S$24,450</strong>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
            {t("revenue.pending")}
          </span>
        </div>
      </div>
    </section>
  );
}

function ReviewPanel() {
  const t = useTranslations("ipCommerce");

  return (
    <section className="rounded-[10px] border border-[#202020]/10 bg-white p-4 sm:p-5">
      <SectionHeader eyebrow={t("review.eyebrow")} title={t("review.title")} />
      <div className="mt-5 space-y-3">
        {REVIEW_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.key}
              className="flex items-center gap-3 rounded-[8px] border border-[#202020]/10 bg-[#f9f7f3] p-3"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-white text-[#202020]">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {t(`review.items.${item.key}.title`)}
                </p>
                <p className="mt-0.5 truncate text-xs text-[#646464]">
                  {t(`review.items.${item.key}.body`)}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-semibold",
                  item.status === "passed" && "border-[#2b9a66]/20 bg-[#e8f7ef] text-[#1e704a]",
                  item.status === "waiting" && "border-[#8b5e00]/20 bg-[#fff1cf] text-[#7b4b00]",
                  item.status === "blocked" && "border-[#ea2804]/20 bg-[#fff0ef] text-[#c01f00]"
                )}
              >
                {t(`review.status.${item.status}`)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EntitlementPanel() {
  const t = useTranslations("ipCommerce");
  const pointsUnit = t("unit.points");
  const title = TITLES[0];

  return (
    <section className="rounded-[10px] border border-[#202020]/10 bg-white p-4 sm:p-5">
      <SectionHeader eyebrow={t("entitlement.eyebrow")} title={t("entitlement.title")} />
      <div className="mt-5 overflow-hidden rounded-[8px] border border-[#202020]/10">
        <div className="grid grid-cols-[1.2fr_0.7fr_0.8fr] bg-[#f3f0e8] px-3 py-2 text-xs font-semibold text-[#646464]">
          <span>{t("entitlement.columns.content")}</span>
          <span>{t("entitlement.columns.access")}</span>
          <span>{t("entitlement.columns.state")}</span>
        </div>
        {[1, 2, 3, 4].map((episode) => (
          <div
            key={episode}
            className="grid grid-cols-[1.2fr_0.7fr_0.8fr] border-t border-[#202020]/10 px-3 py-3 text-sm"
          >
            <span className="truncate">{t("entitlement.episode", { episode })}</span>
            <span className="text-[#646464]">
              {episode === 1 ? t("entitlement.free") : formatPoints(title.price, pointsUnit)}
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              {episode <= 2 ? (
                <IconCheck className="size-4 text-[#2b9a66]" />
              ) : (
                <IconLock className="size-4 text-[#8d8d8d]" />
              )}
              {episode <= 2 ? t("entitlement.unlocked") : t("entitlement.locked")}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MigrationPanel() {
  const t = useTranslations("ipCommerce");

  return (
    <section className="rounded-[10px] border border-[#202020]/10 bg-white p-4 sm:p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <SectionHeader eyebrow={t("migration.eyebrow")} title={t("migration.title")} />
          <p className="mt-3 text-sm leading-6 text-[#575757]">{t("migration.body")}</p>
          <button
            type="button"
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-[#202020] px-5 text-sm font-semibold text-white"
          >
            {t("actions.startImport")}
            <IconArrowRight className="size-4" />
          </button>
        </div>
        <div className="rounded-[8px] border border-[#202020]/10 bg-[#f9f7f3] p-4">
          <div className="grid gap-3 sm:grid-cols-5">
            {IMPORT_STEPS.map((step, index) => (
              <div key={step.key} className="min-w-0">
                <div
                  className={cn(
                    "flex h-10 items-center justify-center rounded-full border text-sm font-semibold",
                    step.state === "done" && "border-[#2b9a66]/20 bg-[#e8f7ef] text-[#1e704a]",
                    step.state === "running" && "border-[#ea2804]/20 bg-[#fff0ef] text-[#c01f00]",
                    step.state === "pending" && "border-[#202020]/10 bg-white text-[#8d8d8d]"
                  )}
                >
                  {step.state === "running" ? (
                    <IconCircleDashed className="size-4" />
                  ) : (
                    String(index + 1)
                  )}
                </div>
                <p className="mt-2 truncate text-center text-xs font-semibold">
                  {t(`migration.steps.${step.key}`)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-[8px] bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{t("migration.mapTitle")}</p>
                <p className="mt-1 text-xs text-[#646464]">{t("migration.mapBody")}</p>
              </div>
              <span className="rounded-full bg-[#202020] px-3 py-1 text-xs font-semibold text-white">
                128 / 214
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusBadge({ status, invert = false }: { status: IpCommerceStatus; invert?: boolean }) {
  const t = useTranslations("ipCommerce");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold",
        invert ? "border-white/18 bg-white/12 text-white" : STATUS_TONE[status]
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}

function SectionHeader({
  eyebrow,
  title,
  dark = false,
}: {
  eyebrow: string;
  title: string;
  dark?: boolean;
}) {
  return (
    <div>
      <p
        className={cn("text-xs font-semibold uppercase", dark ? "text-white/48" : "text-[#8d8d8d]")}
      >
        {eyebrow}
      </p>
      <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.02em]">{title}</h2>
    </div>
  );
}

function LaunchStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-white/12 bg-white/10 p-3 backdrop-blur">
      <p className="text-xs font-semibold text-white/54">{label}</p>
      <p className="mt-2 truncate text-lg font-semibold">{value}</p>
    </div>
  );
}

function formatPoints(value: number, unit: string) {
  return `${value.toLocaleString()} ${unit}`;
}
