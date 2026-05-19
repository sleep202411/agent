"use client";

/**
 * Crew workspace — owner / member control surface.
 *
 * Tabs:
 *   - overview   — KPI tiles + recruitment progress, jumps to roles
 *   - roles      — position CRUD + accordion-expanded applicants list
 *   - members    — roster + add / remove
 *   - episodes   — production task units (currently feature-gated until
 *                  the workspace episode UI is rewritten against the new
 *                  EpisodeDTO shape; the data layer is already live).
 *
 * Backed only by /aurora/crews/* endpoints. Owner gate compares the
 * logged-in user against `crewDetail.founderId`.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  IconArrowLeft,
  IconBook,
  IconBriefcase,
  IconChevronRight,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconMovie,
  IconUsers,
} from "@tabler/icons-react";
import { env } from "@/src/env";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  useCrewApplications,
  useCrewDetail,
  useCrewMembers,
  useCrewPositions,
  useUpdateCrewListing,
  type CrewPositionDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { DevIdentitySwitcher } from "@/app/(site)/crews/_components/dev-identity-switcher";
import { useUserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { AddCrewMemberDialog } from "@/app/(site)/crews/_components/add-member-dialog";
import { CreateCrewDialog } from "@/app/(site)/crews/_components/create-crew-dialog";
import { CreateCrewJobDialog } from "@/app/(site)/crews/_components/create-crew-job-dialog";
import { MembersGrid } from "@/app/(site)/crews/[id]/workspace/_components/members/members-grid";
import { PositionCard } from "@/app/(site)/crews/[id]/workspace/_components/positions/position-card";
import { PositionDetailSheet } from "@/app/(site)/crews/[id]/workspace/_components/positions/position-detail-sheet";
import { PositionsGrid } from "@/app/(site)/crews/[id]/workspace/_components/positions/positions-grid";
import { EpisodesTab } from "@/app/(site)/crews/[id]/workspace/_components/episodes/episodes-tab";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const TABS = [
  { id: "overview", labelKey: "tabOverview", icon: IconBook },
  { id: "roles", labelKey: "tabRecruitment", icon: IconBriefcase },
  { id: "members", labelKey: "tabMembers", icon: IconUsers },
  { id: "episodes", labelKey: "tabEpisodes", icon: IconMovie },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function CrewWorkspacePage() {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [publishJobOpen, setPublishJobOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [listingIntent, setListingIntent] = useState<"listed" | "unlisted" | null>(null);
  // Member-remove confirmation state moved into MembersGrid — the only
  // surface that triggers a remove.
  // Position expand / freeze state is owned by PositionsGrid +
  // PositionDetailSheet — workspace no longer manages it here.

  const { data: crewDetail, isLoading: detailLoading } = useCrewDetail(id);
  const { data: members = [], isLoading: membersLoading } = useCrewMembers(id);
  const { data: positions = [] } = useCrewPositions(id);
  const updateListing = useUpdateCrewListing();
  // Role gating goes through useUserCrewRole so DevIdentitySwitcher
  // works in dev (without it the workspace gates on the real Java
  // satoken user id, which doesn't match the server-side AUTH_DISABLED
  // fallback user 'dev' that owns rows created locally). Production
  // users still resolve from `useUserInfo` inside the hook.
  const viewer = useUserCrewRole(id);
  const isOwner = viewer.isAdmin;

  const slotsTotal = useMemo(() => positions.reduce((s, p) => s + p.targetCount, 0), [positions]);
  const slotsFilled = useMemo(
    () => positions.reduce((s, p) => s + p.recruitedCount, 0),
    [positions]
  );
  const openCount = useMemo(() => positions.filter((p) => p.status === "open").length, [positions]);
  const isListed = crewDetail?.listingStatus === "listed";

  if (detailLoading || !crewDetail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  // Hero visual derives from the featured showcase work (first entry).
  // No showcase yet → no hero band; the page below carries the crew
  // name + logo in its own header so the workspace still reads.
  const featuredWork = crewDetail.showcaseWorks?.[0] ?? null;
  const heroVisual = featuredWork
    ? resolveAsset(featuredWork.thumbnailUrl, env.BANNER_BASE_URL)
    : "";
  const heroDescription = (crewDetail.description ?? "").trim();

  return (
    <div className="min-h-screen bg-background">
      <DevIdentitySwitcher />

      {heroVisual ? (
        <div className="relative h-48 w-full overflow-hidden bg-black sm:h-64">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroVisual} alt="" className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
          {heroDescription ? (
            <div className="absolute inset-x-0 bottom-3 px-6">
              <div className="mx-auto max-w-[1800px]">
                <p className="line-clamp-2 max-w-2xl text-sm text-white/90">{heroDescription}</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="border-b border-border bg-card/50">
        <div className="mx-auto max-w-[1800px] px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Link
                  href="/crews"
                  className="mr-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Back to crews"
                >
                  <IconArrowLeft className="size-4" />
                </Link>
                <h1 className="truncate text-xl font-black text-foreground">{crewDetail.name}</h1>
              </div>
              {!heroVisual && heroDescription ? (
                <p className="max-w-3xl text-xs text-muted-foreground">{heroDescription}</p>
              ) : null}
            </div>
            {isOwner ? (
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                    isListed
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-border bg-secondary text-muted-foreground"
                  )}
                >
                  {isListed ? (
                    <IconEye className="size-3.5" />
                  ) : (
                    <IconEyeOff className="size-3.5" />
                  )}
                  {isListed ? t("crewListedStatus") : t("crewUnlistedStatus")}
                </span>
                <button
                  type="button"
                  onClick={() => setListingIntent(isListed ? "unlisted" : "listed")}
                  disabled={updateListing.isPending}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                    isListed
                      ? "border-border bg-secondary text-foreground hover:bg-secondary/70"
                      : "border-primary/30 bg-primary text-primary-foreground hover:bg-primary/90",
                    updateListing.isPending && "cursor-wait opacity-70"
                  )}
                >
                  {updateListing.isPending ? (
                    <IconLoader2 className="size-3.5 animate-spin" />
                  ) : isListed ? (
                    <IconEyeOff className="size-3.5" />
                  ) : (
                    <IconEye className="size-3.5" />
                  )}
                  {isListed ? t("hideCrewFromHall") : t("showCrewInHall")}
                </button>
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/70"
                >
                  <IconEdit className="size-3.5" /> {t("wsEditStudio")}
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
            <Stat value={members.length} labelKey="wsMembers" t={t} />
            <Stat value={`${slotsFilled}/${slotsTotal}`} labelKey="wsSlots" t={t} />
            <Stat value={openCount} labelKey="wsOpenJobs" t={t} highlight={openCount > 0} />
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1800px] gap-5 px-6 py-6">
        <div className="w-36 shrink-0">
          <nav className="sticky top-6 space-y-0.5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const disabled = "disabled" in tab && tab.disabled;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (disabled) {
                      toast.info(tc("comingSoon"));
                      return;
                    }
                    setActiveTab(tab.id);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                    disabled
                      ? "cursor-not-allowed text-muted-foreground/50 hover:bg-secondary/30"
                      : activeTab === tab.id
                        ? "bg-primary/10 font-semibold text-primary"
                        : "text-muted-foreground hover:bg-secondary/50"
                  )}
                >
                  <Icon className="size-4" />
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="min-w-0 flex-1">
          {activeTab === "overview" ? (
            <OverviewTab
              crewId={id}
              positions={positions}
              memberCount={members.length}
              openJobsCount={openCount}
              slotsFilled={slotsFilled}
              slotsTotal={slotsTotal}
              isOwner={isOwner}
              t={t}
              onJumpRoles={() => setActiveTab("roles")}
            />
          ) : null}

          {activeTab === "roles" ? (
            <PositionsGrid
              crewId={id}
              positions={positions}
              isOwner={isOwner}
              onPublish={() => setPublishJobOpen(true)}
            />
          ) : null}

          {activeTab === "members" ? (
            <MembersGrid
              crewId={id}
              members={members}
              isOwner={isOwner}
              loading={membersLoading}
              onInvite={() => setAddMemberOpen(true)}
            />
          ) : null}

          {activeTab === "episodes" ? <EpisodesTab crewId={id} /> : null}
        </div>
      </div>

      <AddCrewMemberDialog open={addMemberOpen} onOpenChange={setAddMemberOpen} crewId={id} />
      <CreateCrewJobDialog open={publishJobOpen} onOpenChange={setPublishJobOpen} crewId={id} />
      <CreateCrewDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={{
          id: crewDetail.id,
          name: crewDetail.name,
          description: crewDetail.description,
          logo: crewDetail.logo,
        }}
      />

      {/* Member-remove confirmation moved into MembersGrid (the only
          surface that surfaces a remove action now). */}

      {/* Freeze-position confirmation moved into PositionDetailSheet
          (the only place that surfaces the freeze action now). */}

      <AlertDialog
        open={listingIntent !== null}
        onOpenChange={(open) => {
          if (!open && !updateListing.isPending) setListingIntent(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {listingIntent === "listed" ? t("showCrewConfirmTitle") : t("hideCrewConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {listingIntent === "listed" ? t("showCrewConfirmDesc") : t("hideCrewConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateListing.isPending}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={updateListing.isPending || listingIntent === null}
              onClick={(event) => {
                event.preventDefault();
                if (!listingIntent) return;
                updateListing.mutate(
                  { id, listingStatus: listingIntent },
                  {
                    onSuccess: () => {
                      toast.success(
                        listingIntent === "listed" ? t("showCrewSuccess") : t("hideCrewSuccess")
                      );
                      setListingIntent(null);
                    },
                    onError: (err) => {
                      toast.error(err instanceof Error ? err.message : t("visibilityUpdateFailed"));
                    },
                  }
                );
              }}
            >
              {updateListing.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {listingIntent === "listed" ? t("showCrewConfirmAction") : t("hideCrewConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface StatProps {
  value: string | number;
  labelKey: string;
  t: ReturnType<typeof useTranslations>;
  highlight?: boolean;
}

function Stat({ value, labelKey, t, highlight = false }: StatProps) {
  return (
    <div className="flex items-center gap-1">
      <span className={cn("text-sm font-black", highlight ? "text-amber-400" : "text-foreground")}>
        {value}
      </span>
      <span>{t(labelKey)}</span>
    </div>
  );
}

interface OverviewTabProps {
  crewId: string;
  positions: CrewPositionDTO[];
  memberCount: number;
  openJobsCount: number;
  slotsFilled: number;
  slotsTotal: number;
  isOwner: boolean;
  t: ReturnType<typeof useTranslations>;
  onJumpRoles: () => void;
}

/** Cap for the "招募中预览" card grid — overview is a summary, not a
 *  management surface. Beyond this the user should hop to the Roles tab. */
const OVERVIEW_POSITIONS_PREVIEW = 6;

function OverviewTab({
  crewId,
  positions,
  memberCount,
  openJobsCount,
  slotsFilled,
  slotsTotal,
  isOwner,
  t,
  onJumpRoles,
}: OverviewTabProps) {
  // Same card components the Roles tab uses → visual + interactive
  // consistency. Overview shows only OPEN positions (preview semantics)
  // capped at OVERVIEW_POSITIONS_PREVIEW; "view all" jumps to Roles tab.
  const { data: allApplications = [] } = useCrewApplications(crewId, isOwner);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const openPositions = useMemo(
    () =>
      positions.filter(
        (p) => p.status !== "frozen" && p.status !== "full" && p.recruitedCount < p.targetCount
      ),
    [positions]
  );
  const previewPositions = openPositions.slice(0, OVERVIEW_POSITIONS_PREVIEW);
  const overflow = openPositions.length - previewPositions.length;

  const stats = useMemo(() => {
    const total = new Map<string, number>();
    const pending = new Map<string, number>();
    for (const a of allApplications) {
      total.set(a.positionId, (total.get(a.positionId) ?? 0) + 1);
      if (a.status === "pending") {
        pending.set(a.positionId, (pending.get(a.positionId) ?? 0) + 1);
      }
    }
    return { total, pending };
  }, [allApplications]);

  const selected = positions.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      {/* KPI tiles — same borderless cards. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile labelKey="wsMembers" value={memberCount} t={t} />
        <KpiTile
          labelKey="wsSlots"
          value={`${slotsFilled}/${slotsTotal}`}
          t={t}
          subtitle={slotsTotal > 0 ? `${Math.round((slotsFilled / slotsTotal) * 100)}%` : undefined}
        />
        <KpiTile labelKey="wsOpenJobs" value={openJobsCount} t={t} highlight />
      </div>

      {/* Open positions preview — reuses PositionCard for visual /
          interaction consistency with the Roles tab. */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">{t("recruitmentProgress")}</h3>
          {openPositions.length > 0 ? (
            <button
              type="button"
              onClick={onJumpRoles}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t("viewRecruitment")} <IconChevronRight className="size-3" />
            </button>
          ) : null}
        </div>
        {previewPositions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            {t("noJobsYet")}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {previewPositions.map((p) => (
                <PositionCard
                  key={p.id}
                  position={p}
                  applicantCount={stats.total.get(p.id) ?? 0}
                  pendingApplicantCount={stats.pending.get(p.id) ?? 0}
                  onClick={() => setSelectedId(p.id)}
                />
              ))}
            </div>
            {overflow > 0 ? (
              <button
                type="button"
                onClick={onJumpRoles}
                className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-xl bg-secondary/40 py-3 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                {t("overviewMorePositions", { count: overflow })}
                <IconChevronRight className="size-3" />
              </button>
            ) : null}
          </>
        )}
      </section>

      {/* Reuse the same detail sheet as the Roles tab — same actions,
          same triage UX, no need to leave Overview. */}
      <PositionDetailSheet
        crewId={crewId}
        position={selected}
        canManage={isOwner}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </div>
  );
}

interface KpiTileProps {
  value: string | number;
  labelKey: string;
  t: ReturnType<typeof useTranslations>;
  subtitle?: string;
  highlight?: boolean;
}

function KpiTile({ value, labelKey, t, subtitle, highlight = false }: KpiTileProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t(labelKey)}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={cn("text-2xl font-black", highlight ? "text-amber-400" : "text-foreground")}
        >
          {value}
        </span>
        {subtitle ? <span className="text-xs text-muted-foreground">{subtitle}</span> : null}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────

function resolveAsset(path: string | null | undefined, base: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
