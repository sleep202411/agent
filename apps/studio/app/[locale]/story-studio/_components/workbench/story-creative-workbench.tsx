"use client";

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconArtboard,
  IconBookmarkFilled,
  IconBookmarkPlus,
  IconLoader2,
  IconTable,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { ReactFlowProvider } from "@xyflow/react";
import { useSearchParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/navigation";
import { ProjectProvider } from "@/app/[locale]/project/_components/project-context";
import { CanvasConnectionProvider } from "@/app/[locale]/project/_components/canvas-connection-context";
import {
  PROJECT_PANEL_WIDTH,
  ProjectSidebar,
} from "@/app/[locale]/project/_components/project-sidebar";
import { WorkbenchPanelContent } from "@/app/[locale]/project/_components/workbench-panel-content";
import { DirectorDeskHost } from "@/components/canvas/authoring/director-desk-host";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import { CanvasView } from "@/app/[locale]/canvas/_components/canvas-view";
import { CollabAvatars } from "@/app/[locale]/canvas/_components/collab-presence";
import { StoryboardTable } from "@/app/[locale]/project/_modes/storyboard/storyboard-table";
import { CreditsBadge } from "@/app/_components/credits-badge";
import { ShareDialog } from "@/app/_components/share-dialog";
import { AgentOsPanel } from "@/components/agent-os/agent-os-panel";
import { FizzAgentOrbButton } from "@/components/fizz-agent";
import {
  CanvasMediaActionsProvider,
  type CanvasMediaActionsResolver,
} from "@/components/canvas/authoring/media-actions-context";
import { StoryCandidateAssetsPanel } from "../project-canvas/story-candidate-assets-panel";
import { useStoryCandidateAssets } from "../project-canvas/use-story-candidate-assets";
import { useStoryCanvasDocument } from "../../_lib/use-story-documents";
import { useAuth } from "@/app/_components/auth-provider";
import { getStoryWorkbench, storyApiErrorMessage } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import { useCanvasConnection } from "@/app/[locale]/project/_components/canvas-connection-context";

const STORY_WORKBENCH_MODES = ["canvas", "storyboard"] as const;
const STORY_UPLOAD_KINDS = ["image", "video", "audio"] as const;
type StoryWorkbenchMode = (typeof STORY_WORKBENCH_MODES)[number];

export function StoryCreativeWorkbench({
  projectId,
  activeMode,
}: {
  projectId: string;
  activeMode: StoryWorkbenchMode;
}) {
  const { user } = useAuth();
  const t = useTranslations("storyStudio.canvas.creativeWorkbench");
  const projectT = useTranslations("project");
  const commonT = useTranslations("common");
  const [shareOpen, setShareOpen] = useState(false);
  const workbenchQuery = useQuery({
    queryKey: ["story-studio", "workbench-shell", projectId, user?.id ?? null],
    queryFn: ({ signal }) => getStoryWorkbench(projectId, undefined, signal),
    enabled: Boolean(projectId && user),
    staleTime: 20_000,
  });
  const documentQuery = useStoryCanvasDocument(projectId);

  if (workbenchQuery.isPending || documentQuery.isPending) {
    return <WorkbenchLoading label={t("status.loading")} />;
  }
  const project = workbenchQuery.data?.project;
  const workspaceId = project?.workspaceId ?? null;
  const document = documentQuery.data;
  if (!workspaceId || !project || !document || workbenchQuery.isError || documentQuery.isError) {
    const error = workbenchQuery.error ?? documentQuery.error;
    return (
      <WorkbenchError
        message={storyApiErrorMessage(error, projectT("sections.invalid"))}
        retryLabel={commonT("retry")}
        onRetry={() => {
          void workbenchQuery.refetch();
          void documentQuery.refetch();
        }}
      />
    );
  }

  const canEdit = project.capabilities.includes("story.edit");
  const canGenerate = project.capabilities.includes("story.generate");
  const canManage = project.capabilities.includes("story.admin");
  const role = canManage ? "owner" : canEdit ? "editor" : "viewer";

  return (
    <ProjectProvider
      projectId={projectId}
      workspaceId={workspaceId}
      owner={{ kind: "story_project", projectId }}
      uploadKinds={STORY_UPLOAD_KINDS}
      role={role}
      openShare={() => setShareOpen(true)}
    >
      <CanvasConnectionProvider
        owner={{ kind: "story_project", projectId }}
        documentId={document.id}
        canEdit={canEdit}
        canGenerate={canGenerate}
        generationDisabledReason={canGenerate ? null : t("disabled.permission")}
      >
        <StoryWorkbenchShell
          projectId={projectId}
          title={project.title}
          activeMode={activeMode}
          canEdit={canEdit}
          canManage={canManage}
          shareOpen={shareOpen}
          onShareOpenChange={setShareOpen}
        />
      </CanvasConnectionProvider>
    </ProjectProvider>
  );
}

function StoryWorkbenchShell({
  projectId,
  title,
  activeMode,
  canEdit,
  canManage,
  shareOpen,
  onShareOpenChange,
}: {
  projectId: string;
  title: string;
  activeMode: StoryWorkbenchMode;
  canEdit: boolean;
  canManage: boolean;
  shareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("storyStudio.canvas.creativeWorkbench");
  const projectT = useTranslations("project");
  const agentT = useTranslations("agentOs");
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentOpen = useProjectUIStore((state) => state.copilotOpen);
  const toggleAgent = useProjectUIStore((state) => state.toggleCopilot);
  const closeAgent = useProjectUIStore((state) => state.closeCopilot);
  const assetsOpen = useProjectUIStore((state) => state.assetsOpen);
  const nodesOpen = useProjectUIStore((state) => state.nodesOpen);
  const historyOpen = useProjectUIStore((state) => state.historyOpen);
  const skillsOpen = useProjectUIStore((state) => state.skillsOpen);
  const selectedShotId = useProjectUIStore((state) => state.selectedShotId);
  const leftDrawerOpen =
    assetsOpen || nodesOpen || historyOpen || skillsOpen || Boolean(selectedShotId);
  const leftInset = 64 + (leftDrawerOpen ? PROJECT_PANEL_WIDTH : 0);
  const candidates = useStoryCandidateAssets({ projectId, canEdit });
  const { awareness, doc } = useCanvasConnection();

  const resolveMediaActions = useCallback<CanvasMediaActionsResolver>(
    (media) => {
      if (!candidates.canEdit) return [];
      const active = candidates.candidateIds.has(media.mediaAssetId);
      const pending = candidates.pendingIds.has(media.mediaAssetId);
      return [
        {
          id: "story-candidate",
          label: active ? t("candidates.remove") : t("candidates.add"),
          icon: active ? (
            <IconBookmarkFilled className="size-4" stroke={1.8} />
          ) : (
            <IconBookmarkPlus className="size-4" stroke={1.8} />
          ),
          active,
          pending,
          onSelect: () => void candidates.toggle(media.mediaAssetId),
        },
      ];
    },
    [candidates, t]
  );
  const candidateTab = useMemo(
    () => ({
      id: "story-candidates",
      label: t("candidates.title"),
      render: () => <StoryCandidateAssetsPanel controller={candidates} />,
    }),
    [candidates, t]
  );
  const onOpenOnCanvas = useCallback(
    (nodeId: string) =>
      router.push(
        `/story-studio/projects/${projectId}/workbench/canvas?focus=${encodeURIComponent(nodeId)}`
      ),
    [projectId, router]
  );

  return (
    <CanvasMediaActionsProvider value={resolveMediaActions}>
      <div className="flex h-dvh bg-[var(--canvas-background)] text-white">
        <div
          className="relative min-w-0 flex-1 overflow-hidden"
          style={
            {
              "--project-shell-left-inset": `${leftInset}px`,
              "--project-canvas-left-overlay-inset": `${leftInset}px`,
              "--project-canvas-right-overlay-inset": "80px",
            } as CSSProperties
          }
        >
          <main className="absolute inset-0 min-w-0">
            {activeMode === "canvas" ? (
              <CanvasView projectId={projectId} canEdit={canEdit} />
            ) : (
              <div className="absolute inset-0 pt-14" style={{ paddingLeft: leftInset }}>
                <ReactFlowProvider>
                  <StoryboardTable
                    focusRowId={searchParams.get("row")}
                    onOpenOnCanvas={onOpenOnCanvas}
                  />
                </ReactFlowProvider>
              </div>
            )}
          </main>

          <div className="pointer-events-auto absolute inset-y-0 left-0 z-40">
            <ProjectSidebar
              activeMode={activeMode}
              backHref={`/story-studio/projects/${projectId}/canvas`}
              panel={
                <WorkbenchPanelContent
                  activeMode={activeMode}
                  canEdit={canEdit}
                  assetTab={candidateTab}
                  onOpenOnCanvas={onOpenOnCanvas}
                />
              }
              panelOpen={leftDrawerOpen}
            />
          </div>
          <DirectorDeskHost />

          <header
            className="pointer-events-none absolute top-0 right-0 z-30 flex h-14 items-center gap-3 px-4"
            style={{ left: leftInset }}
          >
            <span className="max-w-60 truncate text-sm font-medium text-white/88">{title}</span>
            <nav className="pointer-events-auto mx-auto flex items-center gap-0.5 rounded-full bg-white/[0.06] p-1">
              {STORY_WORKBENCH_MODES.map((mode) => {
                const Icon = mode === "canvas" ? IconArtboard : IconTable;
                return (
                  <Link
                    key={mode}
                    href={`/story-studio/projects/${projectId}/workbench/${mode}`}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                      mode === activeMode
                        ? "bg-white text-black"
                        : "text-white/70 hover:bg-white/[0.08] hover:text-white"
                    )}
                  >
                    <Icon className="size-3.5" stroke={1.8} />
                    {projectT(mode === "canvas" ? "modes.canvas" : "modes.storyboard")}
                  </Link>
                );
              })}
            </nav>
            <div className="pointer-events-auto ml-auto flex items-center gap-2">
              <CollabAvatars awareness={awareness} localClientId={doc?.clientID} />
              <CreditsBadge className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-xs font-medium tabular-nums" />
            </div>
          </header>

          {!agentOpen ? (
            <FizzAgentOrbButton
              size={60}
              onClick={toggleAgent}
              className="pointer-events-auto absolute right-4 bottom-4 z-30"
              aria-label={agentT("open")}
              title={agentT("open")}
            />
          ) : null}
        </div>

        <AgentOsPanel
          canWrite={canEdit}
          projectId={projectId}
          projectKind="story"
          workbenchMode="story"
          open={agentOpen}
          onClose={closeAgent}
        />
      </div>

      <ShareDialog
        scope={{ kind: "story-project", id: projectId, name: title }}
        canManage={canManage}
        open={shareOpen}
        onOpenChange={onShareOpenChange}
      />
    </CanvasMediaActionsProvider>
  );
}

function WorkbenchLoading({ label }: { label: string }) {
  return (
    <div className="grid h-dvh place-items-center bg-[var(--canvas-background)] text-white/50">
      <div className="flex items-center gap-2 text-sm">
        <IconLoader2 className="size-4 animate-spin" />
        {label}
      </div>
    </div>
  );
}

function WorkbenchError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="grid h-dvh place-items-center bg-[var(--canvas-background)] px-6 text-white">
      <div className="max-w-md text-center">
        <p className="text-sm text-white/65">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-xl bg-white/[0.08] px-4 py-2 text-xs font-medium hover:bg-white/[0.12]"
        >
          {retryLabel}
        </button>
      </div>
    </div>
  );
}
