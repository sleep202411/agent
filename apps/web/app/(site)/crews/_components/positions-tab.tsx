"use client";

/**
 * Plaza "Positions" view — flat list across all crews.
 *
 * Refactored 2026-05-25 to a Milao-style two-column layout:
 *   left   sidebar with quick-filter checkboxes (employment type,
 *          seniority, work mode) plus a placeholder "Job alert" card
 *   right  job grid (3 cols at xl) of larger, breathing cards that
 *          surface logo + title + description + tag chips + dual CTA
 *
 * Filtering is client-side over the first page of results (limit 64).
 * That's fine for the current data volume; promote to a server-side
 * filter pass when the list grows past a few hundred open positions.
 *
 * Data source: real aggregated positions from `GET /aurora/positions`.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  IconBriefcase,
  IconChevronDown,
  IconCoin,
  IconMail,
  IconMapPin,
  IconUserCircle,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";
import type { CrewDTO, CrewPositionDTO, CurrencyCode } from "@/app/(site)/crews/_hooks/use-crew";
import {
  CURRENCY_SYMBOLS,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  WORK_MODES,
  ZERO_DECIMAL_CURRENCIES,
  type EmploymentType,
  type ExperienceLevel,
  type WorkMode,
} from "@repo/shared/crew";
import { crewApi } from "@/app/(site)/crews/_hooks/api";

interface PositionWithCrew {
  position: CrewPositionDTO;
  crew: Pick<CrewDTO, "id" | "name" | "logo" | "tagline" | "genres" | "styles">;
}

interface PublicPositionsResult {
  items: PositionWithCrew[];
  nextCursor: string | null;
}

type SortMode = "newest" | "oldest" | "salaryHigh";

export function PositionsTab() {
  const t = useTranslations("crew");
  const tw = useTranslations("workspace");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;

  const { data, isError } = useQuery({
    queryKey: ["crew", "positions", "public", "first"] as const,
    queryFn: () => crewApi.get<PublicPositionsResult>("/positions", { query: { limit: 64 } }),
    staleTime: 60_000,
  });
  const all = data?.items ?? [];

  // ─── Client-side filter state ─────────────────────────
  // Multi-select per facet; empty set = no constraint (show all).
  const [employment, setEmployment] = useState<Set<EmploymentType>>(new Set());
  const [seniority, setSeniority] = useState<Set<ExperienceLevel>>(new Set());
  const [workMode, setWorkMode] = useState<Set<WorkMode>>(new Set());
  const [sort, setSort] = useState<SortMode>("newest");

  const filtered = useMemo(() => {
    const rows = all.filter(({ position: p }) => {
      if (employment.size && !employment.has(p.employmentType)) return false;
      if (seniority.size && !seniority.has(p.experienceLevel)) return false;
      if (workMode.size && !workMode.has(p.workMode)) return false;
      return true;
    });
    // Server returns newest-first by default; manual sort handles
    // user-chosen variants.
    if (sort === "oldest") return [...rows].reverse();
    if (sort === "salaryHigh") {
      return [...rows].sort(
        (a, b) => (b.position.salary.maxAmount ?? 0) - (a.position.salary.maxAmount ?? 0)
      );
    }
    return rows;
  }, [all, employment, seniority, workMode, sort]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
      {/* ─── Sidebar ───────────────────────────────────── */}
      <aside className="space-y-5">
        <FilterSection
          label={t("filterEmployment")}
          options={EMPLOYMENT_TYPES.map((v) => ({
            value: v,
            label: tw(`employment${employmentI18n(v)}`),
          }))}
          selected={employment}
          onToggle={(v) => setEmployment((prev) => toggle(prev, v as EmploymentType))}
        />
        <FilterSection
          label={t("filterSeniority")}
          options={EXPERIENCE_LEVELS.map((v) => ({
            value: v,
            label: tw(`experience${capitalize(v)}`),
          }))}
          selected={seniority}
          onToggle={(v) => setSeniority((prev) => toggle(prev, v as ExperienceLevel))}
        />
        <FilterSection
          label={t("filterWorkMode")}
          options={WORK_MODES.map((v) => ({
            value: v,
            label: tw(`position${capitalize(v)}`),
          }))}
          selected={workMode}
          onToggle={(v) => setWorkMode((prev) => toggle(prev, v as WorkMode))}
        />
      </aside>

      {/* ─── Main column ───────────────────────────────── */}
      <section className="space-y-4">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">
            {t("showingJobsCount", { count: filtered.length })}
          </h2>
          <SortMenu value={sort} onChange={setSort} t={t} />
        </header>

        {isError || all.length === 0 ? (
          <EmptyState message={isError ? tc("loadFailed") : t("noOpenPositions")} />
        ) : filtered.length === 0 ? (
          <EmptyState message={t("noFilterMatches")} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map(({ position, crew }) => (
              <PositionCard key={position.id} crew={crew} position={position} locale={locale} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────

function PositionCard({
  crew,
  position,
  locale,
}: {
  crew: PositionWithCrew["crew"];
  position: PositionWithCrew["position"];
  locale: Locale;
}) {
  const t = useTranslations("workspace");
  const tCrew = useTranslations("crew");
  const translatePosition = useTranslatePositionValue();
  const crewHref = localizePath(`/crews/${crew.id}`, locale);
  const logoUrl = crew.logo
    ? crew.logo.startsWith("http")
      ? crew.logo
      : `${env.BANNER_BASE_URL.replace(/\/+$/, "")}/${crew.logo.replace(/^\/+/, "")}`
    : "";

  const isFull = position.status === "full" || position.recruitedCount >= position.targetCount;
  const isFrozen = position.status === "frozen";
  const canApply = !isFull && !isFrozen;
  const ctaLabel = isFrozen ? tCrew("ctaPaused") : isFull ? tCrew("ctaFull") : tCrew("ctaApply");

  // Three chips: employment type, experience, work mode — mirrors the
  // Milao reference. Salary stays as its own emphasis line because the
  // amount is the single most-scanned field on a job card.
  const chips: string[] = [
    t(`employment${employmentI18n(position.employmentType)}`),
    position.experienceLevel === "any"
      ? t("experienceAny")
      : t(`experience${capitalize(position.experienceLevel)}`),
    t(`position${capitalize(position.workMode)}`),
  ];

  const salary = formatSalaryShort(position, t);

  return (
    <article className="group flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      {/* Identity row: crew logo + crew name */}
      <Link href={crewHref} className="flex items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={crew.name} className="size-full object-cover" loading="lazy" />
          ) : (
            <IconUserCircle className="size-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs text-muted-foreground">{crew.name}</div>
          {position.location ? (
            <div className="flex items-center gap-1 truncate text-[11px] text-muted-foreground/80">
              <IconMapPin className="size-3" />
              {position.location}
            </div>
          ) : null}
        </div>
      </Link>

      {/* Title */}
      <h3 className="text-base font-semibold text-foreground">
        {translatePosition(position.positionType)}
      </h3>

      {/* Description (3-line clamp) */}
      {position.description ? (
        <p className="line-clamp-3 min-h-[3.75rem] text-sm leading-relaxed text-muted-foreground">
          {position.description}
        </p>
      ) : (
        <p className="line-clamp-3 min-h-[3.75rem] text-sm italic leading-relaxed text-muted-foreground/60">
          {tCrew("noPositionDescription")}
        </p>
      )}

      {/* Chips */}
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <span
            key={c}
            className="rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary"
          >
            {c}
          </span>
        ))}
      </div>

      {/* Salary highlight */}
      {salary ? (
        <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-500">
          <IconCoin className="size-4" />
          {salary}
        </div>
      ) : null}

      {/* CTAs */}
      <div className="mt-auto flex gap-2 pt-1">
        <Button
          asChild={canApply}
          variant="solid"
          color="primary"
          size="sm"
          disabled={!canApply}
          className="flex-1"
        >
          {canApply ? <Link href={crewHref}>{ctaLabel}</Link> : <span>{ctaLabel}</span>}
        </Button>
        <Button
          type="button"
          variant="outline"
          color="muted"
          size="sm"
          className="flex-1"
          onClick={() => toast.info(tCrew("messagesComingSoon"))}
        >
          <IconMail className="size-4" />
          {tCrew("ctaMessages")}
        </Button>
      </div>
    </article>
  );
}

// ─── Sidebar atoms ────────────────────────────────────

function FilterSection<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: Set<T>;
  onToggle: (value: T) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{label}</h3>
      <ul className="space-y-2">
        {options.map((o) => {
          const on = selected.has(o.value);
          return (
            <li key={o.value}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/90 transition-colors hover:bg-secondary/40">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(o.value)}
                  className="size-4 cursor-pointer accent-primary"
                />
                {o.label}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SortMenu({
  value,
  onChange,
  t,
}: {
  value: SortMode;
  onChange: (v: SortMode) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const labels: Record<SortMode, string> = {
    newest: t("sortNewest"),
    oldest: t("sortOldest"),
    salaryHigh: t("sortSalaryHigh"),
  };
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{t("sortBy")}:</span>
      <span className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as SortMode)}
          className="cursor-pointer appearance-none rounded-md border border-border bg-card py-1 pl-2 pr-7 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {(Object.keys(labels) as SortMode[]).map((k) => (
            <option key={k} value={k}>
              {labels[k]}
            </option>
          ))}
        </select>
        <IconChevronDown className="pointer-events-none absolute right-1.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      </span>
    </label>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <IconBriefcase className="size-5" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ─── Pure helpers ─────────────────────────────────────

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** snake_case → PascalCase for i18n key building (full_time → FullTime). */
function employmentI18n(v: EmploymentType): string {
  return v
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

/** Compact salary like "¥8K-15K · 项目费". */
function formatSalaryShort(
  p: CrewPositionDTO,
  t: ReturnType<typeof useTranslations>
): string | null {
  if (p.salary.negotiable) return t("salaryNegotiable");
  const { currency, minAmount, maxAmount, period } = p.salary;
  if ((minAmount == null && maxAmount == null) || currency == null) return null;
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency as CurrencyCode);
  const toDisplay = (cents: number) => (isZeroDecimal ? cents : cents / 100);
  const fmt = (cents: number | null) => {
    if (cents == null) return "—";
    const v = toDisplay(cents);
    if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`;
    return String(v);
  };
  const symbol = CURRENCY_SYMBOLS[currency as CurrencyCode];
  const range = `${symbol}${fmt(minAmount)}-${fmt(maxAmount)}`;
  const periodKey =
    period === "month"
      ? "salaryPeriodMonth"
      : period === "episode"
        ? "salaryPeriodEpisode"
        : period === "project"
          ? "salaryPeriodProject"
          : null;
  return periodKey ? `${range} · ${t(periodKey)}` : range;
}
