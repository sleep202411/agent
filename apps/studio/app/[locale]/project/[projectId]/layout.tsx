"use client";
import { ProjectAccessBoundary } from "@/app/[locale]/project/_components/project-access-boundary";
import { SectionCanvasBoundary } from "@/app/[locale]/project/_components/project-section-boundary";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";

import {
  Component,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { IconEye } from "@tabler/icons-react";
import { agentOsWorkbenchModeFromStudioMode } from "@repo/shared";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ProjectProvider } from "@/app/[locale]/project/_components/project-context";
import { useCanvasConnection } from "@/app/[locale]/project/_components/canvas-connection-context";
import {
  PROJECT_PANEL_CLOSE_DURATION_MS,
  PROJECT_PANEL_OPEN_DURATION_MS,
  PROJECT_PANEL_WIDTH,
  ProjectSidebar,
} from "@/app/[locale]/project/_components/project-sidebar";
import {
  ProjectSectionsProvider,
  useProjectSections,
} from "@/app/[locale]/project/_components/project-sections-context";
import { ProjectSectionsPanel } from "@/app/[locale]/project/_components/project-sections-panel";
import { ProjectOverviewPanel } from "@/app/[locale]/project/_components/project-overview-panel";
import { WorkbenchPanelContent } from "@/app/[locale]/project/_components/workbench-panel-content";
import { CreditsBadge } from "@/app/_components/credits-badge";
import { CollabAvatars } from "@/app/[locale]/canvas/_components/collab-presence";
import { AgentOsPanel } from "@/components/agent-os/agent-os-panel";
import { FizzAgentOrbButton } from "@/components/fizz-agent";
import { ShareDialog } from "@/app/_components/share-dialog";
import { MODE_ORDER, getMode } from "@/app/[locale]/project/_modes/registry";
import { renameProject, type ProjectRef } from "@/lib/collab/projects-api";
import { useProjectPromptHandoff } from "@/app/[locale]/project/_components/use-project-prompt-handoff";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";

