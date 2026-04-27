"use client";

import { useState } from "react";
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
  IconBriefcase,
  IconFilter,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  STATUS_TABS,
  ROLE_FILTERS,
  PLATFORM_STATS,
  useCrews,
  useOpenJobs,
  useCrewLanding,
} from "@/app/(site)/crews/_hooks/use-crew";
import { CrewCard } from "@/app/(site)/crews/_components/crew-card";
import { JobCard } from "@/app/(site)/crews/_components/job-card";
import { ActivityTicker } from "@/app/(site)/crews/_components/activity-ticker";

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

type Tab = "crews" | "jobs";

export default function CrewsPage() {
  const t = useTranslations("crew");
  const [tab, setTab] = useState<Tab>("crews");
  const [activeStatus, setActiveStatus] = useState("all");
  const [activeRole, setActiveRole] = useState("");
  const [search, setSearch] = useState("");

  // Server-side filtering via hooks; client state just feeds them.
  const { data: crews = [], isLoading: crewsLoading } = useCrews({
    search,
    status: activeStatus,
    role: activeRole,
  });
  const { data: jobs = [], isLoading: jobsLoading } = useOpenJobs({
    roleName: activeRole || undefined,
  });
  const { data: landing } = useCrewLanding();

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero ────────────────────────────────────────── */}
      <div className="relative overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=2400&q=80"
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover object-[80%_center] opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/30" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 50%, hsl(210 100% 56% / 0.12) 0%, transparent 55%), radial-gradient(circle at 85% 20%, hsl(0 78% 52% / 0.1) 0%, transparent 50%)",
          }}
        />
        <div className="relative mx-auto max-w-screen-2xl px-6 pb-12 pt-14">
          <div className="mb-3 flex items-center gap-2">
            <IconMovie className="size-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">
              {t("plaza")}
            </span>
          </div>
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
              <Link
                href="/crews/create"
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
              >
                <IconPlus className="size-4" /> {t("createStudio")}
              </Link>
              <Link
                href="/crews/create"
                className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-5 py-2.5 text-sm font-semibold text-accent transition-colors hover:bg-accent/20"
              >
                <IconSpeakerphone className="size-4" /> {t("postRoles")}
              </Link>
              <Link
                href="/studio/projects"
                className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80"
              >
                <IconStar className="size-4 text-accent" /> {t("myWorkbench")}
              </Link>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {(landing?.stats ?? PLATFORM_STATS).map((s) => (
                <span key={s.labelKey}>
                  <strong className="text-foreground">{s.value}</strong> {t(s.labelKey)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Live activity strip ─────────────────────────── */}
      {landing?.recent && <ActivityTicker items={landing.recent} />}

      {/* ── Main ────────────────────────────────────────── */}
      <div className="mx-auto max-w-screen-2xl px-6 py-8">
        {/* Tabs + search */}
        <div className="mb-8 flex flex-col items-stretch gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Tabs */}
          <div className="inline-flex items-center gap-1 self-start rounded-full border border-white/10 bg-white/[0.03] p-1 backdrop-blur-md">
            <TabButton
              active={tab === "crews"}
              onClick={() => setTab("crews")}
              icon={<IconMovie className="size-4" />}
              label={t("tabCrews")}
              count={crews.length}
            />
            <TabButton
              active={tab === "jobs"}
              onClick={() => setTab("jobs")}
              icon={<IconBriefcase className="size-4" />}
              label={t("tabOpenRoles")}
              count={jobs.length}
            />
          </div>

          {/* Search */}
          {tab === "crews" && (
            <div className="relative w-full max-w-md">
              <IconSearch className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder={t("searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-full border border-white/10 bg-white/[0.04] py-2.5 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground backdrop-blur-md transition-all focus:border-white/25 focus:bg-white/[0.06] focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Filter rows — only on Crews tab */}
        {tab === "crews" && (
          <div className="mb-6 space-y-4">
            <FilterRow
              label={t("statusLabel")}
              options={STATUS_TABS.map((s) => ({ id: s.value, name: t(s.labelKey) }))}
              selected={activeStatus}
              onSelect={setActiveStatus}
            />
            <FilterRow
              label={t("rolesLabel")}
              options={[
                { id: "", name: t("filterAll") },
                ...ROLE_FILTERS.map((r) => ({ id: r, name: r })),
              ]}
              selected={activeRole}
              onSelect={setActiveRole}
            />
          </div>
        )}

        {/* Filter row — only role filter on Jobs tab */}
        {tab === "jobs" && (
          <div className="mb-6">
            <FilterRow
              label={t("rolesLabel")}
              options={[
                { id: "", name: t("filterAll") },
                ...ROLE_FILTERS.map((r) => ({ id: r, name: r })),
              ]}
              selected={activeRole}
              onSelect={setActiveRole}
            />
          </div>
        )}

        {/* Section header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              {tab === "crews" ? t("recommended") : t("tabOpenRoles")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tab === "crews" ? t("recommendedDesc") : t("heroDesc")}
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <IconFilter className="size-3.5" />
            {tab === "crews"
              ? t("totalStudios", { count: crews.length })
              : t("totalRoles", { count: jobs.length })}
          </span>
        </div>

        {/* Grid */}
        {tab === "crews" ? (
          crewsLoading ? (
            <GridSkeleton />
          ) : crews.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {crews.map((studio) => (
                <CrewCard key={studio.id} studio={studio} />
              ))}
            </div>
          ) : (
            <EmptyState
              label={t("noResults")}
              clearLabel={t("clearFilters")}
              onClear={() => {
                setActiveStatus("all");
                setActiveRole("");
                setSearch("");
              }}
            />
          )
        ) : jobsLoading ? (
          <GridSkeleton />
        ) : jobs.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        ) : (
          <EmptyState
            label={t("noOpenRoles")}
            clearLabel={t("clearFilters")}
            onClear={() => setActiveRole("")}
          />
        )}

        {/* How It Works — bottom marketing band */}
        <section className="mt-20">
          <div className="mb-6 flex items-center gap-2">
            <IconSparkles className="size-4 text-accent" />
            <h2 className="text-lg font-bold">{t("howItWorks")}</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map(({ step, titleKey, descKey, icon: Icon, color }) => (
              <div
                key={step}
                className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-md transition-colors hover:border-white/20"
              >
                <div className="absolute right-3 top-3 select-none text-5xl font-black text-foreground/[0.06]">
                  {step}
                </div>
                <div
                  className={cn(
                    "mb-3 flex size-10 items-center justify-center rounded-xl border",
                    color
                  )}
                >
                  <Icon className="size-5" />
                </div>
                <div className="mb-1.5 text-sm font-semibold text-foreground">{t(titleKey)}</div>
                <div className="text-xs leading-relaxed text-muted-foreground">{t(descKey)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all",
        active
          ? "bg-white text-black shadow-sm"
          : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
      )}
    >
      {icon}
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
          active ? "bg-black/10 text-black" : "bg-white/10 text-foreground/70"
        )}
      >
        {count}
      </span>
    </button>
  );
}

function FilterRow({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground lg:w-16">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = selected === opt.id;
          return (
            <button
              key={opt.id || "all"}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all",
                active
                  ? "border-white/15 bg-white text-black shadow-sm"
                  : "border-white/10 bg-white/[0.04] text-muted-foreground backdrop-blur-md hover:border-white/20 hover:bg-white/[0.07] hover:text-foreground"
              )}
            >
              {opt.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="aspect-[4/3] animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]"
        />
      ))}
    </div>
  );
}

function EmptyState({
  label,
  clearLabel,
  onClear,
}: {
  label: string;
  clearLabel: string;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02] py-20 text-center text-muted-foreground">
      <IconMovie className="mb-3 size-10 opacity-30" />
      <p className="text-sm">{label}</p>
      <button type="button" onClick={onClear} className="mt-3 text-xs text-primary hover:underline">
        {clearLabel}
      </button>
    </div>
  );
}
