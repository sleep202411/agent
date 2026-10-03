"use client";

import { CrewLinkedResources } from "./crew-linked-resources";
import { CrewVisitReadMarker } from "./crew-visit-read-marker";

/**
 * Crew workspace — owner / member control surface.
 *
 * Tabs (doc §4 order):
 *   - chat       — the crew's one group chat; the default landing tab
 *   - tasks      — issue-like production tasks and task canvases
 *   - assets     — crew folders, files, previews and access inheritance
 *   - members    — roster + add / remove
 *   - roles      — position CRUD + accordion-expanded applicants list
 *   - overview   — KPI tiles + recruitment progress, jumps to roles
 *
 * The active tab is URL state (`?tab=`), not component state, because
 * crew notifications deeplink into one: `?tab=tasks&task=<id>`.
 * A bare
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
 * the viewer's effective crew permissions.
 */

import { type ReactNode, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconChevronRight, IconAlertTriangle, IconLock, IconRefresh } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  useCrewDetail,
  useCrewMembers,
  useCrewPositions,
  type CrewDTO,
  type CrewPositionDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { CrewApiError } from "@/app/(site)/crews/_hooks/api";
import { useCrewPermissions } from "@/app/(site)/crews/_hooks/use-crew-permissions";
import { AddCrewMemberDialog } from "@/app/(site)/crews/_components/add-member-dialog";
import { CommunityInviteDialog } from "@/app/(site)/crews/_components/community-invite-dialog";
import { ApplicationReviewDialog } from "@/app/(site)/crews/_components/application-review-dialog";
import { CreateCrewDialog } from "@/app/(site)/crews/_components/create-crew-dialog";
import { CreateCrewJobDialog } from "@/app/(site)/crews/_components/create-crew-job-dialog";
import { MembersGrid } from "@/app/(site)/crews/[id]/workspace/_components/members/members-grid";
import { PositionCard } from "@/app/(site)/crews/[id]/workspace/_components/positions/position-card";
import { PositionDetailSheet } from "@/app/(site)/crews/[id]/workspace/_components/positions/position-detail-sheet";
import { PositionsGrid } from "@/app/(site)/crews/[id]/workspace/_components/positions/positions-grid";
import { CrewTasksTab } from "@/app/(site)/crews/[id]/workspace/_components/tasks/crew-tasks-tab";
import { CrewChatMembers } from "@/app/(site)/crews/[id]/workspace/_components/chat/crew-chat-members";
import { CrewChatTab } from "@/app/(site)/crews/[id]/workspace/_components/chat/crew-chat-tab";
import { CrewAssetsTab } from "@/app/(site)/crews/[id]/workspace/_components/assets/crew-assets-tab";
import { CrewIncomeTab } from "@/app/(site)/crews/[id]/workspace/_components/income/crew-income-tab";
import { CrewTransfersProvider } from "@/app/(site)/crews/[id]/workspace/_components/transfers/crew-transfer-center";
import { CrewWorkbenchShell } from "@/app/(site)/crews/[id]/workspace/_components/workbench/crew-workbench-shell";
import { CrewLogo } from "@/app/(site)/messages/_components/crew-logo";
import { useAnchorDeeplink } from "@/app/(site)/crews/[id]/workspace/_hooks/use-anchor-deeplink";
import { workspaceDeeplinkAnchors } from "@/app/(site)/crews/[id]/workspace/_lib/deeplink-anchors";
import {
  applyWorkspaceTab,
  resolveWorkspaceTab,
  workspaceTabsFor,
  type WorkspaceTab,
  type WorkspaceTabId,
} from "@/app/(site)/crews/[id]/workspace/_lib/workspace-tabs";
import { Button } from "@/components/ui/button";

