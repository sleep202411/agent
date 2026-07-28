"use client";

/**
 * Crew workspace — owner / member control surface.
 *
 * Tabs (doc §4 order):
 *   - chat       — the crew's one group chat; the default landing tab
 *   - episodes   — production task units + their assignments
 *   - assets     — crew folders, files, previews and access inheritance
 *   - members    — roster + add / remove
 *   - roles      — position CRUD + accordion-expanded applicants list
 *   - overview   — KPI tiles + recruitment progress, jumps to roles
 *
 * The active tab is URL state (`?tab=`), not component state, because
 * crew notifications deeplink into one: `?tab=episodes&episode=<id>`
 * opens the board, expands that episode and scrolls it into view, and
 * `&assignment=<id>` refines the scroll to the row inside it. A bare
 * URL carries no tab: it means "open this workspace", and the landing
 * resolves to chat only while the crew's conversation opens — see
 * `_lib/workspace-tabs`.
 *
 * Layout: every tab except chat is a normal scrolling page. Chat turns
 * the page into a fixed-height app shell (root `h-[calc(100dvh-4rem)]`,
 * hero + header `shrink-0`, body `min-h-0 flex-1`) so the composer sits
 * at the bottom of the viewport instead of below the fold — doc §9's
 * 输入框在桌面和移动端都固定可达. Measuring the pane's offset in JS
 * would achieve the same thing and be wrong every time the hero image
 * changes height; CSS gets it right for free.
 *
 * Backed only by /aurora/crews/* endpoints. Every action is gated on
 * the viewer's crew role, resolved by `useUserCrewRole`.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  IconArrowLeft,
  IconBook,
  IconBriefcase,
  IconChevronRight,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconAlertTriangle,
  IconFolder,
  IconLock,
  IconLoader2,
  IconMessageCircle,
  IconMovie,
  IconRefresh,
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
import { CrewApiError } from "@/app/(site)/crews/_hooks/api";
import { DevIdentitySwitcher } from "@/app/(site)/crews/_components/dev-identity-switcher";
import { useUserCrewRole } from "@/app/(site)/crews/_hooks/use-user-crew-role";
import { AddCrewMemberDialog } from "@/app/(site)/crews/_components/add-member-dialog";
import { ApplicationReviewDialog } from "@/app/(site)/crews/_components/application-review-dialog";
import { CreateCrewDialog } from "@/app/(site)/crews/_components/create-crew-dialog";
import { CreateCrewJobDialog } from "@/app/(site)/crews/_components/create-crew-job-dialog";
import { MembersGrid } from "@/app/(site)/crews/[id]/workspace/_components/members/members-grid";
import { PositionCard } from "@/app/(site)/crews/[id]/workspace/_components/positions/position-card";
import { PositionDetailSheet } from "@/app/(site)/crews/[id]/workspace/_components/positions/position-detail-sheet";
import { PositionsGrid } from "@/app/(site)/crews/[id]/workspace/_components/positions/positions-grid";
import { EpisodesTab } from "@/app/(site)/crews/[id]/workspace/_components/episodes/episodes-tab";
import { CrewChatTab } from "@/app/(site)/crews/[id]/workspace/_components/chat/crew-chat-tab";
import { CrewAssetsTab } from "@/app/(site)/crews/[id]/workspace/_components/assets/crew-assets-tab";
import { useAnchorDeeplink } from "@/app/(site)/crews/[id]/workspace/_hooks/use-anchor-deeplink";
import { useCrewConversation } from "@/app/(site)/crews/[id]/workspace/_hooks/use-crew-conversation";
import { workspaceDeeplinkAnchors } from "@/app/(site)/crews/[id]/workspace/_lib/deeplink-anchors";
import {
  FALLBACK_WORKSPACE_TAB,
  applyWorkspaceTab,
  isWorkspaceTabId,
  resolveWorkspaceTab,
  workspaceTabsFor,
  type WorkspaceTabId,
} from "@/app/(site)/crews/[id]/workspace/_lib/workspace-tabs";
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
import { Button } from "@/components/ui/button";

/** Icons live here rather than in `_lib/workspace-tabs` so the tab
 *  contract stays importable from plain (non-React) modules. */
const TAB_ICONS: Record<WorkspaceTabId, typeof IconBook> = {
  chat: IconMessageCircle,
  episodes: IconMovie,
  assets: IconFolder,
  members: IconUsers,
  roles: IconBriefcase,
  overview: IconBook,
};

