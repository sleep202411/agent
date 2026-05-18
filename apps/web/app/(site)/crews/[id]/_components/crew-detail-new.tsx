"use client";

/**
 * Crew detail — single canonical layout (public-facing).
 *
 * Sections:
 *   - Hero (cover image / optional autoplay video, name, description,
 *     owner-only Workspace CTA)
 *   - Stats bar (members + open slots)
 *   - Main: Project Overview + Open Positions (with Apply buttons)
 *   - Sidebar: Team Members
 *
 * Data:
 *   - crew      (prop, fetched by parent page)
 *   - positions (server-side counts)
 *   - members   (server-side list — name/avatar shown as User <id> for
 *                now; profile-info enrichment is a future step)
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  IconArrowLeft,
  IconCalendar,
  IconClock,
  IconLockSquare,
  IconMovie,
  IconUserPlus,
  IconUsers,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { env } from "@/src/env";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { cn } from "@/lib/utils";
import { useUserInfo } from "@/src/hooks/use-user";
import {
  CURRENCY_SYMBOLS,
  ZERO_DECIMAL_CURRENCIES,
  useCrewMembers,
  useCrewPositions,
  type CrewDTO,
  type CrewMemberDTO,
  type CrewPositionDTO,
  type PresetPositionValue,
} from "@/app/(site)/crews/_hooks/use-crew";
import { ApplyPositionDialog } from "@/app/(site)/crews/_components/apply-position-dialog";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";

export function CrewDetail({ crew }: { crew: CrewDTO }) {
  const t = useTranslations("workspace");
  const tCrew = useTranslations("crew");
  const locale = useLocale() as Locale;
  const positionLabel = useTranslatePositionValue();
  const { data: userInfo } = useUserInfo();

  const id = crew.id;
  const { data: positions = [] } = useCrewPositions(id);
  const { data: members = [] } = useCrewMembers(id);

  const currentUserId = userInfo?.id != null ? String(userInfo.id) : undefined;
  const isOwner = currentUserId != null && crew.founderId === currentUserId;
  const isMember = useMemo(
    () => currentUserId != null && members.some((m) => m.userId === currentUserId),
    [members, currentUserId]
  );

  const visiblePositions = useMemo(
    // Outsiders + visitors should not see frozen positions.
    () => positions.filter((p) => p.status !== "frozen" || isOwner),
    [positions, isOwner]
  );

  const slotsTotal = useMemo(
    () => visiblePositions.reduce((s, p) => s + p.targetCount, 0),
    [visiblePositions]
  );
  const slotsFilled = useMemo(
    () => visiblePositions.reduce((s, p) => s + p.recruitedCount, 0),
    [visiblePositions]
  );

  const hiringChips = useMemo(
    () =>
      visiblePositions
        .filter((p) => p.status === "open")
        .map((p) => ({ id: p.id, label: positionLabel(p.positionType) })),
    [visiblePositions, positionLabel]
  );

  const heroBanner = resolveBanner(crew.coverImage);
  const heroVideo = resolveAsset(crew.coverVideo, env.OSS_BASE_URL);
  const workspaceHref = localizePath(`/crews/${id}/workspace`, locale);
  const plazaHref = localizePath("/crews", locale);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="relative h-56 overflow-hidden md:h-72">
        {heroBanner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroBanner} alt={crew.name} className="size-full object-cover" />
        ) : (
          <div className="size-full bg-secondary" />
        )}
        {heroVideo ? (
          <video
            src={heroVideo}
            poster={heroBanner || undefined}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 size-full object-cover"
            aria-hidden
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-screen-2xl px-6 pb-6">
          <Link
            href={plazaHref}
            className="mb-3 inline-flex items-center gap-1 text-sm text-white/70 transition-colors hover:text-white"
          >
            <IconArrowLeft className="size-4" />
            {tCrew("plaza")}
          </Link>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="mb-1 text-3xl font-bold text-white">{crew.name}</h1>
              {crew.description ? (
                <p className="line-clamp-2 max-w-2xl text-sm text-white/70">{crew.description}</p>
              ) : null}
            </div>
            {isOwner ? (
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={workspaceHref}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10"
                >
                  <IconMovie className="size-4" />
                  {tCrew("workspace")}
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-screen-2xl items-center gap-8 px-6 py-4">
          <div className="flex items-center gap-2">
            <IconUsers className="size-4 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">{t("wsMembers")}</div>
              <div className="text-sm font-semibold text-foreground">
                {crew.memberCount ?? members.length} {t("people")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconCalendar className="size-4 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">{t("wsSlots")}</div>
              <div className="text-sm font-semibold text-foreground">
                {slotsFilled}/{slotsTotal}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main + sidebar */}
      <div className="mx-auto max-w-screen-2xl px-6 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {crew.description || hiringChips.length > 0 ? (
              <section className="rounded-xl border border-border bg-card p-5">
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  {tCrew("projectOverview")}
                </h2>
                {crew.description ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {crew.description}
                  </p>
                ) : null}
                {hiringChips.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {hiringChips.map((c) => (
                      <span
                        key={c.id}
                        className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-300"
                      >
                        {tCrew("hiring")}: {c.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold text-foreground">
                {tCrew("openPositions")}
              </h2>
              {visiblePositions.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("noJobsYet")}
                </div>
              ) : (
                <div className="space-y-4">
                  {visiblePositions.map((p) => (
                    <PositionRow
                      key={p.id}
                      crewId={id}
                      crewName={crew.name}
                      position={p}
                      canApply={!isOwner && !isMember}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <IconUsers className="size-4 text-primary" />
                {t("memberManagement")}
              </h3>
              {members.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  {t("noMembersYet")}
                </div>
              ) : (
                <div className="space-y-3">
                  {members.map((m) => (
                    <MemberRow key={m.id} member={m} />
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function PositionRow({
  crewId,
  crewName,
  position,
  canApply,
}: {
  crewId: string;
  crewName: string;
  position: CrewPositionDTO;
  canApply: boolean;
}) {
  const t = useTranslations("workspace");
  const tCrew = useTranslations("crew");
  const positionLabel = useTranslatePositionValue();
  const [applyOpen, setApplyOpen] = useState(false);

  const filled = position.recruitedCount;
  const total = position.targetCount;
  const isFull = position.status === "full" || filled >= total;
  const isFrozen = position.status === "frozen";
  const label = positionLabel(position.positionType);

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {label} × {total}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {filled}/{total} {t("filled")}
            </span>
            <span
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                isFrozen
                  ? "border-muted text-muted-foreground"
                  : isFull
                    ? "border-green-400/30 bg-green-400/10 text-green-400"
                    : "border-amber-400/30 bg-amber-400/10 text-amber-400"
              )}
            >
              {isFrozen ? (
                <>
                  <IconLockSquare className="size-3" />
                  {tCrew("statusFrozen")}
                </>
              ) : (
                <>
                  <IconClock className="size-3" />
                  {isFull ? t("statusFull") : t("statusRecruiting")}
                </>
              )}
            </span>
            <PositionMetaChips position={position} t={t} />
          </div>
        </div>
        {canApply && !isFull && !isFrozen ? (
          <button
            type="button"
            onClick={() => setApplyOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <IconUserPlus className="size-3.5" />
            {tCrew("applyNow")}
          </button>
        ) : null}
      </div>

      {position.description ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{position.description}</p>
      ) : null}

      {position.requiredSkills.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {position.requiredSkills.map((s) => (
            <span
              key={`req-${s}`}
              className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
            >
              {s}
            </span>
          ))}
        </div>
      ) : null}

      <ApplyPositionDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        crewId={crewId}
        positionId={position.id}
        positionLabel={label}
        crewName={crewName}
      />
    </div>
  );
}

/** Metadata chips — work mode + employment type + experience + salary. */
function PositionMetaChips({
  position,
  t,
}: {
  position: CrewPositionDTO;
  t: ReturnType<typeof useTranslations>;
}) {
  const workModeKey =
    position.workMode === "remote"
      ? "positionRemote"
      : position.workMode === "hybrid"
        ? "positionHybrid"
        : "positionOnsite";

  const salaryLabel = formatSalary(position, t);

  return (
    <>
      <Chip>{t(workModeKey)}</Chip>
      {position.location ? <Chip>{position.location}</Chip> : null}
      {position.experienceLevel !== "any" ? (
        <Chip>{t(`experience${capitalize(position.experienceLevel)}`)}</Chip>
      ) : null}
      {salaryLabel ? <Chip className="text-amber-400">{salaryLabel}</Chip> : null}
    </>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Format salary range or "Negotiable" given the position fields. */
function formatSalary(p: CrewPositionDTO, t: ReturnType<typeof useTranslations>): string | null {
  if (p.salary.negotiable) return t("salaryNegotiable");
  const { currency, minAmount, maxAmount } = p.salary;
  if ((minAmount == null && maxAmount == null) || currency == null) return null;
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);
  // For JPY the integer IS the displayed value; for CNY/USD/EUR/... divide by 100.
  const toDisplay = (smallest: number) => (isZeroDecimal ? smallest : smallest / 100);
  const fmt = (smallest: number | null): string => {
    if (smallest == null) return "—";
    const v = toDisplay(smallest);
    if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`;
    return String(v);
  };
  return `${CURRENCY_SYMBOLS[currency]}${fmt(minAmount)}-${fmt(maxAmount)}`;
}

function MemberRow({ member }: { member: CrewMemberDTO }) {
  const t = useTranslations("workspace");
  const positionLabel = useTranslatePositionValue();
  const displayName = `User ${member.userId}`;
  const initial = (displayName.replace("User ", "")[0] ?? "?").toUpperCase();
  const roleLabel =
    member.roleType === "owner"
      ? t("memberRoleOwner")
      : positionLabel(member.roleType as PresetPositionValue);
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-medium text-foreground">
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">{displayName}</div>
        <div className="text-[10px] text-muted-foreground">
          {roleLabel}
          {member.isFinance ? " · Finance" : ""}
        </div>
      </div>
    </div>
  );
}

function resolveBanner(path: string | null | undefined): string {
  if (!path) return env.DEFAULT_COVER_URL;
  if (path.startsWith("http")) return path;
  return `${env.BANNER_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function resolveAsset(path: string | null | undefined, base: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
