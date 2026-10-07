"use client";

/**
 * Plaza "Positions" view — flat list across all crews.
 *
 * Three-column discovery layout:
 *   left   server-backed multi-select filters for employment type,
 *          certification capabilities and work mode
 *   middle selectable jobs; right selected job details and application CTA
 *
 * Filtering, sorting and cursor pagination are server-owned. The client keeps
 * loaded pages only for rendering, so large recruitment marketplaces do not
 * silently disappear after an arbitrary first-page cap.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { IconBriefcase, IconCoin, IconMapPin, IconUserCircle } from "@tabler/icons-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { OpeningDetails } from "./opening-details";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { env } from "@/src/env";
import { Button } from "@/components/ui/button";
import { exactMinorUnits } from "../_hooks/use-application-terms";
import { CREW_CURRENCY } from "@/src/lib/crew-money";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";
import type { CrewDTO, CrewPositionDTO, CurrencyCode } from "@/app/(site)/crews/_hooks/use-crew";
import {
  CURRENCY_SYMBOLS,
  PRESET_POSITIONS,
  CREW_GENRES,
  SALARY_PERIODS,
  EMPLOYMENT_TYPES,
  WORK_MODES,
  ZERO_DECIMAL_CURRENCIES,
  type EmploymentType,
  type WorkMode,
} from "@repo/shared/crew";
import { listUserLevelOptions } from "@/src/services/user-level-apply";
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
  const { user } = useCurrentUser();
  const auth = useAuthDialog();
  const filterT = useTranslations("crewOpeningFilters");
  const positionLabel = useTranslatePositionValue();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const detailsRef = useRef<HTMLElement>(null);
  const [category, setCategory] = useState("");
  const [genre, setGenre] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [salaryPeriod, setSalaryPeriod] = useState("project");
  const [budget, setBudget] = useState<{
    salaryMinMinor?: string;
    salaryMaxMinor?: string;
    salaryCurrency?: string;
    salaryPeriod?: string;
  }>({});
  const [salaryError, setSalaryError] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const openingT = useTranslations("crewOpening");
  const [employment, setEmployment] = useState<Set<EmploymentType>>(new Set());
  const [skills, setSkills] = useState<Set<string>>(new Set());
  const capabilities = useQuery({
    queryKey: ["user-level-options"],
    queryFn: listUserLevelOptions,
    retry: false,
  });
  const [workMode, setWorkMode] = useState<Set<WorkMode>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("newest");

  const employmentQuery = useMemo(() => [...employment].sort().join(","), [employment]);
  const skillsQuery = useMemo(() => JSON.stringify([...skills].sort()), [skills]);
  const workModeQuery = useMemo(() => [...workMode].sort().join(","), [workMode]);
  const positions = useInfiniteQuery({
    queryKey: [
      "crew",
      "positions",
      "public",
      user?.id ?? null,
      savedOnly,
      category,
      genre,
      budget,
      employmentQuery,
      skillsQuery,
      workModeQuery,
      sort,
    ] as const,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<PublicPositionsResult>("/positions", {
        signal,
        cache: "no-store",
        query: {
          limit: 36,
          positionType: category || undefined,
          genre: genre || undefined,
          ...budget,
          saved: savedOnly ? "true" : undefined,
          cursor: pageParam,
          employment: employmentQuery,
          skills: skillsQuery,
          workMode: workModeQuery,
          sort,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 60_000,
  });
  const all = useMemo(
    () => (positions.isError ? [] : (positions.data?.pages.flatMap((page) => page.items) ?? [])),
    [positions.data, positions.isError]
  );
  const selected = all.find(({ position }) => position.id === selectedId) ?? all[0];
  const total = positions.isError ? 0 : (positions.data?.pages[0]?.total ?? 0);

  return (
    <div className="grid min-h-0 grid-cols-1 gap-0 overflow-hidden bg-background lg:flex-1 lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[230px_330px_minmax(0,1fr)] xl:grid-cols-[280px_400px_minmax(0,1fr)] 2xl:grid-cols-[320px_460px_minmax(0,1fr)]">
      {/* ─── Sidebar ───────────────────────────────────── */}
      <div className="border-b border-white/10 p-3 lg:hidden">
        <Button
          variant="outline"
          aria-expanded={filtersOpen}
          aria-controls="opening-filters"
          onClick={() => setFiltersOpen((value) => !value)}
        >
          {filterT("filters")}
        </Button>
      </div>
      <aside
        id="opening-filters"
        className={`${filtersOpen ? "block" : "hidden"} space-y-3 text-xs border-r border-white/10 p-4 lg:block lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain`}
      >
        <Button
          variant={savedOnly ? "solid" : "outline"}
          aria-pressed={savedOnly}
          onClick={() => {
            if (!user) auth.open();
            else setSavedOnly((value) => !value);
          }}
        >
          {openingT("savedJobs")}
        </Button>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const min = salaryMin.trim() ? exactMinorUnits(salaryMin.trim()) : undefined;
            const max = salaryMax.trim() ? exactMinorUnits(salaryMax.trim()) : undefined;
            if (
              min === null ||
              max === null ||
              (min !== undefined && max !== undefined && BigInt(min) > BigInt(max))
            ) {
              setSalaryError(filterT("invalid"));
              return;
            }
            setSalaryError("");
            setBudget({
              salaryMinMinor: min,
              salaryMaxMinor: max,
              salaryCurrency: CREW_CURRENCY,
              salaryPeriod,
            });
          }}
        >
          <h3 className="text-xs font-semibold">
            {filterT("salary", { currency: CREW_CURRENCY })}
          </h3>
          <div className="flex gap-2">
            <Input
              inputMode="decimal"
              aria-label={filterT("min")}
              placeholder={filterT("min")}
              value={salaryMin}
              onChange={(event) => setSalaryMin(event.target.value)}
            />
            <Input
              inputMode="decimal"
              aria-label={filterT("max")}
              placeholder={filterT("max")}
              value={salaryMax}
              onChange={(event) => setSalaryMax(event.target.value)}
            />
          </div>
          <NativeSelect
            aria-label={filterT("period")}
            value={salaryPeriod}
            onChange={setSalaryPeriod}
          >
            {SALARY_PERIODS.map((period) => (
              <option key={period} value={period}>
                {tw(`salaryPeriod${capitalize(period)}`)}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline">
            {filterT("apply")}
          </Button>
          {salaryError && (
            <p role="alert" className="text-sm text-destructive">
              {salaryError}
            </p>
          )}
        </form>
        <label className="block space-y-2 text-sm font-semibold">
          {filterT("category")}
          <NativeSelect value={category} onChange={setCategory}>
            <option value="">{filterT("all")}</option>
            {PRESET_POSITIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {positionLabel(item.value)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="block space-y-2 text-sm font-semibold">
          {filterT("genre")}
          <NativeSelect value={genre} onChange={setGenre}>
            <option value="">{filterT("all")}</option>
            {CREW_GENRES.map((value) => (
              <option key={value} value={value}>
                {filterT(`genres.${value}`)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button
          variant="ghost"
          onClick={() => {
            setCategory("");
            setGenre("");
            setSalaryMin("");
            setSalaryMax("");
            setBudget({});
            setSalaryError("");
            setEmployment(new Set());
            setSkills(new Set());
            setWorkMode(new Set());
            setSavedOnly(false);
          }}
        >
          {filterT("clear")}
        </Button>
        <FilterSection
          label={t("filterEmployment")}
          options={EMPLOYMENT_TYPES.map((v) => ({
            value: v,
            label: tw(`employment${employmentI18n(v)}`),
          }))}
          selected={employment}
          onToggle={(v) => setEmployment((prev) => toggle(prev, v as EmploymentType))}
        />
        {capabilities.isPending ? <p role="status">{tc("loading")}</p> : null}
        {capabilities.error ? (
          <div role="alert">
            <p>{capabilities.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => void capabilities.refetch()}>
              {tc("retry")}
            </Button>
          </div>
        ) : null}
        <FilterSection
          label={t("filterCapabilities")}
          maxSelected={20}
          options={[...new Set((capabilities.data ?? []).map((item) => item.name))].map((name) => ({
            value: name,
            label: name,
          }))}
          selected={skills}
          onToggle={(v) => setSkills((prev) => toggle(prev, v))}
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
      <section className="min-w-0 space-y-4 border-r border-white/10 py-4 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4">
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
              employment.size ||
              skills.size ||
              workMode.size ||
              category ||
              genre ||
              Object.keys(budget).length
                ? t("noFilterMatches")
                : t("noOpenPositions")
            }
          />
        ) : (
          <>
            <div className="flex flex-col">
              {all.map(({ position, crew }) => (
                <PositionCard
                  key={position.id}
                  crew={crew}
                  position={position}
                  locale={locale}
                  selected={selected?.position.id === position.id}
                  onSelect={() => {
                    setSelectedId(position.id);
                    if (window.matchMedia("(max-width: 1023px)").matches) {
                      requestAnimationFrame(() => {
                        detailsRef.current?.focus({ preventScroll: true });
                        detailsRef.current?.scrollIntoView({ block: "start" });
                      });
                    }
                  }}
                />
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
      <section
        ref={detailsRef}
        tabIndex={-1}
        aria-live="polite"
        aria-label={t("viewDetails")}
        className="min-w-0 scroll-mt-24 outline-none lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain"
      >
        {selected ? (
          <OpeningDetails
            key={selected.position.id}
            id={selected.crew.id}
            positionId={selected.position.id}
            embedded
          />
        ) : null}
      </section>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────

function PositionCard({
  crew,
  position,
  locale,
  selected,
  onSelect,
}: {
  crew: PositionWithCrew["crew"];
  position: PositionWithCrew["position"];
  locale: Locale;
  selected: boolean;
  onSelect: () => void;
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
    <article
      onClick={(event) => {
        // Keep Crew links and explicit controls independent of card selection.
        if ((event.target as HTMLElement).closest("a,button,input,select,textarea")) return;
        onSelect();
      }}
      className={`cursor-pointer flex flex-col gap-3 border-b border-white/10 border-l-2 p-4 transition-colors ${selected ? "border-l-primary bg-white/5" : "border-l-transparent hover:bg-white/[0.025]"}`}
    >
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
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="w-full text-left focus-visible:outline-primary"
        >
          {translatePosition(position.positionType)}
        </button>
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

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onSelect}
        aria-pressed={selected}
        className="w-full justify-start text-xs"
      >
        {tCrew("viewDetails")}
      </Button>
    </article>
  );
}

// ─── Sidebar atoms ────────────────────────────────────

function FilterSection<T extends string>({
  label,
  options,
  selected,
  onToggle,
  maxSelected,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: Set<T>;
  onToggle: (value: T) => void;
  maxSelected?: number;
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
                  disabled={!on && maxSelected !== undefined && selected.size >= maxSelected}
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
