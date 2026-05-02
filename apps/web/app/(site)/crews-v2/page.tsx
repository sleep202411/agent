"use client";

/**
 * `/crews-v2` — Studio Plaza (剧组广场) v2 prototype.
 *
 * Direct port of fizzdragon-prd `app/studio/page.tsx`. Mock data only —
 * real APIs land in a follow-up. Layout, tab semantics and section
 * order match the PRD; tabler icons swap in for lucide; PRD-specific
 * utility classes (`cyber-border` / `card-hover` / `gradient-text-blue`
 * / `status-*`) are inlined as plain Tailwind that resolves against
 * the platform theme tokens.
 *
 * Translations live in `_data/i18n.ts` (feature-private) — the central
 * `messages/*.json` files are intentionally untouched so killing this
 * prototype later is a single `rm -rf` away.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  IconSearch,
  IconPlus,
  IconMovie,
  IconBolt,
  IconUsers,
  IconStar,
  IconChevronRight,
  IconSpeakerphone,
  IconCircleCheck,
  IconClock,
  IconSparkles,
  IconLayoutDashboard,
  IconCurrencyDollar,
  IconAlertCircle,
  IconFlag,
  IconArrowRight,
  IconLoader2,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { StudioCard } from "./_components/studio-card";
import { ActivityFeed } from "./_components/activity-feed";
import {
  STATUS_TABS,
  ROLE_FILTERS,
  MOCK_STUDIOS,
  PLATFORM_STATS,
  PROJECTS,
  PENDING_APPROVALS,
  FINANCIAL_SUMMARY,
} from "./_data/mock";
import { useT } from "./_hooks/use-t";

// Map filter chip values → i18n keys so the UI can stay localized
// without forcing the mock data to lose its English-keyed source of truth.
const STATUS_LABEL_KEY: Record<
  (typeof STATUS_TABS)[number],
  "statusAll" | "statusRecruiting" | "statusInProduction" | "statusPostProduction"
> = {
  All: "statusAll",
  Recruiting: "statusRecruiting",
  "In Production": "statusInProduction",
  "Post-production": "statusPostProduction",
};

const ROLE_LABEL_KEY: Record<
  (typeof ROLE_FILTERS)[number],
  | "roleAiArt"
  | "roleStoryboarder"
  | "roleVoiceActor"
  | "rolePostEditor"
  | "roleMusic"
  | "roleScreenwriter"
> = {
  "AI Art": "roleAiArt",
  Storyboarder: "roleStoryboarder",
  "Voice Actor": "roleVoiceActor",
  "Post Editor": "rolePostEditor",
  Music: "roleMusic",
  Screenwriter: "roleScreenwriter",
};

const HEALTH_CONFIG = {
  good: { labelKey: "pcHealthGood" as const, color: "text-green-400", dot: "bg-green-400" },
  warning: {
    labelKey: "pcHealthWarning" as const,
    color: "text-amber-400",
    dot: "bg-amber-400 animate-pulse",
  },
  risk: {
    labelKey: "pcHealthRisk" as const,
    color: "text-red-400",
    dot: "bg-red-400 animate-pulse",
  },
};

function StudioPlazaContent() {
  const t = useT();
  const searchParams = useSearchParams();
  const mainTab = searchParams.get("view") || "plaza";

  const [activeStatus, setActiveStatus] = useState<(typeof STATUS_TABS)[number]>("All");
  const [activeRole, setActiveRole] = useState<(typeof ROLE_FILTERS)[number] | "">("");
  const [searchQuery, setSearchQuery] = useState("");
  const [financeTab, setFinanceTab] = useState<"projects" | "finance">("projects");

  const filtered = MOCK_STUDIOS.filter((s) => {
    const matchStatus = activeStatus === "All" || s.status === activeStatus;
    const matchRole = !activeRole || s.roles_needed?.some((r) => r.includes(activeRole));
    const matchSearch =
      !searchQuery ||
      s.name?.includes(searchQuery) ||
      s.ip_name?.includes(searchQuery) ||
      s.roles_needed?.some((r) => r.includes(searchQuery));
    return matchStatus && matchRole && matchSearch;
  });

  const recruitingCount = MOCK_STUDIOS.filter((s) => s.status === "Recruiting").length;
  const clearAll = () => {
    setActiveStatus("All");
    setActiveRole("");
    setSearchQuery("");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top tab switch ── */}
      <div className="border-b border-border bg-card/30">
        <div className="mx-auto max-w-screen-2xl px-6">
          <div className="flex items-center gap-1 pt-4">
            <Link
              href="/crews-v2"
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-5 py-2.5 text-sm font-semibold transition-colors",
                mainTab === "plaza"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <IconMovie className="size-4" /> {t("tabPlaza")}
            </Link>
            <Link
              href="/crews-v2?view=workbench"
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-5 py-2.5 text-sm font-semibold transition-colors",
                mainTab === "workbench"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <IconLayoutDashboard className="size-4" /> {t("tabWorkbench")}
              {PENDING_APPROVALS.length > 0 && (
                <span className="ml-1 rounded-full bg-amber-400/20 px-1.5 py-0.5 text-xs text-amber-400">
                  {PENDING_APPROVALS.length}
                </span>
              )}
            </Link>
          </div>
        </div>
      </div>

      {/* ── Producer Workbench ── */}
      {mainTab === "workbench" && (
        <div className="mx-auto max-w-screen-xl space-y-6 px-6 py-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-black text-foreground">{t("wbHeading")}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("wbSubtitle")}</p>
            </div>
            <Link
              href="/crews-v2/create"
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <IconPlus className="size-4" /> {t("wbCtaNewProject")}
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              {
                labelKey: "wbStatActiveProjects" as const,
                value: "2",
                Icon: IconMovie,
                color: "text-primary",
              },
              {
                labelKey: "wbStatPendingCheckpoints" as const,
                value: String(PENDING_APPROVALS.length),
                Icon: IconFlag,
                color: "text-amber-400",
              },
              {
                labelKey: "wbStatDueThisWeek" as const,
                value: "5",
                Icon: IconClock,
                color: "text-blue-400",
              },
              {
                labelKey: "wbStatTotalTeam" as const,
                value: "12",
                Icon: IconUsers,
                color: "text-violet-400",
              },
            ].map((s) => (
              <div
                key={s.labelKey}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
                  <s.Icon className={cn("size-5", s.color)} />
                </div>
                <div>
                  <div className="text-2xl font-black text-foreground">{s.value}</div>
                  <div className="text-xs text-muted-foreground">{t(s.labelKey)}</div>
                </div>
              </div>
            ))}
          </div>

          {PENDING_APPROVALS.length > 0 && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
              <div className="mb-3 flex items-center gap-2">
                <IconAlertCircle className="size-4 text-amber-400" />
                <span className="text-sm font-bold text-amber-400">{t("wbApprovalsTitle")}</span>
              </div>
              <div className="space-y-2">
                {PENDING_APPROVALS.map((ap) => (
                  <div
                    key={ap.id}
                    className="flex items-center justify-between rounded-xl border border-border bg-card p-3"
                  >
                    <div>
                      <span className="text-sm font-semibold text-foreground">{ap.project}</span>
                      <span className="ml-2 text-sm text-muted-foreground">· {ap.stage}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "text-xs",
                          ap.urgent ? "text-red-400" : "text-muted-foreground"
                        )}
                      >
                        {ap.slaKey === "hoursUntilTimeout"
                          ? t("hoursUntilTimeout", { hours: ap.slaHours ?? 0 })
                          : t("dueTomorrow")}
                      </span>
                      <Link
                        href={`/crews-v2/checkpoint/${ap.id}`}
                        className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-black transition-colors hover:bg-amber-400/90"
                      >
                        {t("wbApprovalsReview")}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-1 border-b border-border">
            {(["projects", "finance"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFinanceTab(tab)}
                className={cn(
                  "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
                  financeTab === tab
                    ? "border-primary font-semibold text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab === "projects" ? t("wbTabProjects") : t("wbTabFinance")}
              </button>
            ))}
          </div>

          {financeTab === "projects" && (
            <div className="space-y-4">
              {PROJECTS.map((p) => {
                const health = HEALTH_CONFIG[p.health];
                return (
                  <div key={p.id} className="rounded-xl border border-border bg-card p-5">
                    <div className="mb-4 flex items-start justify-between">
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <h3 className="font-bold text-foreground">{p.name}</h3>
                          <span
                            className={cn(
                              "flex items-center gap-1 text-xs font-semibold",
                              health.color
                            )}
                          >
                            <span className={cn("size-1.5 rounded-full", health.dot)} />
                            {t(health.labelKey)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{p.phase}</span>
                          <span>·</span>
                          <span>
                            {p.members} {t("pcMembersSuffix")}
                          </span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <IconClock className="size-3" />
                            {p.deadline}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.urgentCheckpoints > 0 && (
                          <span className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-400">
                            {p.urgentCheckpoints} {t("pcUrgentSuffix")}
                          </span>
                        )}
                        <Link
                          href={`/crews-v2/${p.id}/workspace`}
                          className="flex items-center gap-1 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/70"
                        >
                          {t("pcEnterWorkspace")} <IconArrowRight className="size-3" />
                        </Link>
                      </div>
                    </div>

                    <div className="mb-3">
                      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                        <span>{t("pcOverallProgress")}</span>
                        <span>{p.progress}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${p.progress}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-border/50 pt-3">
                      <div className="text-xs text-muted-foreground">
                        {t("pcBudget")}{" "}
                        <span className="font-semibold text-foreground">
                          ¥{p.budget.toLocaleString()}
                        </span>
                        <span className="mx-1.5">·</span>
                        {t("pcSpent")}{" "}
                        <span className="font-semibold text-amber-400">
                          ¥{p.spent.toLocaleString()}
                        </span>
                        <span className="ml-1.5">({Math.round((p.spent / p.budget) * 100)}%)</span>
                      </div>
                      <Link
                        href={`/crews-v2/finance/${p.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        {t("pcViewFinance")} →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {financeTab === "finance" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  {
                    labelKey: "finTotalBudget" as const,
                    value: `¥${FINANCIAL_SUMMARY.totalBudget.toLocaleString()}`,
                    color: "text-foreground",
                  },
                  {
                    labelKey: "finTotalSpent" as const,
                    value: `¥${FINANCIAL_SUMMARY.totalSpent.toLocaleString()}`,
                    color: "text-red-400",
                  },
                  {
                    labelKey: "finEscrowHeld" as const,
                    value: `¥${FINANCIAL_SUMMARY.escrowHeld.toLocaleString()}`,
                    color: "text-amber-400",
                  },
                  {
                    labelKey: "finPendingRelease" as const,
                    value: `¥${FINANCIAL_SUMMARY.pendingRelease.toLocaleString()}`,
                    color: "text-green-400",
                  },
                ].map((s) => (
                  <div key={s.labelKey} className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-1 text-xs text-muted-foreground">{t(s.labelKey)}</div>
                    <div className={cn("text-xl font-black", s.color)}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-bold">
                  <IconCurrencyDollar className="size-4 text-primary" />
                  {t("finPaymentRulesTitle")}
                </h3>
                <div className="space-y-3">
                  {[
                    { rule: t("finRule1"), amount: t("finRule1Amount"), color: "text-green-400" },
                    { rule: t("finRule2"), amount: t("finRule2Amount"), color: "text-blue-400" },
                    { rule: t("finRule3"), amount: t("finRule3Amount"), color: "text-amber-400" },
                    {
                      rule: t("finRule4"),
                      amount: t("finRule4Amount"),
                      color: "text-muted-foreground",
                    },
                  ].map((r) => (
                    <div
                      key={r.rule}
                      className="flex items-center justify-between border-b border-border/50 py-2.5 last:border-0"
                    >
                      <span className="text-sm text-foreground">{r.rule}</span>
                      <span className={cn("text-sm font-semibold", r.color)}>{r.amount}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Studio Plaza ── */}
      {mainTab !== "workbench" && (
        <>
          {/* Hero */}
          <div className="relative overflow-hidden border-b border-border">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/5" />
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 15% 50%, hsl(210 100% 56% / 0.1) 0%, transparent 55%), radial-gradient(circle at 85% 20%, hsl(42 95% 55% / 0.08) 0%, transparent 50%)",
              }}
            />
            <div className="relative mx-auto max-w-screen-2xl px-6 pb-8 pt-10">
              <div className="mb-3 flex items-center gap-2">
                <IconMovie className="size-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-widest text-primary">
                  {t("heroEyebrow")}
                </span>
              </div>
              <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
                <div className="max-w-2xl">
                  <h1 className="mb-3 text-3xl font-black leading-tight text-foreground md:text-4xl">
                    {t("heroTitleLine1")}
                    <br />
                    <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                      {t("heroTitleLine2")}
                    </span>
                  </h1>
                  <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
                    {t("heroSubtitle")}
                  </p>
                  <div className="mb-5 flex flex-wrap items-center gap-3">
                    <Link
                      href="/crews-v2/create"
                      className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
                    >
                      <IconPlus className="size-4" /> {t("heroCtaCreate")}
                    </Link>
                    <Link
                      href="/crews-v2?view=workbench"
                      className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-5 py-2.5 text-sm font-semibold text-accent transition-colors hover:bg-accent/20"
                    >
                      <IconSpeakerphone className="size-4" /> {t("heroCtaPostRoles")}
                    </Link>
                    <Link
                      href="/crews-v2?view=workbench"
                      className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80"
                    >
                      <IconStar className="size-4 text-accent" /> {t("heroCtaWorkbench")}
                    </Link>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    {PLATFORM_STATS.map((s) => (
                      <span key={s.labelKey}>
                        <strong className="text-foreground">{s.value}</strong> {t(s.labelKey)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Main content */}
          <div className="mx-auto max-w-screen-2xl px-6 py-6">
            <div className="flex gap-6">
              <div className="min-w-0 flex-1 space-y-6">
                {/* Search & filters */}
                <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                  <div className="relative">
                    <IconSearch className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder={t("searchPlaceholder")}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full rounded-xl border border-border bg-secondary py-2.5 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground transition-all focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-14 text-xs font-medium text-muted-foreground">
                      {t("filterStatusLabel")}
                    </span>
                    <div className="flex items-center gap-1 rounded-lg bg-secondary p-0.5">
                      {STATUS_TABS.map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setActiveStatus(tab)}
                          className={cn(
                            "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                            activeStatus === tab
                              ? "bg-primary text-primary-foreground shadow"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {t(STATUS_LABEL_KEY[tab])}
                          {tab === "Recruiting" && (
                            <span className="ml-1 rounded-full bg-green-400/20 px-1.5 py-0.5 text-xs text-green-400">
                              {recruitingCount}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-14 text-xs font-medium text-muted-foreground">
                      {t("filterRolesLabel")}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {ROLE_FILTERS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setActiveRole(activeRole === r ? "" : r)}
                          className={cn(
                            "rounded-lg border px-3 py-1 text-xs transition-colors",
                            activeRole === r
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {t(ROLE_LABEL_KEY[r])}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Studio grid */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-foreground">
                        {t("recommendedTitle")}
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("recommendedSubtitle")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {t("totalStudios", { count: filtered.length })}
                      </span>
                      <button
                        type="button"
                        onClick={clearAll}
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {t("viewAll")} <IconChevronRight className="size-3" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-4">
                    {filtered.length > 0 ? (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {filtered.map((studio) => (
                          <StudioCard key={studio.id} studio={studio} />
                        ))}
                      </div>
                    ) : (
                      <div className="py-16 text-center text-muted-foreground">
                        <IconMovie className="mx-auto mb-3 size-10 opacity-30" />
                        <p className="text-sm">{t("emptyTitle")}</p>
                        <button
                          type="button"
                          onClick={clearAll}
                          className="mt-3 text-xs text-primary hover:underline"
                        >
                          {t("clearFilters")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* How it works */}
                <div className="mb-8 mt-4">
                  <div className="mb-4 flex items-center gap-2">
                    <IconSparkles className="size-4 text-accent" />
                    <h2 className="text-base font-bold">{t("howItWorksTitle")}</h2>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      {
                        step: "01",
                        titleKey: "step1Title" as const,
                        descKey: "step1Desc" as const,
                        Icon: IconSpeakerphone,
                        color: "text-primary bg-primary/10 border-primary/20",
                      },
                      {
                        step: "02",
                        titleKey: "step2Title" as const,
                        descKey: "step2Desc" as const,
                        Icon: IconUsers,
                        color: "text-accent bg-accent/10 border-accent/20",
                      },
                      {
                        step: "03",
                        titleKey: "step3Title" as const,
                        descKey: "step3Desc" as const,
                        Icon: IconCircleCheck,
                        color: "text-green-400 bg-green-400/10 border-green-400/20",
                      },
                      {
                        step: "04",
                        titleKey: "step4Title" as const,
                        descKey: "step4Desc" as const,
                        Icon: IconBolt,
                        color: "text-violet-400 bg-violet-400/10 border-violet-400/20",
                      },
                    ].map(({ step, titleKey, descKey, Icon, color }) => (
                      <div
                        key={step}
                        className="relative overflow-hidden rounded-xl border border-border bg-card p-4"
                      >
                        <div className="absolute right-3 top-3 select-none text-4xl font-black text-border/60">
                          {step}
                        </div>
                        <div
                          className={cn(
                            "mb-3 flex size-9 items-center justify-center rounded-xl border",
                            color
                          )}
                        >
                          <Icon className="size-4" />
                        </div>
                        <div className="mb-1 text-sm font-semibold text-foreground">
                          {t(titleKey)}
                        </div>
                        <div className="text-xs leading-relaxed text-muted-foreground">
                          {t(descKey)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right rail */}
              <div className="hidden w-72 shrink-0 space-y-4 xl:block">
                <ActivityFeed />
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <IconStar className="size-4 text-accent" />
                    <span className="text-sm font-semibold">{t("gettingStartedTitle")}</span>
                  </div>
                  <div className="space-y-2.5 text-xs text-muted-foreground">
                    {(
                      [
                        "gettingStartedTip1",
                        "gettingStartedTip2",
                        "gettingStartedTip3",
                        "gettingStartedTip4",
                      ] as const
                    ).map((key, i) => (
                      <div key={key} className="flex items-start gap-2">
                        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {i + 1}
                        </span>
                        <span className="leading-relaxed">{t(key)}</span>
                      </div>
                    ))}
                  </div>
                  <Link
                    href="/crews-v2?view=workbench"
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 py-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                  >
                    {t("gettingStartedCta")} <IconChevronRight className="size-3" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function CrewsV2Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <StudioPlazaContent />
    </Suspense>
  );
}
