"use client";

/**
 * Plaza "Positions" view — flat list across all crews.
 *
 * Two-column discovery layout:
 *   left   server-backed multi-select filters for employment type,
 *          seniority and work mode
 *   right  responsive job cards with one deliberate application CTA
 *
 * Filtering, sorting and cursor pagination are server-owned. The client keeps
 * loaded pages only for rendering, so large recruitment marketplaces do not
 * silently disappear after an arbitrary first-page cap.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { IconBriefcase, IconCoin, IconMapPin, IconUserCircle } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { env } from "@/src/env";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
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
import { crewApi, isCrewCursorError } from "@/app/(site)/crews/_hooks/api";

interface PositionWithCrew {
  position: CrewPositionDTO;
  crew: Pick<CrewDTO, "id" | "name" | "logo" | "tagline" | "genres" | "styles">;
}

interface PublicPositionsResult {
  items: PositionWithCrew[];
  nextCursor: string | null;
  total: number;
}

type SortMode = "newest" | "oldest";

export function PositionsTab() {
  const t = useTranslations("crew");
  const tw = useTranslations("workspace");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;

  // Multi-select per facet; empty set = no constraint.
  const [employment, setEmployment] = useState<Set<EmploymentType>>(new Set());
  const [seniority, setSeniority] = useState<Set<ExperienceLevel>>(new Set());
  const [workMode, setWorkMode] = useState<Set<WorkMode>>(new Set());
  const [sort, setSort] = useState<SortMode>("newest");

  const employmentQuery = useMemo(() => [...employment].sort().join(","), [employment]);
  const seniorityQuery = useMemo(() => [...seniority].sort().join(","), [seniority]);
  const workModeQuery = useMemo(() => [...workMode].sort().join(","), [workMode]);
  const positions = useInfiniteQuery({
    queryKey: [
      "crew",
      "positions",
      "public",
      employmentQuery,
      seniorityQuery,
      workModeQuery,
      sort,
    ] as const,
    queryFn: ({ pageParam }) =>
      crewApi.get<PublicPositionsResult>("/positions", {
        query: {
          limit: 36,
          cursor: pageParam,
          employment: employmentQuery,
          seniority: seniorityQuery,
          workMode: workModeQuery,
          sort,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 60_000,
  });
  const all = useMemo(
    () => positions.data?.pages.flatMap((page) => page.items) ?? [],
    [positions.data]
  );
  const total = positions.data?.pages[0]?.total ?? 0;

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
            {t("showingJobsCount", { count: total })}
          </h2>
          <SortMenu value={sort} onChange={setSort} t={t} />
        </header>

        {positions.isLoading ? (
          <PositionsSkeleton />
        ) : all.length === 0 && !positions.isError ? (
          <EmptyState
            message={
              employment.size || seniority.size || workMode.size
                ? t("noFilterMatches")
                : t("noOpenPositions")
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {all.map(({ position, crew }) => (
                <PositionCard key={position.id} crew={crew} position={position} locale={locale} />
              ))}
            </div>
            {positions.hasNextPage && !positions.isError ? (
              <div className="flex justify-center pt-3">
                <Button
                  type="button"
                  variant="outline"
                  color="muted"
                  disabled={positions.isFetching}
                  onClick={() => void positions.fetchNextPage()}
                >
                  {positions.isFetchingNextPage ? tc("loading") : tc("loadMore")}
                </Button>
              </div>
            ) : null}
          </>
        )}
        {positions.isError && (
          <div
            role="alert"
            className="flex items-center justify-center gap-3 text-sm text-muted-foreground"
          >
            <span>
              {positions.error instanceof Error ? positions.error.message : tc("loadFailed")}
            </span>
            <Button
              variant="outline"
              disabled={positions.isFetching}
              onClick={() =>
                void (positions.isFetchNextPageError &&
                !isCrewCursorError(positions.error, "CREW_POSITION_CURSOR_INVALID")
                  ? positions.fetchNextPage()
                  : positions.refetch())
              }
            >
              {tc("retry")}
            </Button>
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
    <article className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      {/* Identity row: crew logo + crew name */}
      <Link href={crewHref} className="flex items-center gap-2.5">
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={crew.name} className="size-full object-cover" loading="lazy" />
          ) : (
            <IconUserCircle className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] text-muted-foreground">{crew.name}</div>
          {position.location ? (
            <div className="flex items-center gap-1 truncate text-[10px] text-muted-foreground/80">
              <IconMapPin className="size-2.5" />
              {position.location}
            </div>
          ) : null}
        </div>
      </Link>

      {/* Title */}
      <h3 className="text-sm font-semibold text-foreground">
        {translatePosition(position.positionType)}
      </h3>

      {/* Description (2-line clamp) */}
      {position.description ? (
        <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
          {position.description}
        </p>
      ) : (
        <p className="line-clamp-2 min-h-[2.5rem] text-xs italic leading-relaxed text-muted-foreground/60">
          {tCrew("noPositionDescription")}
        </p>
      )}

      {/* Chips */}
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span
            key={c}
            className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
          >
            {c}
          </span>
        ))}
      </div>

      {/* Salary highlight */}
      {salary ? (
        <div className="flex items-center gap-1 text-xs font-semibold text-amber-500">
          <IconCoin className="size-3.5" />
          {salary}
        </div>
      ) : null}

      {/* One deliberate CTA. FizzDragon does not support private messages:
          communication starts in the crew group after membership is granted. */}
      <div className="mt-auto pt-0.5">
        <Button
          asChild={canApply}
          variant="solid"
          color="primary"
          size="sm"
          disabled={!canApply}
          className="h-8 w-full px-2 text-xs"
        >
          {canApply ? <Link href={crewHref}>{ctaLabel}</Link> : <span>{ctaLabel}</span>}
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
  };
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{t("sortBy")}:</span>
      <NativeSelect
        value={value}
        onChange={(nextValue) => onChange(nextValue as SortMode)}
        aria-label={t("sortBy")}
        className="w-auto cursor-pointer rounded-md border-border bg-card text-xs font-medium text-foreground focus:ring-1 focus:ring-primary"
      >
        {(Object.keys(labels) as SortMode[]).map((k) => (
          <option key={k} value={k}>
            {labels[k]}
          </option>
        ))}
      </NativeSelect>
    </div>
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

function PositionsSkeleton() {
  return (
    <div
      aria-hidden
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
    >
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="h-64 animate-pulse rounded-xl bg-card" />
      ))}
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