export function CrewWorkspace({
  id,
  embedded = false,
  communityOnly = false,
}: {
  id: string;
  embedded?: boolean;
  communityOnly?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const tCrew = useTranslations("crew");
  // ?application=<id> comes from the notification deeplink. Read it
  // once and feed it straight to the review dialog; once the owner
  // closes the dialog we strip the param so refresh / back-nav don't
  // reopen the same review.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const reviewApplicationId = searchParams.get("application");
  const agreementId = searchParams.get("agreement");
  const requestedCommunityChannel = communityOnly || searchParams.get("channel") === "community";

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

  const handleCloseAgreements = useCallback(() => {
    if (!searchParams.get("agreement")) return;
    replaceParams((next) => next.delete("agreement"));
  }, [replaceParams, searchParams]);

  const handleSelectedTaskChange = useCallback(
    (taskId: string | null) => {
      if (searchParams.get("task") === taskId) return;
      replaceParams((next) => {
        if (taskId) {
          next.set("task", taskId);
          return;
        }
        next.delete("task");
        next.delete("comment");
      });
    },
    [replaceParams, searchParams]
  );

  const handleSelectedAssetChange = useCallback(
    (assetId: string | null) => {
      if (searchParams.get("asset") === assetId) return;
      replaceParams((next) => {
        if (assetId) {
          next.set("asset", assetId);
          return;
        }
        next.delete("asset");
      });
    },
    [replaceParams, searchParams]
  );

  const selectTab = useCallback(
    (tab: WorkspaceTabId) => {
      replaceParams((next) => applyWorkspaceTab(next, tab));
    },
    [replaceParams]
  );

  const selectChatChannel = useCallback(
    (channel: "team" | "community") => {
      replaceParams((next) => {
        applyWorkspaceTab(next, "chat");
        if (channel === "community") next.set("channel", "community");
        else next.delete("channel");
      });
    },
    [replaceParams]
  );

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [communityInviteOpen, setCommunityInviteOpen] = useState(false);
  const [publishJobOpen, setPublishJobOpen] = useState(false);
  const [publishTaskId, setPublishTaskId] = useState<string>();
  const [editOpen, setEditOpen] = useState(false);
  // Member removal uses the shared confirmation in the member grid and chat.
  // Position expand / freeze state is owned by PositionsGrid +
  // PositionDetailSheet — workspace no longer manages it here.

  const detailQuery = useCrewDetail(id);
  const membersQuery = useCrewMembers(id);
  const { data: crewDetail, isLoading: detailLoading } = detailQuery;
  const { data: members = [], isLoading: membersLoading } = membersQuery;
  const { data: positions = [] } = useCrewPositions(id);
  const viewer = useCrewPermissions(id);
  // 群聊 is members-only (doc §7). The roster decides that, so the tab
  // set is not knowable until `useCrewMembers` resolves — the page
  // holds its spinner until then rather than showing an outsider a chat
  // tab that flickers away, or a member an overview they did not ask
  // for.
  const canAccessChat = viewer.isMember;

  // Tab is URL state so notification deeplinks can select one and so a
  // pasted workspace link reopens where the sender was.
  const tabParam = searchParams.get("tab");
  const activeTab = resolveWorkspaceTab(tabParam, {
    entitled: canAccessChat,
  });
  const tabs = workspaceTabsFor(canAccessChat);

  // Task notifications select the real task detail with ?tab=tasks&task=<id>.
  const deeplinkTaskId = searchParams.get("task");
  const deeplinkAssetId = searchParams.get("asset");
  useAnchorDeeplink(workspaceDeeplinkAnchors(activeTab, searchParams));

  const slotsTotal = useMemo(() => positions.reduce((s, p) => s + p.targetCount, 0), [positions]);
  const slotsFilled = useMemo(
    () => positions.reduce((s, p) => s + p.recruitedCount, 0),
    [positions]
  );
  const openCount = useMemo(() => positions.filter((p) => p.status === "open").length, [positions]);

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

  const detailUnavailable =
    detailQuery.error instanceof CrewApiError && [401, 403, 404].includes(detailQuery.error.status);
  if (detailQuery.isError && (!crewDetail || detailUnavailable)) {
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
          <Link href={`/${locale}/crews`}>{tCrew("backToHall")}</Link>
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
          <Link href={`/${locale}/crews`}>{tCrew("backToHall")}</Link>
        </Button>
      </WorkspaceState>
    );
  }

  const membershipDenied =
    (membersQuery.error instanceof CrewApiError && membersQuery.error.status === 403) ||
    (process.env.NODE_ENV !== "production" && !viewer.isMember);

  if (membershipDenied) {
    if (requestedCommunityChannel) {
      return <CommunityWorkspace crew={crewDetail} embedded={embedded} />;
    }
    return (
      <WorkspaceState
        icon={<IconLock className="size-6 text-primary" />}
        title={t("workspaceAccessDeniedTitle")}
        description={t("workspaceAccessDeniedBody")}
      >
        <Button asChild size="sm" variant="solid" color="primary">
          <Link href={`/${locale}/crews/${encodeURIComponent(id)}`}>{t("viewPublicCrew")}</Link>
        </Button>
        <Button asChild size="sm" variant="ghost" color="muted">
          <Link href={`/${locale}/crews`}>{tCrew("backToHall")}</Link>
        </Button>
      </WorkspaceState>
    );
  }

  const membersUnavailable =
    membersQuery.error instanceof CrewApiError &&
    [401, 403, 404].includes(membersQuery.error.status);
  if (membersQuery.isError && (!membersQuery.isRefetchError || membersUnavailable)) {
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
          <Link href={`/${locale}/crews`}>{tCrew("backToHall")}</Link>
        </Button>
      </WorkspaceState>
    );
  }

  const refreshErrors = [detailQuery, membersQuery].filter((query) => query.isError);
  const isChat = activeTab === "chat";

  return (
    <CrewTransfersProvider crewId={id}>
      <CrewVisitReadMarker crewId={id} />
      <CrewWorkbenchShell
        embedded={embedded}
        activeChatChannel={requestedCommunityChannel ? "community" : "team"}
        activeTab={activeTab}
        tabs={tabs}
        crewId={id}
        crewLogo={crewDetail.logo}
        crewName={crewDetail.name}
        isOwner={viewer.can("crew.settings.manage")}
        onEditCrew={() => setEditOpen(true)}
        onInviteTeam={viewer.can("members.invite") ? () => setAddMemberOpen(true) : undefined}
        onInviteCommunity={
          viewer.can("members.invite") ? () => setCommunityInviteOpen(true) : undefined
        }
        onSelectChatChannel={selectChatChannel}
        onSelectTab={selectTab}
        showTeamChat
        notice={
          refreshErrors.length ? (
            <div
              role="alert"
              className="flex shrink-0 items-center gap-3 p-3 text-sm text-destructive"
            >
              <p>
                {refreshErrors
                  .map((query) => query.error?.message || t("workspaceLoadFailedBody"))
                  .join(" · ")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={refreshErrors.some((query) => query.isFetching)}
                onClick={() =>
                  void Promise.allSettled(refreshErrors.map((query) => query.refetch()))
                }
              >
                {tc("retry")}
              </Button>
            </div>
          ) : null
        }
      >
        {activeTab === "assets" ? (
          <CrewAssetsTab
            crewId={id}
            crewName={crewDetail.name}
            variant="workbench"
            initialAssetId={deeplinkAssetId}
            onSelectedAssetChange={handleSelectedAssetChange}
          />
        ) : (
          <StandardWorkspaceSurface isChat={isChat} isTaskWorkspace={activeTab === "tasks"}>
            {activeTab === "chat" ? (
              <div className="flex h-full min-h-0 min-w-0">
                <div className="min-w-0 flex-1">
                  <CrewChatTab
                    crewId={id}
                    channel={requestedCommunityChannel ? "community" : "team"}
                  />
                </div>
                {!requestedCommunityChannel ? (
                  <CrewChatMembers
                    key={id}
                    crewId={id}
                    canRemove={viewer.can("members.manage")}
                    members={members}
                    crewName={crewDetail.name}
                    onInvite={
                      viewer.can("members.invite") ? () => setAddMemberOpen(true) : undefined
                    }
                  />
                ) : null}
              </div>
            ) : null}

            {activeTab === "overview" ? (
              <OverviewTab
                crewId={id}
                positions={positions}
                memberCount={membersQuery.total}
                openJobsCount={openCount}
                slotsFilled={slotsFilled}
                slotsTotal={slotsTotal}
                isOwner={viewer.can("openings.manage")}
                t={t}
                onJumpRoles={() => selectTab("roles")}
                canManageLinks={viewer.can("production.manage")}
              />
            ) : null}

            {activeTab === "roles" ? (
              <PositionsGrid
                crewId={id}
                positions={positions}
                isOwner={viewer.can("openings.manage")}
                onPublish={() => {
                  setPublishTaskId(undefined);
                  setPublishJobOpen(true);
                }}
              />
            ) : null}

            {activeTab === "members" ? (
              <MembersGrid
                crewId={id}
                members={members}
                canInvite={viewer.can("members.invite")}
                canManageMembers={viewer.can("members.manage")}
                canManagePermissions={viewer.can("members.permissions.manage")}
                canTransferOwnership={viewer.can("ownership.transfer")}
                canManageAgreements={viewer.can("agreements.manage")}
                loading={membersLoading}
                onInvite={() => setAddMemberOpen(true)}
                initialAgreementId={agreementId}
                onAgreementsClose={handleCloseAgreements}
              />
            ) : null}

            {activeTab === "income" ? (
              <CrewIncomeTab
                crewId={id}
                crewName={crewDetail.name}
                members={members}
                canViewCrewLedger={viewer.can("finance.ledger.view")}
                canCreateEarning={viewer.can("finance.earnings.create")}
                canApproveEarning={viewer.can("finance.earnings.approve")}
                canReverseEarning={viewer.can("finance.earnings.reverse")}
                canCreatePayout={viewer.can("finance.payouts.create")}
                canManagePayout={viewer.can("finance.payouts.manage")}
              />
            ) : null}

            {activeTab === "tasks" ? (
              <CrewTasksTab
                crewId={id}
                crewName={crewDetail.name}
                crewSummary={crewDetail.tagline?.trim() || crewDetail.description}
                crewLogo={crewDetail.logo}
                crewVersion={crewDetail.version}
                members={members}
                isOwner={viewer.can("tasks.manage")}
                canCreate={viewer.can("tasks.manage")}
                onPublishTask={
                  viewer.can("openings.manage")
                    ? (taskId) => {
                        setPublishTaskId(taskId);
                        setPublishJobOpen(true);
                      }
                    : undefined
                }
                canReview={viewer.can("tasks.review")}
                canSubmitAssigned={viewer.can("tasks.submit_assigned")}
                canComment={viewer.can("tasks.comment")}
                canEditCrewInfo={viewer.can("crew.settings.manage")}
                viewerUserId={viewer.effectiveUserId}
                deeplinkTaskId={deeplinkTaskId}
                onSelectedTaskChange={handleSelectedTaskChange}
              />
            ) : null}
          </StandardWorkspaceSurface>
        )}
      </CrewWorkbenchShell>

      <AddCrewMemberDialog
        open={addMemberOpen}
        onOpenChange={setAddMemberOpen}
        crewId={id}
        canGrantPolicies={viewer.can("members.permissions.manage")}
      />
      {communityInviteOpen ? (
        <CommunityInviteDialog crewId={id} open onOpenChange={setCommunityInviteOpen} />
      ) : null}
      <CreateCrewJobDialog
        initialTaskId={publishTaskId}
        open={publishJobOpen}
        onOpenChange={setPublishJobOpen}
        crewId={id}
      />
      {/* Notification deeplink → direct review. Only mounted for the
          owner so applicants who somehow land on this URL never see
          someone else's application. */}
      {viewer.can("applications.review") ? (
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
    </CrewTransfersProvider>
  );
}

const COMMUNITY_WORKSPACE_TABS = [
  { id: "chat", labelKey: "tabChat", membersOnly: false },
  { id: "overview", labelKey: "tabOverview", membersOnly: false },
] as const satisfies readonly WorkspaceTab[];

/**
 * The community invitation lands in the existing crew workbench, not a second page.
 * This restricted shell exposes exactly two surfaces: the public community channel
 * and basic crew information. Internal team navigation is never mounted.
 */
function CommunityWorkspace({ crew, embedded = false }: { crew: CrewDTO; embedded?: boolean }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const activeTab: WorkspaceTabId = searchParams.get("tab") === "overview" ? "overview" : "chat";

  const selectTab = useCallback(
    (tab: WorkspaceTabId) => {
      if (tab !== "chat" && tab !== "overview") return;
      const next = new URLSearchParams(searchParams.toString());
      next.set("tab", tab);
      next.set("channel", "community");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  return (
    <>
      <CrewVisitReadMarker crewId={crew.id} />
      <CrewWorkbenchShell
        embedded={embedded}
        activeChatChannel="community"
        activeTab={activeTab}
        tabs={COMMUNITY_WORKSPACE_TABS}
        crewId={crew.id}
        crewLogo={crew.logo}
        crewName={crew.name}
        currentCrewHref={`${pathname}?${new URLSearchParams({ ...Object.fromEntries(searchParams), tab: "chat", channel: "community", ...(embedded ? { crew: crew.id, view: "mine" } : {}) }).toString()}`}
        isOwner={false}
        onSelectChatChannel={() => selectTab("chat")}
        onSelectTab={selectTab}
        showTeamChat={false}
      >
        <StandardWorkspaceSurface isChat={activeTab === "chat"} isTaskWorkspace={false}>
          {activeTab === "chat" ? <CrewChatTab crewId={crew.id} channel="community" /> : null}
          {activeTab === "overview" ? <CommunityCrewBasicInfo crew={crew} /> : null}
        </StandardWorkspaceSurface>
      </CrewWorkbenchShell>
    </>
  );
}

function CommunityCrewBasicInfo({ crew }: { crew: CrewDTO }) {
  return (
    <section className="mx-auto max-w-3xl py-6">
      <div className="flex items-start gap-4">
        <CrewLogo logo={crew.logo} name={crew.name} crewId={crew.id} className="size-16 shrink-0" />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-foreground">{crew.name}</h2>
          {crew.tagline ? (
            <p className="mt-2 text-sm leading-6 text-foreground/85">{crew.tagline}</p>
          ) : null}
        </div>
      </div>
      {crew.description ? (
        <p className="mt-6 whitespace-pre-line text-sm leading-7 text-foreground/85">
          {crew.description}
        </p>
      ) : null}
    </section>
  );
}

function StandardWorkspaceSurface({
  isChat,
  isTaskWorkspace,
  children,
}: {
  isChat: boolean;
  isTaskWorkspace: boolean;
  children: ReactNode;
}) {
  if (isChat || isTaskWorkspace) {
    return (
      <div className="h-full min-h-0 overflow-hidden bg-background">
        <div className="h-full min-h-0 w-full">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto w-full max-w-[1480px]">{children}</div>
      </div>
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
  canManageLinks: boolean;
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
  canManageLinks,
}: OverviewTabProps) {
  // Same card components the Roles tab uses → visual + interactive
  // consistency. Overview shows only OPEN positions (preview semantics)
  // capped at OVERVIEW_POSITIONS_PREVIEW; "view all" jumps to Roles tab.
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

  const selected = positions.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <CrewLinkedResources crewId={crewId} canManage={canManageLinks} />
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
                  applicantCount={p.applicationStats?.total ?? 0}
                  pendingApplicantCount={p.applicationStats?.pending ?? 0}
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
