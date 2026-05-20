"use client";

/**
 * Crew detail — public showcase layout (LinkedIn / Greenhouse-style).
 *
 * Visitor's question is "should I join / apply to this crew?" — so
 * the page leads with a hero, then a 2-col body: main column with
 * About + Open Positions, right sidebar pinned with the team
 * roster. Team-as-trust-anchor stays visible while the visitor
 * scans positions. Collapses to single column on mobile.
 *
 * Component reuse:
 *   - PositionCard is shared with /workspace/_components/positions
 *     (uses hideOwnerStats so applicant counts / triage badges
 *     don't leak to the public)
 *   - Sidebar's TeamRow renders avatar + name + role inline (more
 *     compact than the workspace's MemberCard, which is grid-sized);
 *     names come from the same useUserDisplays batch lookup
 *
 * Permissions:
 *   - Outsider (incl. anonymous): can apply to open positions; no
 *     workspace access
 *   - Member / finance / admin: see "Open Workspace" CTA in hero;
 *     no Apply (they're already in)
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  IconArrowLeft,
  IconBriefcase,
  IconCalendar,
  IconCoin,
  IconCrown,
  IconLayoutDashboard,
  IconSparkles,
  IconUsers,
} from "@tabler/icons-react";
import { env } from "@/src/env";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import {
  useCrewMembers,
  useCrewPositions,
  type CrewDTO,
  type CrewMemberDTO,
  type CrewPositionDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useUserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";
import { ApplyPositionDialog } from "@/app/(site)/crews/_components/apply-position-dialog";
import { PositionCard } from "@/app/(site)/crews/[id]/workspace/_components/positions/position-card";
import type { LookupUserDTO } from "@repo/shared/users";

export function CrewDetail({ crew }: { crew: CrewDTO }) {
  const t = useTranslations("workspace");
  const tCrew = useTranslations("crew");
  const locale = useLocale() as Locale;
  const id = crew.id;

  const { data: positions = [] } = useCrewPositions(id);
  const { data: members = [] } = useCrewMembers(id);

  // Single source of truth for viewer role — matches the workspace
  // tab so the dev-identity switcher works the same way here.
  const viewer = useUserCrewRole(id);
  const isInsider = viewer.isAdmin || viewer.isFinance || viewer.isMember;

  // Frozen positions are hidden from the public; insiders see them
  // via the workspace, not here.
  const visiblePositions = useMemo(
    () => positions.filter((p) => p.status !== "frozen"),
    [positions]
  );

  const slotsTotal = useMemo(
    () => visiblePositions.reduce((s, p) => s + p.targetCount, 0),
    [visiblePositions]
  );
  const slotsFilled = useMemo(
    () => visiblePositions.reduce((s, p) => s + p.recruitedCount, 0),
    [visiblePositions]
  );
  const openPositionsCount = visiblePositions.filter(
    (p) => p.status !== "full" && p.recruitedCount < p.targetCount
  ).length;

  // One batched lookup for every name on the page — see useUserDisplays.
  const memberIds = useMemo(() => members.map((m) => m.userId), [members]);
  const displays = useUserDisplays(memberIds);

  // Founder spotlight + the rest in join order.
  const sortedMembers = useMemo(() => {
    const founder = members.find((m) => m.via === "founder") ?? null;
    const rest = members
      .filter((m) => m.via !== "founder")
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
    return { founder, rest };
  }, [members]);

  // Apply dialog state lifted to parent so each position card just
  // calls a setter — keeps card focused on rendering.
  const [applyTarget, setApplyTarget] = useState<CrewPositionDTO | null>(null);

  // Hero background: featured showcase work first, otherwise null so
  // the Hero falls back to the "logo + gradient" empty-state. No
  // separate `cover` asset — that decision is captured in DESIGN.md.
  const featuredWork = crew.showcaseWorks?.[0] ?? null;
  // Showcase work thumbnails are also uploaded via /project/uploadBanner
  // → BANNER bucket. workspace/page.tsx uses BANNER_BASE_URL for the
  // same field; align here.
  const heroVisual = featuredWork
    ? resolveAsset(featuredWork.thumbnailUrl, env.BANNER_BASE_URL)
    : null;
  const workspaceHref = localizePath(`/crews/${id}/workspace`, locale);
  const plazaHref = localizePath("/crews", locale);

  return (
    <div className="min-h-screen bg-background">
      {/* ─── Hero ───────────────────────────────────── */}
      <Hero
        crew={crew}
        plazaHref={plazaHref}
        workspaceHref={workspaceHref}
        showWorkspaceCta={isInsider}
        heroVisual={heroVisual}
        tCrew={tCrew}
      />

      {/* ─── Stats strip ───────────────────────────── */}
      <div className="bg-card/50">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-6 px-6 py-4">
          <StatItem
            icon={IconUsers}
            label={t("wsMembers")}
            value={`${crew.memberCount ?? members.length}`}
          />
          <StatItem
            icon={IconBriefcase}
            label={tCrew("openPositions")}
            value={`${openPositionsCount}`}
          />
          <StatItem
            icon={IconLayoutDashboard}
            label={t("wsSlots")}
            value={`${slotsFilled}/${slotsTotal}`}
          />
          <StatItem
            icon={IconCalendar}
            label={tCrew("foundedOn")}
            value={formatShortDate(crew.createdAt, locale)}
          />
        </div>
      </div>

      {/* ─── Main: 2-col with sticky team sidebar ───────
       *  Layout convention borrowed from LinkedIn / Greenhouse
       *  career pages — main content scrolls, team stays visible
       *  as the trust anchor while the visitor reads about
       *  positions. Stacks to single column under lg. */}
      <div className="mx-auto max-w-[1800px] px-6 py-10">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
          {/* ─── Main column ─── */}
          <div className="min-w-0 space-y-10">
            {/* About */}
            {crew.description ? (
              <section>
                <SectionHeader
                  icon={IconSparkles}
                  eyebrow={tCrew("aboutThisCrew")}
                  title={crew.name}
                />
                <p className="whitespace-pre-line text-base leading-relaxed text-foreground/85">
                  {crew.description}
                </p>
              </section>
            ) : null}

            {/* Open positions */}
            <section>
              <SectionHeader
                icon={IconBriefcase}
                eyebrow={tCrew("joinUs")}
                title={tCrew("positionsSectionTitle", { count: openPositionsCount })}
              />
              {visiblePositions.length === 0 ? (
                <EmptyHint>{t("noJobsYet")}</EmptyHint>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {visiblePositions.map((p) => {
                    const cta = ctaForVisitor(p, isInsider, tCrew);
                    return (
                      <PositionCard
                        key={p.id}
                        position={p}
                        applicantCount={0}
                        pendingApplicantCount={0}
                        hideOwnerStats
                        cta={cta}
                        onClick={() => {
                          // Only the "primary" CTA (open + outsider)
                          // routes to Apply; everything else is an
                          // informational no-op.
                          if (cta.tone === "primary") setApplyTarget(p);
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* ─── Right sidebar: sticky team ─── */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <TeamSidebar
              founder={sortedMembers.founder}
              rest={sortedMembers.rest}
              memberCount={crew.memberCount ?? members.length}
              displays={displays}
              locale={locale}
              t={t}
              tCrew={tCrew}
            />
          </aside>
        </div>
      </div>

      <ApplyPositionDialog
        open={applyTarget !== null}
        onOpenChange={(open) => {
          if (!open) setApplyTarget(null);
        }}
        crewId={id}
        positionId={applyTarget?.id ?? ""}
        positionLabel={applyTarget ? applyTarget.positionType : ""}
        crewName={crew.name}
      />
    </div>
  );
}

// ─── Position CTA resolver ──────────────────────────

/**
 * Derive the bottom CTA on a position card given viewer + position
 * state. Only the "primary" tone is actionable (opens the Apply
 * dialog); the others are visual labels for why apply is disabled.
 */
function ctaForVisitor(
  position: CrewPositionDTO,
  isInsider: boolean,
  tCrew: ReturnType<typeof useTranslations>
): { label: string; tone: "primary" | "muted" } {
  if (isInsider) return { label: tCrew("ctaAlreadyMember"), tone: "muted" };
  if (position.status === "frozen") return { label: tCrew("ctaPaused"), tone: "muted" };
  const isFull = position.status === "full" || position.recruitedCount >= position.targetCount;
  if (isFull) return { label: tCrew("ctaFull"), tone: "muted" };
  return { label: tCrew("ctaApply"), tone: "primary" };
}

// ─── Team sidebar (sticky right column) ─────────────

function TeamSidebar({
  founder,
  rest,
  memberCount,
  displays,
  locale,
  t,
  tCrew,
}: {
  founder: CrewMemberDTO | null;
  rest: CrewMemberDTO[];
  memberCount: number;
  displays: Map<string, LookupUserDTO>;
  locale: Locale;
  t: ReturnType<typeof useTranslations>;
  tCrew: ReturnType<typeof useTranslations>;
}) {
  // Show up to 8 members in the sticky panel (founder + 7); deeper
  // teams collapse into a "+N more" footer to keep the sidebar
  // height bounded. Future: a "View full team" link that scrolls to
  // a dedicated main-column section if/when team count grows large.
  const visibleRest = rest.slice(0, 7);
  const hiddenCount = Math.max(0, memberCount - 1 - visibleRest.length);

  return (
    <div className="rounded-xl bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <IconUsers className="size-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">
          {tCrew("theTeam")} · {memberCount}
        </h3>
      </div>

      {memberCount === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">{t("noMembersYet")}</p>
      ) : (
        <div className="space-y-1">
          {founder ? (
            <TeamRow member={founder} displays={displays} locale={locale} t={t} founder />
          ) : null}
          {visibleRest.map((m) => (
            <TeamRow key={m.id} member={m} displays={displays} locale={locale} t={t} />
          ))}
          {hiddenCount > 0 ? (
            <div className="pt-2 text-center text-[11px] text-muted-foreground">
              {tCrew("teamHiddenCount", { count: hiddenCount })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TeamRow({
  member,
  displays,
  locale,
  t,
  founder = false,
}: {
  member: CrewMemberDTO;
  displays: Map<string, LookupUserDTO>;
  locale: Locale;
  t: ReturnType<typeof useTranslations>;
  founder?: boolean;
}) {
  const translatePosition = useTranslatePositionValue();
  const lookup = displays.get(member.userId);
  const displayName = lookup?.nickname?.trim() || `User ${member.userId}`;
  const initial = displayName.charAt(0).toUpperCase();
  const role = founder ? t("memberRoleOwner") : translatePosition(member.roleType);
  const avatarUrl = resolveAvatar(lookup?.avatar ?? null);
  const profileHref = localizePath(`/creators/${member.userId}`, locale);

  return (
    <Link
      href={profileHref}
      className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/40"
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={displayName}
          className="size-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div
          className={
            founder
              ? "flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary"
              : "flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-foreground"
          }
        >
          {initial}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
          {founder ? (
            <IconCrown className="size-3 shrink-0 text-primary" aria-label="Founder" />
          ) : null}
          {member.isFinance ? (
            <IconCoin className="size-3 shrink-0 text-amber-400" aria-label="Finance" />
          ) : null}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{role}</div>
      </div>
    </Link>
  );
}

function resolveAvatar(path: string | null): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = (env.USER_BASE_URL || env.OSS_BASE_URL || "").replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/${path.replace(/^\/+/, "")}`;
}

// ─── Hero ───────────────────────────────────────────

function Hero({
  crew,
  plazaHref,
  workspaceHref,
  showWorkspaceCta,
  heroVisual,
  tCrew,
}: {
  crew: CrewDTO;
  plazaHref: string;
  workspaceHref: string;
  showWorkspaceCta: boolean;
  /** Featured showcase work's thumbnail, or null → falls back to the
   *  logo + branded gradient empty-state below. */
  heroVisual: string | null;
  tCrew: ReturnType<typeof useTranslations>;
}) {
  // Crew logos live in the BANNER bucket (uploaded via /project/uploadBanner).
  const logoUrl = resolveAsset(crew.logo, env.BANNER_BASE_URL);

  return (
    <div className="relative h-64 overflow-hidden md:h-80">
      {heroVisual ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={heroVisual} alt={crew.name} className="size-full object-cover" />
      ) : (
        // No-showcase fallback: branded gradient with a centered
        // enlarged logo. Better than a flat secondary fill — the
        // page still has visual weight while owners are still
        // setting up their showcase.
        <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/20 via-secondary to-background">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt={crew.name}
            className="size-36 rounded-full object-cover opacity-30 ring-2 ring-white/10 md:size-44"
          />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/10" />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-w-[1800px] px-6 pb-6">
        <Link
          href={plazaHref}
          className="mb-3 inline-flex items-center gap-1 text-sm text-white/80 transition-colors hover:text-white"
        >
          <IconArrowLeft className="size-4" />
          {tCrew("plaza")}
        </Link>
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="mb-1 text-3xl font-black text-white sm:text-4xl">{crew.name}</h1>
            {crew.description ? (
              <p className="line-clamp-2 max-w-2xl text-sm text-white/75">{crew.description}</p>
            ) : null}
          </div>
          {showWorkspaceCta ? (
            <Link
              href={workspaceHref}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
            >
              <IconLayoutDashboard className="size-4" />
              {tCrew("workspace")}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Small atoms ────────────────────────────────────

function StatItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof IconUsers;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Icon className="size-4" />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-bold tabular-nums text-foreground">{value}</div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  eyebrow,
  title,
}: {
  icon: typeof IconUsers;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Icon className="size-4" />
      </div>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-primary">
          {eyebrow}
        </div>
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
      </div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card/50 py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

// ─── Asset URL helpers ──────────────────────────────

/** Path-or-URL → absolute URL. Pass `http(s)://...` straight through;
 *  treat anything else as an OSS key under `base`. */
function resolveAsset(path: string | null | undefined, base: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function formatShortDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short" });
  } catch {
    return iso.slice(0, 10);
  }
}
