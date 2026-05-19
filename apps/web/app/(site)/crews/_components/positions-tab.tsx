"use client";

/**
 * Plaza "Positions" view — flat list across all crews.
 *
 * Talent who already know what role they want start here. Each card
 * shows the position's compensation + crew identity in a 6-col
 * compact form (target: ≤280px wide). The PositionCard from the
 * workspace is intentionally NOT reused — that one is tuned for the
 * 3-col owner board and gets unmanageably tall at 6 columns. This
 * file owns a discovery-tuned compact variant.
 *
 * Data source: real aggregated positions from `GET /aurora/positions`.
 */

import Link from "next/link";
import { IconBriefcase, IconCoin, IconMapPin, IconStar } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";
import type { CrewDTO, CrewPositionDTO, CurrencyCode } from "@/app/(site)/crews/_hooks/use-crew";
import { CURRENCY_SYMBOLS, ZERO_DECIMAL_CURRENCIES } from "@repo/shared/crew";
import { crewApi } from "@/app/(site)/crews/_hooks/api";

interface PositionWithCrew {
  position: CrewPositionDTO;
  crew: Pick<CrewDTO, "id" | "name" | "logo" | "tagline" | "genres" | "styles">;
}

interface PublicPositionsResult {
  items: PositionWithCrew[];
  nextCursor: string | null;
}

export function PositionsTab() {
  const t = useTranslations("crew");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;

  const { data, isError } = useQuery({
    queryKey: ["crew", "positions", "public", "first"] as const,
    queryFn: () => crewApi.get<PublicPositionsResult>("/positions", { query: { limit: 48 } }),
    staleTime: 60_000,
  });
  const items = data?.items ?? [];

  if (isError || items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <IconBriefcase className="size-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          {isError ? tc("loadFailed") : t("noOpenPositions")}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
      {items.map(({ position, crew }) => (
        <CompactPositionCard key={position.id} crew={crew} position={position} locale={locale} />
      ))}
    </div>
  );
}

// ─── Compact card ────────────────────────────────────

function CompactPositionCard({
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
  const logoUrl = crew.logo.startsWith("http")
    ? crew.logo
    : `${env.OSS_BASE_URL.replace(/\/+$/, "")}/${crew.logo.replace(/^\/+/, "")}`;

  const isFull = position.status === "full" || position.recruitedCount >= position.targetCount;
  const isFrozen = position.status === "frozen";
  const cta: { label: string; tone: "primary" | "muted" } = isFrozen
    ? { label: tCrew("ctaPaused"), tone: "muted" }
    : isFull
      ? { label: tCrew("ctaFull"), tone: "muted" }
      : { label: tCrew("ctaApply"), tone: "primary" };

  const salary = formatSalaryShort(position, t);
  // Top 3 skills, rest absorbed into "+N" so the card height stays
  // bounded even for verbose listings.
  const visibleSkills = position.requiredSkills.slice(0, 3);
  const overflowSkills = Math.max(0, position.requiredSkills.length - visibleSkills.length);

  return (
    <Link
      href={crewHref}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      {/* Crew identity strip */}
      <div className="flex items-center gap-2 border-b border-border/60 bg-secondary/30 px-3 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={crew.name}
          className="size-6 shrink-0 rounded-full object-cover"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold text-foreground">{crew.name}</div>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-bold text-foreground">
            {translatePosition(position.positionType)}
          </h3>
          <StatusPill isFrozen={isFrozen} isFull={isFull} t={t} />
        </div>

        <div className="flex flex-wrap gap-1 text-[10px]">
          <Chip icon={IconMapPin}>
            {position.workMode === "remote"
              ? t("positionRemote")
              : position.workMode === "hybrid"
                ? t("positionHybrid")
                : t("positionOnsite")}
            {position.location ? ` · ${position.location}` : ""}
          </Chip>
          {position.experienceLevel !== "any" ? (
            <Chip icon={IconStar}>{t(`experience${capitalize(position.experienceLevel)}`)}</Chip>
          ) : null}
        </div>

        {salary ? (
          <div className="flex items-center gap-1 text-xs font-semibold text-amber-400">
            <IconCoin className="size-3.5" />
            {salary}
          </div>
        ) : null}

        {visibleSkills.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {visibleSkills.map((s) => (
              <span
                key={s}
                className="rounded-md border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary"
              >
                {s}
              </span>
            ))}
            {overflowSkills > 0 ? (
              <span className="rounded-md bg-secondary/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                +{overflowSkills}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* CTA strip */}
      <div
        className={cn(
          "border-t border-border/40 px-3 py-2 text-center text-[11px] font-semibold transition-colors",
          cta.tone === "primary"
            ? "bg-primary/10 text-primary group-hover:bg-primary/20"
            : "bg-secondary/40 text-muted-foreground"
        )}
      >
        {cta.tone === "primary" ? `${cta.label} →` : cta.label}
      </div>
    </Link>
  );
}

// ─── Atoms ───────────────────────────────────────────

function StatusPill({
  isFrozen,
  isFull,
  t,
}: {
  isFrozen: boolean;
  isFull: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  if (isFrozen) {
    return (
      <span className="shrink-0 rounded-full border border-muted-foreground/30 bg-muted-foreground/10 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
        {t("statusFrozen")}
      </span>
    );
  }
  if (isFull) {
    return (
      <span className="shrink-0 rounded-full border border-green-400/30 bg-green-400/10 px-2 py-0.5 text-[10px] font-semibold text-green-400">
        {t("statusFull")}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
      {t("statusRecruiting")}
    </span>
  );
}

function Chip({ icon: Icon, children }: { icon: typeof IconMapPin; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
      <Icon className="size-3" />
      {children}
    </span>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compact salary like "¥8K-15K · 项目费" (no zero-decimal-currency
 *  formatting since the discovery card uses K-suffix anyway). */
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
