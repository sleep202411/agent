"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  IconMovie,
  IconPlus,
  IconSpeakerphone,
  IconStar,
  IconSparkles,
  IconCircleCheck,
  IconUsers,
  IconBolt,
  IconSearch,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  MOCK_CREWS,
  STATUS_TABS,
  ROLE_FILTERS,
  PLATFORM_STATS,
} from "@/app/(crews)/_components/crew-mock";
import { CrewCard } from "@/app/(crews)/_components/crew-card";
import { CrewActivityFeed } from "@/app/(crews)/_components/crew-activity-feed";

const HOW_IT_WORKS = [
  {
    step: "01",
    titleKey: "howPublish",
    descKey: "howPublishDesc",
    icon: IconSpeakerphone,
    color: "text-primary bg-primary/10 border-primary/20",
  },
  {
    step: "02",
    titleKey: "howSignup",
    descKey: "howSignupDesc",
    icon: IconUsers,
    color: "text-accent bg-accent/10 border-accent/20",
  },
  {
    step: "03",
    titleKey: "howScreen",
    descKey: "howScreenDesc",
    icon: IconCircleCheck,
    color: "text-green-400 bg-green-400/10 border-green-400/20",
  },
  {
    step: "04",
    titleKey: "howCollaborate",
    descKey: "howCollaborateDesc",
    icon: IconBolt,
    color: "text-violet-400 bg-violet-400/10 border-violet-400/20",
  },
] as const;

export default function CrewsPage() {
  const t = useTranslations("crew");
  const [activeStatus, setActiveStatus] = useState("all");
  const [activeRole, setActiveRole] = useState("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return MOCK_CREWS.filter((s) => {
      const matchStatus = activeStatus === "all" || s.status === activeStatus;
      const matchRole = !activeRole || s.rolesNeeded.some((r) => r.includes(activeRole));
      const matchSearch =
        !search ||
        s.name.includes(search) ||
        s.ipName.includes(search) ||
        s.rolesNeeded.some((r) => r.includes(search));
      return matchStatus && matchRole && matchSearch;
    });
  }, [activeStatus, activeRole, search]);

  const recruitingCount = MOCK_CREWS.filter((s) => s.status === "recruiting").length;

  return (
    <div className="min-h-screen bg-background">
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
              {t("plaza")}
            </span>
          </div>
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <h1 className="mb-3 text-3xl font-black leading-tight text-foreground md:text-4xl">
                {t("heroTitle1")}
                <br />
                <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  {t("heroTitle2")}
                </span>
              </h1>
              <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{t("heroDesc")}</p>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <a
                  href="/crews/create"
                  className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
                >
                  <IconPlus className="size-4" /> {t("createStudio")}
                </a>
                <a
                  href="/crews/create"
                  className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-5 py-2.5 text-sm font-semibold text-accent transition-colors hover:bg-accent/20"
                >
                  <IconSpeakerphone className="size-4" /> {t("postRoles")}
                </a>
                <Link
                  href="/projects"
                  className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80"
                >
                  <IconStar className="size-4 text-accent" /> {t("myWorkbench")}
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

      {/* Main */}
      <div className="mx-auto max-w-screen-2xl px-6 py-6">
        <div className="flex gap-6">
          <div className="min-w-0 flex-1 space-y-6">
            {/* Search & Filters */}
            <div className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="relative">
                <IconSearch className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t("searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-border bg-secondary py-2.5 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground transition-all focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-14 text-xs font-medium text-muted-foreground">
                  {t("statusLabel")}
                </span>
                <div className="flex items-center gap-1 rounded-lg bg-secondary p-0.5">
                  {STATUS_TABS.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setActiveStatus(tab.value)}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                        activeStatus === tab.value
                          ? "bg-primary text-primary-foreground shadow"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t(tab.labelKey)}
                      {tab.value === "recruiting" && (
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
                  {t("rolesLabel")}
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
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Grid */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-foreground">{t("recommended")}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("recommendedDesc")}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("totalStudios", { count: filtered.length })}
                </span>
              </div>
              <div className="mt-4">
                {filtered.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((studio) => (
                      <CrewCard key={studio.id} studio={studio} />
                    ))}
                  </div>
                ) : (
                  <div className="py-16 text-center text-muted-foreground">
                    <IconMovie className="mx-auto mb-3 size-10 opacity-30" />
                    <p className="text-sm">{t("noResults")}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveStatus("all");
                        setActiveRole("");
                        setSearch("");
                      }}
                      className="mt-3 text-xs text-primary hover:underline"
                    >
                      {t("clearFilters")}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* How It Works */}
            <div className="mb-8 mt-4">
              <div className="mb-4 flex items-center gap-2">
                <IconSparkles className="size-4 text-accent" />
                <h2 className="text-base font-bold">{t("howItWorks")}</h2>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {HOW_IT_WORKS.map(({ step, titleKey, descKey, icon: Icon, color }) => (
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
                    <div className="mb-1 text-sm font-semibold text-foreground">{t(titleKey)}</div>
                    <div className="text-xs leading-relaxed text-muted-foreground">
                      {t(descKey)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="hidden w-72 shrink-0 space-y-4 xl:block">
            <CrewActivityFeed />
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center gap-2">
                <IconStar className="size-4 text-accent" />
                <span className="text-sm font-semibold">{t("gettingStarted")}</span>
              </div>
              <div className="space-y-2.5 text-xs text-muted-foreground">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {i}
                    </span>
                    <span className="leading-relaxed">{t(`tip${i}`)}</span>
                  </div>
                ))}
              </div>
              <Link
                href="/projects"
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 py-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
              >
                {t("goToWorkbench")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