export default function CrewWorkspacePage() {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const tCrew = useTranslations("crew");
  const params = useParams<{ id: string }>();
  const id = params.id;
  // ?application=<id> comes from the notification deeplink. Read it
  // once and feed it straight to the review dialog; once the owner
  // closes the dialog we strip the param so refresh / back-nav don't
  // reopen the same review.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const reviewApplicationId = searchParams.get("application");

  // Every URL edit on this page is a `replace`: the query string carries
  // view state (tab, consumed deeplinks), and pushing it would make the
  // back button walk the workspace's own tabs instead of leaving it.
  const replaceParams = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const handleCloseReview = useCallback(() => {
    if (!searchParams.get("application")) return;
    replaceParams((next) => next.delete("application"));
  }, [replaceParams, searchParams]);

  const selectTab = useCallback(
    (tab: WorkspaceTabId) => {
      replaceParams((next) => applyWorkspaceTab(next, tab));
    },
    [replaceParams]
  );

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [publishJobOpen, setPublishJobOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [listingIntent, setListingIntent] = useState<"listed" | "unlisted" | null>(null);
  // Member-remove confirmation state moved into MembersGrid — the only
  // surface that triggers a remove.
  // Position expand / freeze state is owned by PositionsGrid +
  // PositionDetailSheet — workspace no longer manages it here.

  const detailQuery = useCrewDetail(id);
  const membersQuery = useCrewMembers(id);
  const { data: crewDetail, isLoading: detailLoading } = detailQuery;
  const { data: members = [], isLoading: membersLoading } = membersQuery;
  const { data: positions = [] } = useCrewPositions(id);
  const updateListing = useUpdateCrewListing();
  // Role gating goes through useUserCrewRole so DevIdentitySwitcher
  // works in dev (without it the workspace gates on the real Java
  // satoken user id, which doesn't match the server-side AUTH_DISABLED
  // fallback user 'dev' that owns rows created locally). Production
  // users still resolve from `useUserInfo` inside the hook.
  const viewer = useUserCrewRole(id);
  const isOwner = viewer.isAdmin;
  // 群聊 is members-only (doc §7). The roster decides that, so the tab
  // set is not knowable until `useCrewMembers` resolves — the page
  // holds its spinner until then rather than showing an outsider a chat
  // tab that flickers away, or a member an overview they did not ask
  // for.
  const canAccessChat = viewer.role !== "outsider";

  // Resolved here, not only inside CrewChatTab, because the landing tab
  // depends on it: chat is the default the doc asks for, but only while
  // the crew's conversation actually opens. Same React Query key as the
  // pane's, so this warms its cache rather than duplicating its fetch.
  const chatThread = useCrewConversation(id, canAccessChat);

  // Tab is URL state so notification deeplinks can select one and so a
  // pasted workspace link reopens where the sender was.
  const tabParam = searchParams.get("tab");
  const activeTab = resolveWorkspaceTab(tabParam, {
    entitled: canAccessChat,
    reachable: !chatThread.isError,
  });
  const tabs = workspaceTabsFor(canAccessChat);

  // The demotion above is a render-time decision, so a member whose
  // chat will not open never sees the error card they did not ask for.
  // Stamp it into the URL too: without that, the bare URL still means
  // "chat if you can", and a background refetch that later succeeds
  // would yank the reader off the overview mid-read. Asking for chat by
  // name still opens the pane — see `resolveWorkspaceTab`.
  const demotedFromChat = !isWorkspaceTabId(tabParam) && canAccessChat && chatThread.isError;
  useEffect(() => {
    if (!demotedFromChat) return;
    replaceParams((next) => applyWorkspaceTab(next, FALLBACK_WORKSPACE_TAB));
  }, [demotedFromChat, replaceParams]);

  // ?episode=<id>, and on assignment-level notifications ?assignment=<id>,
  // ride along with ?tab=episodes. The episode id also goes to the board,
  // which expands that row — without that the assignment row never
  // mounts, since the accordion body is what renders it.
  const deeplinkEpisodeId = searchParams.get("episode");
  useAnchorDeeplink(workspaceDeeplinkAnchors(activeTab, searchParams));

  const slotsTotal = useMemo(() => positions.reduce((s, p) => s + p.targetCount, 0), [positions]);
  const slotsFilled = useMemo(
    () => positions.reduce((s, p) => s + p.recruitedCount, 0),
    [positions]
  );
  const openCount = useMemo(() => positions.filter((p) => p.status === "open").length, [positions]);
  const isListed = crewDetail?.listingStatus === "listed";

  if (detailLoading || membersLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <span className="sr-only">{t("workspaceLoading")}</span>
        </div>
      </div>
    );
  }

  if (detailQuery.isError) {
    return (
      <WorkspaceState
        icon={<IconAlertTriangle className="size-6 text-destructive" />}
        title={t("workspaceLoadFailedTitle")}
        description={
          detailQuery.error instanceof Error
            ? detailQuery.error.message
            : t("workspaceLoadFailedBody")
        }
      >
        <Button
          type="button"
          size="sm"
          variant="solid"
          color="primary"
          onClick={() => void detailQuery.refetch()}
          loading={detailQuery.isFetching}
          icon={<IconRefresh />}
        >
          {tc("retry")}
        </Button>
        <Button asChild size="sm" variant="ghost" color="muted">
          <Link href="/crews">{tCrew("backToHall")}</Link>
        </Button>
      </WorkspaceState>
    );
  }

  if (!crewDetail) {
    return (
      <WorkspaceState
        icon={<IconAlertTriangle className="size-6 text-muted-foreground" />}
        title={t("workspaceNotFoundTitle")}
        description={t("workspaceNotFoundBody")}
      >
        <Button asChild size="sm" variant="solid" color="primary">
          <Link href="/crews">{tCrew("backToHall")}</Link>
        </Button>
      </WorkspaceState>
    );
  }

  const membershipDenied =
    (membersQuery.error instanceof CrewApiError && membersQuery.error.status === 403) ||
    (process.env.NODE_ENV !== "production" && viewer.role === "outsider");

  if (membershipDenied) {
    return (
      <WorkspaceState
        icon={<IconLock className="size-6 text-primary" />}
        title={t("workspaceAccessDeniedTitle")}
        description={t("workspaceAccessDeniedBody")}
      >
        <Button asChild size="sm" variant="solid" color="primary">
          <Link href={`/crews/${encodeURIComponent(id)}`}>{t("viewPublicCrew")}</Link>
        </Button>
        <Button asChild size="sm" variant="ghost" color="muted">
          <Link href="/crews">{tCrew("backToHall")}</Link>
        </Button>
      </WorkspaceState>
    );
  }

  if (membersQuery.isError) {
    return (
      <WorkspaceState
        icon={<IconAlertTriangle className="size-6 text-destructive" />}
        title={t("workspaceLoadFailedTitle")}
        description={
          membersQuery.error instanceof Error
            ? membersQuery.error.message
            : t("workspaceLoadFailedBody")
        }
      >
        <Button
          type="button"
          size="sm"
          variant="solid"
          color="primary"
          onClick={() => void membersQuery.refetch()}
          loading={membersQuery.isFetching}
          icon={<IconRefresh />}
        >
          {tc("retry")}
        </Button>
        <Button asChild size="sm" variant="ghost" color="muted">
          <Link href="/crews">{tCrew("backToHall")}</Link>
        </Button>
      </WorkspaceState>
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

  // Chat is a fixed-height app shell; every other tab is a normal
  // scrolling page. See the module comment.
  const isChat = activeTab === "chat";

  return (
    <div
      className={cn(
        "bg-background",
        isChat ? "flex h-[calc(100dvh-4rem)] flex-col overflow-hidden" : "min-h-screen"
      )}
    >
      <DevIdentitySwitcher />

      {heroVisual ? (
        <div className="relative h-48 w-full shrink-0 overflow-hidden bg-black sm:h-64">
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

      <div className="shrink-0 border-b border-border bg-card/50">
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

      <div
        className={cn(
          "mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-6 py-6 md:flex-row",
          isChat && "min-h-0 flex-1 overflow-hidden"
        )}
      >
        {/* Vertical rail on desktop; a horizontal scroller on phones,
            where a 144px column would leave the chat pane unusably
            narrow. */}
        <div className="w-full shrink-0 md:w-36">
          <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:sticky md:top-6 md:mx-0 md:block md:space-y-0.5 md:overflow-x-visible md:px-0 md:pb-0">
            {tabs.map((tab) => {
              const Icon = TAB_ICONS[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-sm transition-colors md:w-full",
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

        <div className={cn("min-w-0 flex-1", isChat && "min-h-0")}>
          {activeTab === "chat" ? <CrewChatTab crewId={id} /> : null}

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
              onJumpRoles={() => selectTab("roles")}
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

          {activeTab === "episodes" ? (
            <EpisodesTab crewId={id} deeplinkEpisodeId={deeplinkEpisodeId} />
          ) : null}

          {activeTab === "assets" ? <CrewAssetsTab crewId={id} /> : null}
        </div>
      </div>

      <AddCrewMemberDialog open={addMemberOpen} onOpenChange={setAddMemberOpen} crewId={id} />
      <CreateCrewJobDialog open={publishJobOpen} onOpenChange={setPublishJobOpen} crewId={id} />
      {/* Notification deeplink → direct review. Only mounted for the
          owner so applicants who somehow land on this URL never see
          someone else's application. */}
      {isOwner ? (
        <ApplicationReviewDialog
          crewId={id}
          applicationId={reviewApplicationId}
          onClose={handleCloseReview}
        />
      ) : null}
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

function WorkspaceState({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main
      className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-background px-6 py-16"
      aria-labelledby="workspace-state-title"
    >
      <DevIdentitySwitcher />
      <div className="flex max-w-md flex-col items-center text-center">
        <div
          className="mb-5 grid size-12 place-items-center rounded-full bg-muted"
          aria-hidden="true"
        >
          {icon}
        </div>
        <h1 id="workspace-state-title" className="text-xl font-bold text-foreground">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{children}</div>
      </div>
    </main>
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