export default function ProjectLayout({
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  return (
    <ProjectAccessBoundary projectId={projectId}>
      {(project) => <ProjectSession project={project} />}
    </ProjectAccessBoundary>
  );
}

function ProjectSession({ project }: { project: ProjectRef }) {
  const projectId = project.id;
  const t = useTranslations("project");
  const routeParams = useParams();
  const activeMode = typeof routeParams.mode === "string" ? routeParams.mode : "canvas";

  const [name, setName] = useState(project.name);
  const role = project.role ?? null;
  const workspaceId = project.workspaceId;
  const [shareOpen, setShareOpen] = useState(false);
  const setShellInset = useCallback(() => {}, []);

  const copilotOpen = useProjectUIStore((s) => s.copilotOpen);
  const closeCopilot = useProjectUIStore((s) => s.closeCopilot);
  const historyOpen = useProjectUIStore((s) => s.historyOpen);
  const overviewOpen = useProjectUIStore((s) => s.overviewOpen);
  const assetsOpen = useProjectUIStore((s) => s.assetsOpen);
  const actorsOpen = useProjectUIStore((s) => s.actorsOpen);
  const crewAssetsOpen = useProjectUIStore((s) => s.crewAssetsOpen);
  const nodesOpen = useProjectUIStore((s) => s.nodesOpen);
  const closeNodes = useProjectUIStore((s) => s.closeNodes);
  const sectionsOpen = useProjectUIStore((s) => s.sectionsOpen);
  const skillsOpen = useProjectUIStore((s) => s.skillsOpen);
  const selectedShotId = useProjectUIStore((s) => s.selectedShotId);

  const committedRef = useRef(project.name);
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  const canManage = role === "owner" || role === "admin";
  const isCanvasMode = activeMode === "canvas";
  const nodesEnabled = (isCanvasMode || activeMode === "storyboard") && canEdit;
  const leftDrawerOpen =
    (nodesOpen && nodesEnabled) ||
    assetsOpen ||
    crewAssetsOpen ||
    (actorsOpen && activeMode === "canvas") ||
    historyOpen ||
    overviewOpen ||
    sectionsOpen ||
    skillsOpen ||
    Boolean(selectedShotId);
  const projectShellLeftInset = 64 + (leftDrawerOpen ? PROJECT_PANEL_WIDTH : 0);
  const projectShellInsetTransition = leftDrawerOpen
    ? `${PROJECT_PANEL_OPEN_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
    : `${PROJECT_PANEL_CLOSE_DURATION_MS}ms cubic-bezier(0.4, 0, 1, 1)`;
  const openShare = useCallback(() => setShareOpen(true), []);

  useEffect(() => {
    if (!nodesEnabled && nodesOpen) closeNodes();
  }, [closeNodes, nodesEnabled, nodesOpen]);

  const commitName = (next: string) => {
    if (!canEdit) return;
    const trimmed = next.trim();
    if (!trimmed) {
      setName(committedRef.current);
      return;
    }
    if (trimmed === committedRef.current) {
      setName(trimmed);
      return;
    }
    const previous = committedRef.current;
    committedRef.current = trimmed;
    setName(trimmed);
    void renameProject(projectId, trimmed).catch(() => {
      committedRef.current = previous;
      setName(previous);
      toast.error(t("renameFailed"));
    });
  };

  /** The overview panel saves the name through its own PATCH; mirror the
   *  committed value so the header's inline input stays in sync. */
  const commitNameFromPanel = (next: string) => {
    committedRef.current = next;
    setName(next);
  };

  const projectHeader = (
    <header
      className="pointer-events-none absolute top-0 right-0 z-30 flex h-14 shrink-0 items-center gap-3 bg-transparent px-4"
      style={{
        left: "var(--project-shell-left-inset, 64px)",
        transition: `left ${projectShellInsetTransition}`,
      }}
    >
      <input
        value={name}
        aria-label={t("projectName")}
        placeholder={t("untitled")}
        readOnly={!canEdit}
        onChange={(event) => {
          if (!canEdit) return;
          setName(event.target.value);
        }}
        onBlur={(event) => commitName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="pointer-events-auto field-sizing-content h-8 min-w-[80px] max-w-[240px] rounded-full px-3 text-sm font-medium outline-none transition-colors read-only:cursor-default hover:bg-white/[0.06] focus:bg-white/[0.06]"
      />

      <ModeTabs projectId={projectId} activeMode={activeMode} />

      <div className="pointer-events-auto ml-auto flex items-center gap-2">
        {role === "viewer" && (
          <span className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-xs font-medium text-white/70">
            <IconEye className="size-4" stroke={1.8} />
            {t("viewOnly")}
          </span>
        )}
        <HeaderActions />
      </div>
    </header>
  );

  return (
    <ProjectProvider
      projectId={projectId}
      workspaceId={workspaceId}
      role={role}
      openShare={openShare}
      setShellInset={setShellInset}
    >
      <ProjectSectionsProvider projectId={projectId}>
        <div className="flex h-dvh">
          <SectionCanvasBoundary projectId={projectId} canEdit={canEdit}>
            <div
              className="relative min-w-0 flex-1 overflow-hidden"
              style={
                {
                  "--project-shell-left-inset": `${projectShellLeftInset}px`,
                  "--project-canvas-left-overlay-inset": `${projectShellLeftInset}px`,
                  "--project-canvas-right-overlay-inset": "80px",
                } as CSSProperties
              }
            >
              <PersistentModeStage
                activeMode={activeMode}
                shellInsetTransition={projectShellInsetTransition}
              />
              <div className="pointer-events-auto absolute inset-y-0 left-0 z-40">
                <ProjectSidebar
                  activeMode={activeMode}
                  panel={
                    <ProjectPanelContent
                      activeMode={activeMode}
                      canEdit={canEdit}
                      projectId={projectId}
                      onNameCommitted={commitNameFromPanel}
                    />
                  }
                  panelOpen={leftDrawerOpen}
                  crewAssetsEnabled
                />
              </div>
              {projectHeader}
              {!copilotOpen && (
                <AgentToggle className="pointer-events-auto absolute right-4 bottom-4 z-30" />
              )}
            </div>
          </SectionCanvasBoundary>

          <SectionAgentPanel
            projectId={projectId}
            activeMode={activeMode}
            open={copilotOpen}
            onClose={closeCopilot}
          />
        </div>

        {role != null && (
          <ShareDialog
            scope={{ kind: "project", id: projectId, name: name || t("thisProject") }}
            canManage={canManage}
            open={shareOpen}
            onOpenChange={setShareOpen}
          />
        )}
      </ProjectSectionsProvider>
    </ProjectProvider>
  );
}

/**
 * Keeps every mode visited in this project mounted while switching routes.
 * Inactive layers remain sized but are not painted or interactive, so React
 * Flow never observes a zero-sized canvas and media DOM, scroll positions and
 * editor drafts survive mode changes.
 */
interface PersistentModeStageProps {
  activeMode: string;
  shellInsetTransition: string;
}

interface PersistentModeStageState {
  mountedModes: readonly string[];
}

class PersistentModeStage extends Component<PersistentModeStageProps, PersistentModeStageState> {
  state: PersistentModeStageState = { mountedModes: [this.props.activeMode] };

  static getDerivedStateFromProps(
    { activeMode }: PersistentModeStageProps,
    { mountedModes }: PersistentModeStageState
  ): PersistentModeStageState | null {
    if (!getMode(activeMode) || mountedModes.includes(activeMode)) return null;
    return { mountedModes: [...mountedModes, activeMode] };
  }

  render() {
    const { activeMode, shellInsetTransition } = this.props;

    return (
      <main className="absolute inset-0 min-w-0">
        {this.state.mountedModes.map((slug) => {
          const mode = getMode(slug);
          if (!mode) return null;

          return (
            <PersistentModeLayer
              key={slug}
              slug={slug}
              active={slug === activeMode}
              shellInsetTransition={shellInsetTransition}
            />
          );
        })}
      </main>
    );
  }
}

function PersistentModeLayer({
  slug,
  active,
  shellInsetTransition,
}: {
  slug: string;
  active: boolean;
  shellInsetTransition: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mode = getMode(slug);

  useEffect(() => {
    if (active) return;
    rootRef.current
      ?.querySelectorAll<HTMLMediaElement>("video, audio")
      .forEach((media) => media.pause());
  }, [active]);

  if (!mode) return null;
  const Editor = mode.Editor;
  const isCanvas = slug === "canvas";

  return (
    <div
      ref={rootRef}
      aria-hidden={!active}
      inert={!active}
      className={cn(
        "absolute inset-0 min-w-0",
        !isCanvas && "pt-14",
        active ? "z-0 opacity-100" : "-z-10 pointer-events-none opacity-0"
      )}
      style={
        isCanvas
          ? undefined
          : {
              paddingLeft: "var(--project-shell-left-inset, 64px)",
              transition: `padding-left ${shellInsetTransition}`,
            }
      }
    >
      <Editor />
    </div>
  );
}

function ModeTabs({ projectId, activeMode }: { projectId: string; activeMode: string }) {
  const t = useTranslations("project");
  const { activeSection } = useProjectSections();
  return (
    <div className="pointer-events-auto mx-auto flex items-center gap-0.5 rounded-full bg-white/[0.06] p-1">
      {MODE_ORDER.map((slug) => {
        const mode = getMode(slug);
        if (!mode || !activeSection) return null;
        const active = slug === activeMode;
        const Icon = mode.Icon;
        return (
          <Link
            key={slug}
            href={`/project/${projectId}/${slug}?section=${encodeURIComponent(activeSection.id)}`}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
              active
                ? "bg-white text-black"
                : "text-white/70 hover:bg-white/[0.08] hover:text-white"
            )}
          >
            <Icon className="size-3.5" stroke={1.8} />
            {t(mode.labelKey)}
          </Link>
        );
      })}
    </div>
  );
}

function SectionAgentPanel({
  projectId,
  activeMode,
  open,
  onClose,
}: {
  projectId: string;
  activeMode: string;
  open: boolean;
  onClose: () => void;
}) {
  const { canEdit } = useProjectContext();
  const { activeSection } = useProjectSections();
  const handoff = useProjectPromptHandoff();
  const workbenchMode = agentOsWorkbenchModeFromStudioMode(activeMode);
  const isSectionMode = workbenchMode === "canvas" || workbenchMode === "storyboard";
  if (isSectionMode && !activeSection) return null;
  return (
    <AgentOsPanel
      canWrite={canEdit}
      composerPrefill={handoff.request}
      onComposerPrefillConsumed={handoff.consume}
      className="p-0"
      projectId={projectId}
      projectKind="platform"
      workbenchMode={workbenchMode}
      workbenchContext={
        isSectionMode && activeSection ? { sectionId: activeSection.id } : undefined
      }
      open={open}
      onClose={onClose}
    />
  );
}

function AgentToggle({ className, size = 60 }: { className?: string; size?: number }) {
  const tAgentOs = useTranslations("agentOs");
  const copilotOpen = useProjectUIStore((s) => s.copilotOpen);
  const toggleCopilot = useProjectUIStore((s) => s.toggleCopilot);
  const closeHistory = useProjectUIStore((s) => s.closeHistory);

  return (
    <FizzAgentOrbButton
      active={copilotOpen}
      size={size}
      hoverMessages={
        size >= 48
          ? [
              tAgentOs("launcherPrompts.create"),
              tAgentOs("launcherPrompts.ask"),
              tAgentOs("launcherPrompts.help"),
            ]
          : undefined
      }
      aria-label={tAgentOs(copilotOpen ? "close" : "open")}
      title={tAgentOs(copilotOpen ? "close" : "open")}
      onClick={() => {
        closeHistory();
        toggleCopilot();
      }}
      className={className}
    />
  );
}

function HeaderActions() {
  const { awareness, doc } = useCanvasConnection();

  return (
    <>
      <CollabAvatars awareness={awareness} localClientId={doc?.clientID} />
      <CreditsBadge className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-xs font-medium tabular-nums" />
    </>
  );
}

function ProjectPanelContent({
  activeMode,
  canEdit,
  projectId,
  onNameCommitted,
}: {
  activeMode: string;
  canEdit: boolean;
  projectId: string;
  onNameCommitted: (name: string) => void;
}) {
  const { activeSection } = useProjectSections();
  const sbRouter = useRouter();
  const onOpenOnCanvas = useCallback(
    (nodeId: string) =>
      activeSection &&
      sbRouter.push(
        `/project/${projectId}/canvas?section=${encodeURIComponent(activeSection.id)}&focus=${encodeURIComponent(nodeId)}`
      ),
    [sbRouter, projectId, activeSection]
  );
  return (
    <WorkbenchPanelContent
      activeMode={activeMode}
      canEdit={canEdit}
      crewProjectId={projectId}
      sectionsPanel={<ProjectSectionsPanel />}
      overviewPanel={<ProjectOverviewPanel onNameCommitted={onNameCommitted} />}
      onOpenOnCanvas={onOpenOnCanvas}
    />
  );
}
