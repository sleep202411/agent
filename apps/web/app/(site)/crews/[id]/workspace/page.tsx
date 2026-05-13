"use client";

/**
 * Crew workspace — slim version.
 *
 * Three tabs (overview / recruitment / members), backed only by real
 * endpoints:
 *
 *   - useCrewDetail        — header + hero (name / banner / video / description)
 *   - useCrewMembers       — members tab + member-count stat
 *   - useCrewJobs          — recruitment tab + slots / open-jobs stats
 *   - useJobApplicants     — accordion-expanded applicant list inside recruitment
 *   - useProjectRoles      — role-name lookup for jobs and members
 *
 * Mock-driven sections (todos, activity feed, episode timeline,
 * delivery records, mock studio metadata) were dropped 2026-05-10
 * along with `workspace-mock.ts` / `use-workspace.ts` — those
 * features will return when their respective backends ship.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  IconArrowLeft,
  IconBook,
  IconArchive,
  IconBriefcase,
  IconChevronDown,
  IconChevronRight,
  IconEdit,
  IconLoader2,
  IconMovie,
  IconLock,
  IconRocket,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import { env } from "@/src/env";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  useCrewDetail,
  useCrewJobs,
  useCrewMembers,
  useRemoveMember,
  useUpdateCrewStatus,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useCloseJob } from "@/app/(site)/crews/_hooks/use-jobs";
import { useProjectRoles } from "@/app/(site)/crews/_hooks/use-projects";
import { DevIdentitySwitcher } from "@/app/(site)/crews/_components/dev-identity-switcher";
import { useUserInfo } from "@/src/hooks/use-user";
import { AddCrewMemberDialog } from "@/app/(site)/crews/_components/add-member-dialog";
import { CreateCrewDialog } from "@/app/(site)/crews/_components/create-crew-dialog";
import { CreateCrewJobDialog } from "@/app/(site)/crews/_components/create-crew-job-dialog";
import { JobApplicantsList } from "@/app/(site)/crews/_components/job-applicants-list";
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
  const [pendingRemove, setPendingRemove] = useState<{ userId: number; name: string } | null>(null);

  // Recruitment-tab accordion state. One row open at a time.
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
  const [pendingCloseJob, setPendingCloseJob] = useState<{ id: number; name: string } | null>(null);

  // Real data fetches
  const { data: userInfo } = useUserInfo();
  const { data: crewDetail, isLoading: detailLoading } = useCrewDetail(id);
  const { data: crewMembers = [], isLoading: membersLoading } = useCrewMembers(id);
  const { data: crewJobs = [] } = useCrewJobs(id);
  const { data: projectRoles = [] } = useProjectRoles();

  // Owner gate — real ownership from `crewDetail.adminUserId` matched
  // against the logged-in user. Null-safe so it stays `false` until
  // both userInfo and crewDetail have resolved.
  const currentUserId = userInfo?.id != null ? Number(userInfo.id) : undefined;
  const isOwner =
    currentUserId != null &&
    crewDetail?.adminUserId != null &&
    crewDetail.adminUserId === currentUserId;
  const roleNameById = useMemo(
    () => new Map(projectRoles.map((r) => [r.id, r.name])),
    [projectRoles]
  );
  const removeMember = useRemoveMember();
  const closeJob = useCloseJob(id);
  const updateStatus = useUpdateCrewStatus();

  // Stats — all derived from live data.
  const slotsTotal = useMemo(
    () => crewJobs.reduce((s, j) => s + Number(j.jobNumber ?? 0), 0),
    [crewJobs]
  );
  const slotsFilled = useMemo(
    () => crewJobs.reduce((s, j) => s + Number(j.filledNumber ?? 0), 0),
    [crewJobs]
  );
  // Closed (status === 9) jobs no longer accept applicants regardless of
  // their headcount fill state — exclude them from the "open jobs" stat.
  const openJobsCount = useMemo(
    () =>
      crewJobs.filter(
        (j) => Number(j.status ?? 0) !== 9 && Number(j.filledNumber ?? 0) < Number(j.jobNumber ?? 0)
      ).length,
    [crewJobs]
  );

  // Recruitment summary cards used on the overview tab. Same source as
  // the recruitment tab itself — we just project a flatter shape.
  const rolesProgress = useMemo(
    () =>
      crewJobs.map((job) => ({
        jobId: job.id,
        role:
          job.jobName ||
          job.roleName ||
          (job.roleId != null ? roleNameById.get(job.roleId) : undefined) ||
          `#${job.roleId}`,
        filled: Number(job.filledNumber ?? 0),
        total: Number(job.jobNumber ?? 0),
        closed: Number(job.status ?? 0) === 9,
      })),
    [crewJobs, roleNameById]
  );

  if (detailLoading || !crewDetail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  const heroBanner = resolveAsset(crewDetail.banner, env.BANNER_BASE_URL);
  const heroVideo = resolveAsset(crewDetail.video, env.OSS_BASE_URL);
  const heroDescription = (crewDetail.description ?? "").trim();

  const handleInvite = () => setAddMemberOpen(true);

  const handleRemoveMember = (userId: number, displayName: string) => {
    setPendingRemove({ userId, name: displayName });
  };

  const confirmRemoveMember = () => {
    if (!pendingRemove) return;
    const { userId, name } = pendingRemove;
    removeMember.mutate(
      { crewId: id, userId },
      {
        onSuccess: () => {
          toast.success(t("removeMemberSuccess", { name }));
          setPendingRemove(null);
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : "";
          toast.error(msg || t("removeMemberFailed"));
          setPendingRemove(null);
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <DevIdentitySwitcher />

      {/* Visual hero strip — banner with optional autoplay video loop.
          Hidden when there's no banner (fresh crew or fetch error). */}
      {heroBanner ? (
        <div className="relative h-48 w-full overflow-hidden bg-black sm:h-64">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroBanner} alt="" className="absolute inset-0 size-full object-cover" />
          {heroVideo ? (
            <video
              src={heroVideo}
              poster={heroBanner}
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              className="absolute inset-0 size-full object-cover"
              aria-hidden
            />
          ) : null}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
          {heroDescription ? (
            <div className="absolute inset-x-0 bottom-3 px-6">
              <div className="mx-auto max-w-screen-xl">
                <p className="line-clamp-2 max-w-2xl text-sm text-white/90">{heroDescription}</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Header */}
      <div className="border-b border-border bg-card/50">
        <div className="mx-auto max-w-screen-xl px-6 py-5">
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
              {!heroBanner && heroDescription ? (
                <p className="max-w-3xl text-xs text-muted-foreground">{heroDescription}</p>
              ) : null}
            </div>
            {isOwner ? (
              <div className="flex shrink-0 items-center gap-2">
                {/* Status actions — mutex by current `crewDetail.status`:
                      - status === 0 (draft)     → only Publish is visible
                      - status === 1 (published) → only Unpublish is visible
                    Both call `useUpdateCrewStatus` which posts ONLY id +
                    status (no field-edit bundling). Edit is independent
                    and always shown — it opens the dialog that saves
                    name / description / cover changes. */}
                {crewDetail.status === 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      updateStatus.mutate(
                        { id: crewDetail.id, status: 1 },
                        {
                          onSuccess: () => toast.success(t("publishSuccess")),
                          onError: (err) =>
                            toast.error(err instanceof Error ? err.message : t("publishFailed")),
                        }
                      )
                    }
                    disabled={updateStatus.isPending}
                    className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateStatus.isPending ? (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    ) : (
                      <IconRocket className="size-3.5" />
                    )}
                    {t("publishCrew")}
                  </button>
                ) : null}
                {crewDetail.status === 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      updateStatus.mutate(
                        { id: crewDetail.id, status: 0 },
                        {
                          onSuccess: () => toast.success(t("unpublishSuccess")),
                          onError: (err) =>
                            toast.error(err instanceof Error ? err.message : t("unpublishFailed")),
                        }
                      )
                    }
                    disabled={updateStatus.isPending}
                    className="flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateStatus.isPending ? (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    ) : (
                      <IconArchive className="size-3.5" />
                    )}
                    {t("unpublishCrew")}
                  </button>
                ) : null}
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

          {/* Stats — live counts only. */}
          <div className="mt-4 flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
            <Stat value={crewMembers.length} labelKey="wsMembers" t={t} />
            <Stat value={`${slotsFilled}/${slotsTotal}`} labelKey="wsSlots" t={t} />
            <Stat value={openJobsCount} labelKey="wsOpenJobs" t={t} highlight={openJobsCount > 0} />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto flex max-w-screen-xl gap-5 px-6 py-6">
        {/* Sidebar */}
        <div className="w-36 shrink-0">
          <nav className="sticky top-6 space-y-0.5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                    activeTab === tab.id
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

        {/* Main */}
        <div className="min-w-0 flex-1">
          {activeTab === "overview" ? (
            <OverviewTab
              memberCount={crewMembers.length}
              openJobsCount={openJobsCount}
              slotsFilled={slotsFilled}
              slotsTotal={slotsTotal}
              rolesProgress={rolesProgress}
              t={t}
              onJumpRoles={() => setActiveTab("roles")}
            />
          ) : null}

          {activeTab === "roles" ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold">{t("tabRecruitment")}</h3>
                {isOwner ? (
                  <button
                    type="button"
                    onClick={() => setPublishJobOpen(true)}
                    className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                  >
                    + {t("publishJob")}
                  </button>
                ) : null}
              </div>

              {crewJobs.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("noJobsYet")}
                </div>
              ) : (
                <div className="space-y-3">
                  {crewJobs.map((job) => {
                    const filled = Number(job.filledNumber ?? 0);
                    const total = Number(job.jobNumber ?? 0);
                    const closed = Number(job.status ?? 0) === 9;
                    const full = total > 0 && filled >= total;
                    const roleLabel =
                      job.jobName ||
                      job.roleName ||
                      (job.roleId != null ? roleNameById.get(job.roleId) : undefined) ||
                      `#${job.roleId}`;
                    const expanded = expandedJobId === job.id;
                    return (
                      <div
                        key={job.id}
                        className="overflow-hidden rounded-lg border border-border bg-secondary/30"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedJobId((prev) => (prev === job.id ? null : job.id))
                          }
                          className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-secondary/50"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <IconChevronDown
                              className={cn(
                                "size-4 shrink-0 text-muted-foreground transition-transform",
                                expanded && "rotate-180"
                              )}
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-foreground">
                                {roleLabel}
                              </div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {filled}/{total} {t("filled")}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  closed
                                    ? "bg-muted-foreground/40"
                                    : full
                                      ? "bg-green-400"
                                      : "bg-amber-400"
                                )}
                                style={{
                                  width: total > 0 ? `${(filled / total) * 100}%` : "0%",
                                }}
                              />
                            </div>
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-xs font-semibold",
                                closed
                                  ? "border-muted-foreground/30 bg-muted-foreground/10 text-muted-foreground"
                                  : full
                                    ? "border-green-400/30 bg-green-400/10 text-green-400"
                                    : "border-amber-400/30 bg-amber-400/10 text-amber-400"
                              )}
                            >
                              {closed
                                ? t("statusClosed")
                                : full
                                  ? t("statusFull")
                                  : t("statusRecruiting")}
                            </span>
                          </div>
                        </button>
                        {expanded ? (
                          <div className="border-t border-border/60 bg-background/40 px-3 pb-3 pt-2">
                            <JobApplicantsList jobId={job.id} canManage={isOwner} />
                            {isOwner && !closed ? (
                              <div className="mt-3 flex justify-end border-t border-border/60 pt-3">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPendingCloseJob({ id: job.id, name: roleLabel })
                                  }
                                  disabled={closeJob.isPending}
                                  className="flex items-center gap-1 rounded-md border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-xs font-semibold text-rose-400 transition-colors hover:bg-rose-400/20 disabled:opacity-50"
                                >
                                  <IconLock className="size-3.5" />
                                  {t("closeJob")}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {activeTab === "episodes" ? <EpisodesTab crewId={id} /> : null}

          {activeTab === "members" ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold">
                  {t("memberManagement")} · {crewMembers.length} {t("people")}
                </h3>
                {isOwner ? (
                  <button
                    type="button"
                    onClick={handleInvite}
                    className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                  >
                    + {t("inviteMember")}
                  </button>
                ) : null}
              </div>
              {membersLoading ? (
                <div className="flex h-32 items-center justify-center text-muted-foreground">
                  <IconLoader2 className="size-4 animate-spin" />
                </div>
              ) : crewMembers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                  {t("noMembersYet")}
                </div>
              ) : (
                <div className="space-y-2">
                  {crewMembers.map((m) => {
                    const displayName = m.nick?.trim() || `User ${m.userId}`;
                    const initial = (displayName[0] ?? "?").toUpperCase();
                    const avatarUrl = m.avatar
                      ? `${env.USER_BASE_URL || env.OSS_BASE_URL}/${m.avatar.replace(/^\/+/, "")}`
                      : "";
                    const roleLabel =
                      (m.roleId != null && roleNameById.get(m.roleId)) || t("memberRoleUnknown");
                    return (
                      <div
                        key={m.userId}
                        className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3"
                      >
                        <div className="flex items-center gap-3">
                          {avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={avatarUrl}
                              alt=""
                              className="size-8 rounded-xl object-cover"
                            />
                          ) : (
                            <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                              {initial}
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-semibold text-foreground">
                              {displayName}
                            </div>
                            <div className="text-xs text-muted-foreground">{roleLabel}</div>
                          </div>
                        </div>
                        {isOwner ? (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.userId, displayName)}
                            disabled={removeMember.isPending}
                            className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                            aria-label={t("removeMember")}
                            title={t("removeMember")}
                          >
                            <IconTrash className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
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
          banner: crewDetail.banner,
        }}
      />

      {/* Member-remove confirmation */}
      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(v) => {
          if (!v) setPendingRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeMember")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove ? t("removeMemberConfirm", { name: pendingRemove.name }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMember.isPending}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="solid"
              color="destructive"
              disabled={removeMember.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmRemoveMember();
              }}
            >
              {removeMember.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {tc("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Close-job confirmation */}
      <AlertDialog
        open={pendingCloseJob !== null}
        onOpenChange={(v) => {
          if (!v) setPendingCloseJob(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("closeJob")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCloseJob ? t("closeJobConfirm", { name: pendingCloseJob.name }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeJob.isPending}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="solid"
              color="destructive"
              disabled={closeJob.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingCloseJob) return;
                const { id: jobId, name } = pendingCloseJob;
                closeJob.mutate(jobId, {
                  onSuccess: () => {
                    toast.success(t("closeJobSuccess", { name }));
                    setPendingCloseJob(null);
                    setExpandedJobId(null);
                  },
                  onError: (err) => {
                    const msg = err instanceof Error ? err.message : "";
                    toast.error(msg || t("closeJobFailed"));
                  },
                });
              }}
            >
              {closeJob.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {tc("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────

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
  memberCount: number;
  openJobsCount: number;
  slotsFilled: number;
  slotsTotal: number;
  rolesProgress: Array<{
    jobId: number;
    role: string;
    filled: number;
    total: number;
    closed: boolean;
  }>;
  t: ReturnType<typeof useTranslations>;
  onJumpRoles: () => void;
}

/**
 * Overview tab — three KPI tiles + a recruitment-progress summary
 * that links to the recruitment tab. All sourced from real
 * endpoints; no mock data, no placeholder activity feed, no todos.
 */
function OverviewTab({
  memberCount,
  openJobsCount,
  slotsFilled,
  slotsTotal,
  rolesProgress,
  t,
  onJumpRoles,
}: OverviewTabProps) {
  return (
    <div className="space-y-4">
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

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">{t("recruitmentProgress")}</h3>
          <button
            type="button"
            onClick={onJumpRoles}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {t("viewRecruitment")} <IconChevronRight className="size-3" />
          </button>
        </div>
        {rolesProgress.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t("noJobsYet")}</div>
        ) : (
          <div className="space-y-2">
            {rolesProgress.map((r) => {
              const full = r.total > 0 && r.filled >= r.total;
              return (
                <div
                  key={r.jobId}
                  className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{r.role}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {r.filled}/{r.total} {t("filled")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          r.closed
                            ? "bg-muted-foreground/40"
                            : full
                              ? "bg-green-400"
                              : "bg-amber-400"
                        )}
                        style={{
                          width: r.total > 0 ? `${(r.filled / r.total) * 100}%` : "0%",
                        }}
                      />
                    </div>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-semibold",
                        r.closed
                          ? "border-muted-foreground/30 bg-muted-foreground/10 text-muted-foreground"
                          : full
                            ? "border-green-400/30 bg-green-400/10 text-green-400"
                            : "border-amber-400/30 bg-amber-400/10 text-amber-400"
                      )}
                    >
                      {r.closed
                        ? t("statusClosed")
                        : full
                          ? t("statusFull")
                          : t("statusRecruiting")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
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

/** Concat OSS key with its base URL, guarding the leading-slash case
 *  so `/foo/bar.jpg` doesn't produce a `//` join. Empty / missing
 *  inputs return "" so callers can `if (...)` cleanly. */
function resolveAsset(path: string | null | undefined, base: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
