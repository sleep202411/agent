"use client";

import { useState } from "react";
import { IconEdit, IconLoader2, IconPlus, IconExternalLink, IconTrash } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useUserInfo } from "@/src/hooks/use-user";
import { useKycAuthStatus } from "@/src/hooks/use-kyc";
import { KycRequiredAlert } from "@/components/auth/kyc-required-alert";
import { parseEducation, type UserInfo } from "@/src/services/user";
import {
  SOCIAL_PLATFORMS,
  useExperience,
  useSocials,
  useDeleteExperience,
  useDeleteSocial,
  type ExperienceEntry,
  type SocialLink,
} from "./_hooks/use-profile-extras";
import { ExperienceDialog } from "./experience-dialog";
import { SocialDialog } from "./social-dialog";
import {
  useMyProjects,
  useMyJoinedProjects,
  useMyPersonalWorks,
  useUpdatePersonalWork,
} from "@/src/hooks/use-my-projects";
import { useMyCrews, type CrewDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { updateProject, type PersonalWork, type Project } from "@/src/services/project";
import { ApiRequestError } from "@/src/lib/api";
import { PublishWorkDialog } from "./publish-work-dialog";
import { useProjectEditUrl } from "@/app/(site)/ips/_hooks/use-ip";
import { ProjectStatusBadge } from "@/app/(site)/ips/_components/project-status-badge";
import { env } from "@/src/env";
import { RecruitmentStrip } from "@/app/(studio)/art-studio/_components/recruitment-strip";
import { ProfileHeader } from "./profile-header";
import { ProfileEditDialog } from "./profile-edit-dialog";

export default function ProfilePage() {
  const t = useTranslations("profile");
  const { data: userInfo, isLoading } = useUserInfo();
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ProfileHeader userInfo={userInfo ?? null} onEditProfile={() => setEditOpen(true)} />

      <div className="relative mx-auto max-w-6xl space-y-12 px-4 pb-24 pt-10">
        {/* OverviewTab renders its own section heading (Education) */}
        <OverviewTab userInfo={userInfo ?? null} />

        <ExperienceTab />
        <SocialsTab />

        <ProfileSection title={t("personalWorks")}>
          <PersonalWorksTab />
        </ProfileSection>

        <ProfileSection title={t("myIPs")}>
          <MyIPsTab />
        </ProfileSection>

        <ProfileSection title={t("myCrews")}>
          <MyCrewsTab />
        </ProfileSection>

        {/* RecruitmentStrip self-hides when there are no applicants. */}
        <RecruitmentStrip />
      </div>

      <ProfileEditDialog open={editOpen} onOpenChange={setEditOpen} userInfo={userInfo ?? null} />
    </div>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ─── Overview Tab ─────────────────────────────────────

function OverviewTab({ userInfo }: { userInfo: UserInfo | null }) {
  const t = useTranslations("profile");
  const education = parseEducation(userInfo?.study);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("education")}
        </h2>
        {education.length === 0 ? (
          <p className="text-sm text-muted-foreground/70">{t("educationEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {education.map((entry, i) => {
              const range = [entry.startDate, entry.endDate || t("present")]
                .filter(Boolean)
                .join(" – ");
              const head = [entry.schoolName, entry.major].filter(Boolean).join(" · ");
              return (
                <li
                  key={i}
                  className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-foreground"
                >
                  {head && <div className="font-medium">{head}</div>}
                  {range && <div className="mt-0.5 text-xs text-muted-foreground">{range}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─── Experience Tab ───────────────────────────────────

/**
 * Editable list of work-experience entries. Add button opens the
 * dedicated `ExperienceDialog`; each row exposes inline edit / delete.
 * Mirrors the FAQ tab pattern over in `app/(site)/ips/[id]/edit/page.tsx`
 * — the section heading sits next to the Add CTA so users discover the
 * empty-state action without scrolling into the card stack.
 */
function ExperienceTab() {
  const t = useTranslations("profile");
  const { data: experience = [] } = useExperience();
  const { mutate: deleteEntry } = useDeleteExperience();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExperienceEntry | null>(null);

  const handleAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const handleEdit = (entry: ExperienceEntry) => {
    setEditing(entry);
    setDialogOpen(true);
  };
  const handleDelete = (entry: ExperienceEntry) => {
    if (entry.id === undefined) return;
    if (!window.confirm(t("experienceConfirmDelete"))) return;
    deleteEntry(entry.id, {
      onSuccess: () => toast.success(t("updateSuccess")),
      onError: () => toast.error(t("updateFailed")),
    });
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("experience")}
        </h2>
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <IconPlus className="size-3.5" />
          {t("addExperience")}
        </button>
      </div>
      {experience.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">{t("experienceEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {experience.map((entry, i) => {
            const range = [entry.startTime, entry.endTime || t("present")]
              .filter(Boolean)
              .join(" – ");
            const head = [entry.title, entry.organization].filter(Boolean).join(" · ");
            return (
              <li
                key={entry.id ?? i}
                className="group rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-foreground"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {head && <div className="font-medium">{head}</div>}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {range && <span>{range}</span>}
                      {entry.location && (
                        <>
                          {range && <span>·</span>}
                          <span>{entry.location}</span>
                        </>
                      )}
                    </div>
                    {entry.description && (
                      <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-secondary-foreground">
                        {entry.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => handleEdit(entry)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={t("edit")}
                    >
                      <IconEdit className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(entry)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                      aria-label={t("delete")}
                      disabled={entry.id === undefined}
                    >
                      <IconTrash className="size-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ExperienceDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} />
    </section>
  );
}

// ─── Socials Tab ──────────────────────────────────────

function SocialsTab() {
  const t = useTranslations("profile");
  const { data: socials = [] } = useSocials();
  const { mutate: deleteEntry } = useDeleteSocial();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SocialLink | null>(null);

  const handleAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const handleEdit = (entry: SocialLink) => {
    setEditing(entry);
    setDialogOpen(true);
  };
  const handleDelete = (entry: SocialLink) => {
    if (entry.id === undefined) return;
    if (!window.confirm(t("socialConfirmDelete"))) return;
    deleteEntry(entry.id, {
      onSuccess: () => toast.success(t("updateSuccess")),
      onError: () => toast.error(t("updateFailed")),
    });
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("socials")}
        </h2>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground/60 cursor-not-allowed"
        >
          <IconPlus className="size-3.5" />
          {t("comingSoon")}
        </button>
      </div>
      {socials.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">{t("socialsEmpty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {socials.map((entry, i) => {
            const meta = SOCIAL_PLATFORMS.find((p) => p.id === entry.platform);
            const labelKey = meta?.labelKey ?? "socialPlatform_website";
            const isUrl = /^https?:\/\//i.test(entry.url);
            return (
              <li
                key={entry.id ?? i}
                className="group inline-flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
              >
                {isUrl ? (
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 transition-colors hover:text-primary"
                  >
                    <span className="text-xs font-medium text-foreground">{t(labelKey)}</span>
                    <span className="max-w-[200px] truncate text-[11px] text-muted-foreground">
                      {entry.url}
                    </span>
                    <IconExternalLink className="size-3 text-muted-foreground" />
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{t(labelKey)}</span>
                    <span className="max-w-[200px] truncate text-[11px] text-muted-foreground">
                      {entry.url}
                    </span>
                  </span>
                )}
                <span className="ml-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => handleEdit(entry)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t("edit")}
                  >
                    <IconEdit className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(entry)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    aria-label={t("delete")}
                    disabled={entry.id === undefined}
                  >
                    <IconTrash className="size-3" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <SocialDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} />
    </section>
  );
}

// ─── My IPs Tab ───────────────────────────────────────

function MyIPsTab() {
  const t = useTranslations("profile");
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useMyProjects();
  const projects = data?.pages.flatMap((p) => p.data ?? []) ?? [];

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        {t("noData")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
      {hasNextPage ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isFetchingNextPage ? (
              <>
                <IconLoader2 className="size-4 animate-spin" />
                {t("loadingMore")}
              </>
            ) : (
              t("loadMore")
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Personal Works Tab ───────────────────────────────

function PersonalWorksTab() {
  const t = useTranslations("profile");
  const router = useRouter();
  const locale = useLocale() as Locale;
  const { data: works, isLoading } = useMyPersonalWorks();
  const { data: kycStatus } = useKycAuthStatus();
  const { mutateAsync: updateWork, isPending: updatingWork } = useUpdatePersonalWork();
  const [kycAlertOpen, setKycAlertOpen] = useState(false);
  const [editing, setEditing] = useState<PersonalWork | null>(null);

  // Click-time gate: ask the backend whether KYC is required for this
  // user (mirrors fizzdragon-web's `/user/needAuth` check). The .com
  // region typically returns `needAuth: false` since PRC real-name law
  // doesn't apply, so users there flow straight through to /publish.
  // .cn unverified users still see the gate dialog → /kyc.
  const requestPublish = () => {
    if (kycStatus?.needAuth === true) {
      setKycAlertOpen(true);
      return;
    }
    router.push(localizePath("/publish", locale));
  };

  /**
   * Toggle a work's visibility (`viewStatus`):
   *   1 → 0 = delist (hide from public discovery, keep in personal library)
   *   0 → 1 = relist (re-expose to public — does NOT re-trigger review;
   *           the work was already approved before being delisted)
   *
   * Mirrors legacy fizzdragon-web's `handleOfflinePerson` /
   * `editHandle` permission-popup options. Confirm before delisting
   * because it's user-visible; relisting is one-tap since users want
   * to undo their own action quickly.
   */
  const toggleVisibility = async (work: PersonalWork) => {
    const next = work.viewStatus === 1 ? 0 : 1;
    if (next === 0 && !window.confirm(t("confirmDelist"))) return;
    try {
      await updateWork({ id: work.id, viewStatus: next });
      toast.success(t(next === 0 ? "delistSuccess" : "relistSuccess"));
    } catch (err) {
      // Surface the raw backend response so a hidden 401 / 422 isn't
      // masked behind a generic toast — same pattern as the experience
      // dialog. Long bodies are clipped at 1k chars to avoid overflow.
      if (err instanceof ApiRequestError) {
        toast.error(`HTTP ${err.status}`, {
          description: err.responseBody?.slice(0, 1000) || err.message,
          duration: 10000,
        });
      } else {
        toast.error(err instanceof Error ? err.message : t("delistFailed"));
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {/* Publish card */}
      <button
        type="button"
        onClick={requestPublish}
        className="overflow-hidden rounded-xl border border-dashed border-border bg-card text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
      >
        <div className="flex aspect-video items-center justify-center bg-muted/30">
          <div className="flex flex-col items-center gap-2">
            <IconPlus className="size-8" />
            <span className="text-sm font-medium">{t("publishWork")}</span>
          </div>
        </div>
        <div className="p-3">
          <div className="text-sm font-medium">&nbsp;</div>
        </div>
      </button>

      {(works ?? []).map((work) => {
        const title = work.title || work.introduction || "";
        const videoPath = work.videoLink || "";
        const bannerPath = work.videoBanner || "";
        const coverUrl = bannerPath
          ? bannerPath.startsWith("http")
            ? bannerPath
            : `${env.BANNER_BASE_URL}/${bannerPath.replace(/^\/+/, "")}`
          : videoPath
            ? videoPath.startsWith("http")
              ? `${videoPath}?x-oss-process=video/snapshot,t_0,m_fast`
              : `${env.OSS_BASE_URL}/${videoPath.replace(/^\/+/, "")}?x-oss-process=video/snapshot,t_0,m_fast`
            : "";

        // Backend `review` codes (legacy fizzdragon-web parity):
        //   0 = pending review,        3 = rejected,       5 = approved.
        // Anything else (incl. legacy `1`) is treated as approved so
        // historical rows that never went through the new review queue
        // still render their action bar.
        const isReviewing = work.review === 0;
        const isRejected = work.review === 3;
        const isApproved = !isReviewing && !isRejected;
        const isPrivate = work.viewStatus !== 1;

        return (
          <div
            key={work.id}
            className="group relative overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30"
          >
            {/* Top-left: privacy state. Only meaningful once the work
                has cleared review — pending rows can't be visible to
                anyone yet, so the chip would be redundant. */}
            {isPrivate && isApproved && (
              <div className="absolute left-2 top-2 z-10 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
                {t("onlyVisibleToSelf")}
              </div>
            )}
            {/* Top-right: review status badge */}
            {isReviewing && (
              <div className="absolute right-2 top-2 z-10 rounded-full bg-yellow-500/80 px-2 py-0.5 text-[10px] font-medium text-white">
                {t("reviewing")}
              </div>
            )}
            {isRejected && (
              <div className="absolute right-2 top-2 z-10 rounded-full bg-red-500/80 px-2 py-0.5 text-[10px] font-medium text-white">
                {t("auditFailed")}
              </div>
            )}
            <div className="aspect-video overflow-hidden bg-muted">
              <img
                src={coverUrl || env.DEFAULT_COVER_URL}
                alt={title}
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.src !== env.DEFAULT_COVER_URL) img.src = env.DEFAULT_COVER_URL;
                }}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="space-y-2 p-3">
              <div className="truncate text-sm font-medium">{title || t("noData")}</div>
              {/* Action bar — only on approved works. Pending / rejected
                  rows are read-only until review resolves. */}
              {isApproved && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(work)}
                    disabled={updatingWork}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
                  >
                    <IconEdit className="size-3.5" />
                    {t("edit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleVisibility(work)}
                    disabled={updatingWork}
                    className="inline-flex flex-1 items-center justify-center rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
                  >
                    {work.viewStatus === 1 ? t("delist") : t("relist")}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <KycRequiredAlert open={kycAlertOpen} onOpenChange={setKycAlertOpen} />
      <PublishWorkDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        editWork={editing}
      />
    </div>
  );
}

// ─── My Crews Tab ─────────────────────────────────────
//
// Two sections, both sourced from one call to `GET /aurora/crews/my`:
//   1. Founded — crews the viewer created (owner badge + pending-app
//                count if any are waiting for review).
//   2. Joined  — crews the viewer was added to (via application or
//                manual add). Role label rendered from the member row.
//
// Empty states render per-section so a user with only one half (e.g.
// new account that joined a crew but never founded one) gets a clean
// "no founded crews yet" hint instead of an awkward whole-tab empty.

function MyCrewsTab() {
  const t = useTranslations("profile");
  const { data: myCrews, isLoading } = useMyCrews();

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const founded = myCrews?.founded ?? [];
  const joined = myCrews?.joined ?? [];

  if (founded.length === 0 && joined.length === 0) {
    return <p className="text-sm text-muted-foreground/70">{t("noData")}</p>;
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          {t("crewsFounded")} ({founded.length})
        </h3>
        {founded.length === 0 ? (
          <p className="text-sm text-muted-foreground/70">{t("noData")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {founded.map((crew) => (
              <MyCrewCard key={crew.id} crew={crew} isOwner />
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          {t("joinedCrews")} ({joined.length})
        </h3>
        {joined.length === 0 ? (
          <p className="text-sm text-muted-foreground/70">{t("noData")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {joined.map((crew) => (
              <MyCrewCard key={crew.id} crew={crew} isOwner={false} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── My Crew Card ─────────────────────────────────────

function MyCrewCard({ crew, isOwner }: { crew: CrewDTO; isOwner: boolean }) {
  const t = useTranslations("profile");
  const router = useRouter();
  const locale = useLocale() as Locale;
  const bannerUrl = crew.coverImage
    ? crew.coverImage.startsWith("http")
      ? crew.coverImage
      : `${env.BANNER_BASE_URL}/${crew.coverImage.replace(/^\/+/, "")}`
    : "";
  const pendingCount = crew.pendingApplicationCount ?? 0;

  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30"
      onClick={() => router.push(localizePath(`/crews/${crew.id}`, locale))}
    >
      {isOwner && (
        <div className="absolute left-2 top-2 z-10 rounded-full bg-primary/85 px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
          {t("crewOwner")}
        </div>
      )}
      {isOwner && pendingCount > 0 && (
        <div className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">
          {pendingCount} pending
        </div>
      )}
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        {bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bannerUrl} alt={crew.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-muted-foreground/30">
            {crew.name.slice(0, 1)}
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <div className="truncate text-sm font-medium">{crew.name}</div>
        <div className="text-[11px] text-muted-foreground">
          {crew.memberCount ?? 0} members · {crew.openPositionCount ?? 0} open
        </div>
        {isOwner ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              router.push(localizePath(`/crews/${crew.id}/workspace`, locale));
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            {t("openWorkspace")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────

function ProjectCard({ project }: { project: Project }) {
  const t = useTranslations("profile");
  const router = useRouter();
  const editUrl = useProjectEditUrl(project.id);
  const bannerUrl = project.bannerLink
    ? project.bannerLink.startsWith("http")
      ? project.bannerLink
      : `${env.BANNER_BASE_URL}/${project.bannerLink}`
    : "";

  return (
    <div
      className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30"
      onClick={() => router.push(`/ips/${project.id}`)}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {bannerUrl ? (
          <img src={bannerUrl} alt={project.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/30 text-2xl font-bold">
            {project.name.slice(0, 1)}
          </div>
        )}
        {/* Lifecycle badge — same source of truth as the IP edit hero
            (4-state model: 0 pending / 3 rejected / 5 approved / 8 offline). */}
        <div className="absolute top-2 left-2">
          <ProjectStatusBadge status={project.projectStatus} size="xs" />
        </div>
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-medium">{project.name}</div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.location.href = editUrl;
            }}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconEdit className="size-3" />
            {t("edit")}
          </button>
        </div>
      </div>
    </div>
  );
}
