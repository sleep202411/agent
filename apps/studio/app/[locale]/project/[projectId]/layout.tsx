"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { IconEye, IconHistory, IconSparkles, IconUsers } from "@tabler/icons-react";
import { agentOsWorkbenchModeFromStudioMode } from "@repo/shared";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ProjectProvider } from "@/app/[locale]/project/_components/project-context";
import {
  CanvasConnectionProvider,
  useCanvasConnection,
} from "@/app/[locale]/project/_components/canvas-connection-context";
import { ProjectSidebar } from "@/app/[locale]/project/_components/project-sidebar";
import { AssetLibrary } from "@/components/canvas/authoring/asset-library";
import { DrawerPanel } from "@/components/ui/drawer-panel";
import { CreditsBadge } from "@/app/_components/credits-badge";
import { CollabAvatars } from "@/app/[locale]/canvas/_components/collab-presence";
import { ConnectionSignal } from "@/app/[locale]/canvas/_components/connection-signal";
import { AgentOsPanel } from "@/components/agent-os/agent-os-panel";
import { CanvasHistory } from "@/app/[locale]/canvas/_components/canvas-history";
import { ShareDialog } from "@/app/_components/share-dialog";
import { MODE_ORDER, getMode } from "@/app/[locale]/project/_modes/registry";
import { getProject, renameProject, type ProjectRole } from "@/lib/collab/projects-api";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import { useStoryboard } from "@/app/[locale]/project/_modes/storyboard/use-storyboard";
import {
  ShotPictureDrawer,
  type ShotPictureDrawerActions,
} from "@/app/[locale]/project/_modes/storyboard/shot-picture-drawer";
import { ShotVideoDrawer } from "@/app/[locale]/project/_modes/storyboard/shot-video-drawer";

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const t = useTranslations("project");
  const routeParams = useParams();
  const activeMode = typeof routeParams.mode === "string" ? routeParams.mode : "canvas";

  const [name, setName] = useState("");
  const [role, setRole] = useState<ProjectRole | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const setShellInset = useCallback(() => {}, []);

  const copilotOpen = useProjectUIStore((s) => s.copilotOpen);
  const closeCopilot = useProjectUIStore((s) => s.closeCopilot);
  const historyOpen = useProjectUIStore((s) => s.historyOpen);
  const closeHistory = useProjectUIStore((s) => s.closeHistory);

  const dirtyRef = useRef(false);
  const committedRef = useRef("");
  useEffect(() => {
    let cancelled = false;
    getProject(projectId)
      .then((project) => {
        if (cancelled) return;
        setRole(project.role ?? null);
        if (dirtyRef.current) return;
        committedRef.current = project.name;
        setName(project.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const canEdit = role == null ? true : role !== "viewer";
  const canManage = role === "owner" || role === "admin";
  const openShare = useCallback(() => setShareOpen(true), []);

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

  return (
    <ProjectProvider
      projectId={projectId}
      role={role}
      openShare={openShare}
      setShellInset={setShellInset}
    >
      <CanvasConnectionProvider projectId={projectId} canEdit={canEdit}>
        <div className="flex h-dvh">
          <ProjectSidebar />

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 px-4">
              <input
                value={name}
                aria-label={t("projectName")}
                placeholder={t("untitled")}
                readOnly={!canEdit}
                onChange={(event) => {
                  if (!canEdit) return;
                  dirtyRef.current = true;
                  setName(event.target.value);
                }}
                onBlur={(event) => commitName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="field-sizing-content h-8 min-w-[80px] max-w-[240px] rounded-full px-3 text-sm font-medium outline-none transition-colors read-only:cursor-default hover:bg-white/[0.06] focus:bg-white/[0.06]"
              />

              <div className="mx-auto flex items-center gap-0.5 rounded-full bg-white/[0.06] p-1">
                {MODE_ORDER.map((slug) => {
                  const mode = getMode(slug);
                  if (!mode) return null;
                  const active = slug === activeMode;
                  const Icon = mode.Icon;
                  return (
                    <Link
                      key={slug}
                      href={`/project/${projectId}/${slug}`}
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

              <div className="ml-auto flex items-center gap-2">
                {role === "viewer" && (
                  <span className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-xs font-medium text-white/70">
                    <IconEye className="size-4" stroke={1.8} />
                    {t("viewOnly")}
                  </span>
                )}
                <HeaderActions canEdit={canEdit} />
                {canManage && (
                  <button
                    type="button"
                    onClick={openShare}
                    className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-xs font-medium transition-colors hover:bg-white/[0.1]"
                  >
                    <IconUsers className="size-4" stroke={1.8} />
                    {t("share")}
                  </button>
                )}
              </div>
            </header>

            <div className="flex min-h-0 flex-1">
              <LeftDrawerSlot canEdit={canEdit} projectId={projectId} />
              <main className="relative min-w-0 flex-1">{children}</main>
            </div>
          </div>

          <AgentOsPanel
            projectId={projectId}
            workbenchMode={agentOsWorkbenchModeFromStudioMode(activeMode)}
            open={copilotOpen}
            onClose={closeCopilot}
          />
        </div>

        {historyOpen ? <HistoryOverlay onClose={closeHistory} /> : null}
      </CanvasConnectionProvider>

      {canManage && (
        <ShareDialog
          scope={{ kind: "project", id: projectId, name: name || t("thisProject") }}
          canManage={canManage}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </ProjectProvider>
  );
}

function HeaderActions({ canEdit }: { canEdit: boolean }) {
  const tAgentOs = useTranslations("agentOs");
  const tCanvas = useTranslations("canvas");
  const { connectionStatus, rtt, awareness, doc } = useCanvasConnection();
  const copilotOpen = useProjectUIStore((s) => s.copilotOpen);
  const toggleCopilot = useProjectUIStore((s) => s.toggleCopilot);
  const closeCopilot = useProjectUIStore((s) => s.closeCopilot);
  const historyOpen = useProjectUIStore((s) => s.historyOpen);
  const toggleHistory = useProjectUIStore((s) => s.toggleHistory);
  const closeHistory = useProjectUIStore((s) => s.closeHistory);

  return (
    <>
      <button
        type="button"
        aria-label={tAgentOs("open")}
        onClick={() => {
          closeHistory();
          toggleCopilot();
        }}
        className={cn(
          "flex size-8 items-center justify-center rounded-full transition-colors",
          copilotOpen
            ? "bg-white text-black"
            : "text-white/70 hover:bg-white/[0.08] hover:text-white"
        )}
      >
        <IconSparkles className="size-4" stroke={1.8} />
      </button>
      <span className="flex h-8 items-center rounded-full bg-white/[0.06] px-3">
        <ConnectionSignal status={connectionStatus} rtt={rtt} />
      </span>
      {canEdit ? (
        <button
          type="button"
          aria-label={tCanvas("activityLog")}
          onClick={() => {
            closeCopilot();
            toggleHistory();
          }}
          className={cn(
            "flex size-8 items-center justify-center rounded-full transition-colors",
            historyOpen
              ? "bg-white text-black"
              : "text-white/70 hover:bg-white/[0.08] hover:text-white"
          )}
        >
          <IconHistory className="size-4" stroke={1.8} />
        </button>
      ) : null}
      <CollabAvatars awareness={awareness} localClientId={doc?.clientID} />
      <CreditsBadge className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-xs font-medium tabular-nums" />
    </>
  );
}

function HistoryOverlay({ onClose }: { onClose: () => void }) {
  const { documentId, provider } = useCanvasConnection();
  return <CanvasHistory documentId={documentId} provider={provider} onClose={onClose} />;
}

function LeftDrawerSlot({ canEdit, projectId }: { canEdit: boolean; projectId: string }) {
  const assetsOpen = useProjectUIStore((s) => s.assetsOpen);
  const closeAssets = useProjectUIStore((s) => s.closeAssets);
  const selectedShotId = useProjectUIStore((s) => s.selectedShotId);
  const selectedSlot = useProjectUIStore((s) => s.selectedSlot);
  const closeShotDrawer = useProjectUIStore((s) => s.closeShotDrawer);

  const sb = useStoryboard();
  const sbRouter = useRouter();
  const onOpenOnCanvas = useCallback(
    (nodeId: string) => sbRouter.push(`/project/${projectId}/canvas?focus=${nodeId}`),
    [sbRouter, projectId]
  );
  const drawerActions = useMemo<ShotPictureDrawerActions>(
    () => ({
      onGenerate: (shotId: string, modality: "image" | "video") =>
        sb.createPictureSource(shotId, modality),
      onUpload: sb.uploadPictureSource,
      onAttach: sb.attachSource,
      onDetach: sb.detachPicture,
      onSetPreferredFrame: sb.setPreferredFrame,
      onOpenOnCanvas,
    }),
    [sb, onOpenOnCanvas]
  );
  const selectedRow = useMemo(
    () => sb.rows.find((r) => r.id === selectedShotId) ?? null,
    [sb.rows, selectedShotId]
  );

  let content: React.ReactNode = null;
  if (assetsOpen) {
    content = <AssetLibrary open onClose={closeAssets} crewProjectId={projectId} />;
  } else if (selectedShotId && selectedRow) {
    content =
      selectedSlot === "video" ? (
        <ShotVideoDrawer
          row={selectedRow}
          canEdit={canEdit}
          actions={drawerActions}
          onClose={closeShotDrawer}
        />
      ) : (
        <ShotPictureDrawer
          row={selectedRow}
          slot={selectedSlot}
          canEdit={canEdit}
          actions={drawerActions}
          onClose={closeShotDrawer}
        />
      );
  }

  if (!content) return null;

  return (
    <aside className="h-full shrink-0">
      <DrawerPanel placement="inline" width={380}>
        {content}
      </DrawerPanel>
    </aside>
  );
}
