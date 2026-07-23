"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { IconHistory, IconLoader2, IconSparkles, IconUsers } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { CreditsBadge } from "@/app/_components/credits-badge";
import { useAuth } from "@/app/_components/auth-provider";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import { CanvasEmptyState } from "@/app/[locale]/canvas/_components/canvas-empty-state";
import { MediaAuthoringCanvas } from "@/components/canvas/authoring/media-authoring-canvas";
import type { CanvasGroupingController } from "@/components/canvas/groups/canvas-grouping";
import { CanvasGraphProvider } from "@/lib/canvas-core/canvas-graph-context";
import type { AuthUser } from "@/lib/auth";
import { useCanvasDoc, type CanvasUser } from "@/lib/collab/use-canvas-doc";
import { useCanvasDocument } from "@/lib/collab/use-canvas-document";
import { useCanvasGraph } from "@/lib/collab/use-canvas-graph";
import { CanvasGenerationProvider } from "@/lib/canvas-authoring/use-canvas-generation";
import { useAiCatalog } from "@/lib/canvas-authoring/use-ai-catalog";
import { cn } from "@/lib/utils";
import { CommentsLayer, CommentsProvider } from "./canvas-comments";
import { CanvasHistory } from "./canvas-history";
import { CollabAvatars, CollabCursors } from "./collab-presence";
import { ConnectionSignal } from "./connection-signal";
import { CopilotPanel } from "./copilot/copilot-panel";
import { useApplyPreset } from "@/app/[locale]/canvas/_lib/use-apply-preset";
import { createWorkflowPresets } from "@/app/[locale]/canvas/_lib/workflow-presets";

const CREATIVE_UPLOAD_KINDS = ["image"] as const;

function toCanvasUser(user: AuthUser | null, guestName: string): CanvasUser | null {
  if (!user) return null;
  const id = String(user.id ?? "anon");
  return {
    id,
    name: user.nickName?.trim() || guestName,
    color: cursorColor(id),
    avatarUrl: user.avatar,
  };
}

function cursorColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return `hsl(${hash % 360} 70% 60%)`;
}

function CollaborativeCanvasInner({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const t = useTranslations("canvas");
  const tCopilot = useTranslations("copilot");
  const tProject = useTranslations("project");
  const tCanvasControls = useTranslations("canvasControls");
  const { canManage, openShare, setCanvasChromeInset } = useProjectContext();
  const { data: catalog } = useAiCatalog();
  const { user } = useAuth();
  const canvasUser = useMemo(() => toCanvasUser(user, t("guest")), [t, user]);
  const { documentId, status: documentStatus } = useCanvasDocument(projectId);
  const {
    doc,
    awareness,
    provider,
    status: connectionStatus,
    rtt,
  } = useCanvasDoc(documentId, canvasUser);
  const graph = useCanvasGraph(doc, awareness, canEdit);
  const grouping = useMemo<CanvasGroupingController>(
    () => ({
      groups: graph.groups,
      toggleGroup: graph.toggleGroup,
      addNodesToGroup: graph.addNodesToGroup,
      removeNodesFromGroups: graph.removeNodesFromGroups,
      setGroupColor: graph.setGroupColor,
      isNodeGroupable: graph.isNodePersisted,
    }),
    [
      graph.addNodesToGroup,
      graph.groups,
      graph.isNodePersisted,
      graph.removeNodesFromGroups,
      graph.setGroupColor,
      graph.toggleGroup,
    ]
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const lastCursorAt = useRef(0);
  const applyPreset = useApplyPreset(graph);
  const workflowPresets = useMemo(() => createWorkflowPresets(tCanvasControls), [tCanvasControls]);

  const publishCursor = useCallback(
    (position: { x: number; y: number }) => {
      if (!awareness) return;
      const now = Date.now();
      if (now - lastCursorAt.current < 45) return;
      lastCursorAt.current = now;
      awareness.setLocalStateField("cursor", position);
    },
    [awareness]
  );
  const clearCursor = useCallback(() => {
    awareness?.setLocalStateField("cursor", null);
  }, [awareness]);

  return (
    <CanvasGraphProvider value={graph}>
      <CommentsProvider documentId={documentId} provider={provider} currentUserId={canvasUser?.id}>
        <CanvasGenerationProvider
          catalog={catalog}
          context={{
            projectId,
            documentId: documentId ?? undefined,
            sourceSurface: "fizzstudio-canvas",
          }}
        >
          <MediaAuthoringCanvas
            canEdit={canEdit}
            ready={documentStatus === "ready" && connectionStatus === "synced"}
            scopeKey={documentId}
            uploadKinds={CREATIVE_UPLOAD_KINDS}
            grouping={grouping}
            onDrawerInsetChange={setCanvasChromeInset}
            onCanvasPointerMove={publishCursor}
            onCanvasPointerLeave={clearCursor}
            renderViewportLayers={(nodes) => (
              <>
                <CollabCursors awareness={awareness} localClientId={doc?.clientID} />
                <CommentsLayer nodes={nodes} />
              </>
            )}
            topChrome={
              <div
                className={cn(
                  "absolute top-4 z-20 flex items-center gap-2 transition-[right]",
                  copilotOpen || historyOpen ? "right-[396px]" : "right-4"
                )}
              >
                <button
                  type="button"
                  aria-label={tCopilot("open")}
                  onClick={() => {
                    setHistoryOpen(false);
                    setCopilotOpen((open) => !open);
                  }}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full shadow-md backdrop-blur-xl transition-colors",
                    copilotOpen
                      ? "bg-accent text-white"
                      : "bg-popover/90 text-white/80 hover:bg-accent hover:text-white"
                  )}
                >
                  <IconSparkles className="size-4" stroke={1.8} />
                </button>
                <span className="flex h-9 items-center rounded-full bg-popover/90 px-3.5 shadow-md backdrop-blur-xl">
                  <ConnectionSignal status={connectionStatus} rtt={rtt} />
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={t("activityLog")}
                    onClick={() => {
                      setCopilotOpen(false);
                      setHistoryOpen((open) => !open);
                    }}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full shadow-md backdrop-blur-xl transition-colors",
                      historyOpen
                        ? "bg-accent text-white"
                        : "bg-popover/90 text-white/80 hover:bg-accent hover:text-white"
                    )}
                  >
                    <IconHistory className="size-4" stroke={1.8} />
                  </button>
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    onClick={openShare}
                    aria-label={tProject("share")}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-popover/90 px-3.5 text-sm font-medium text-white/80 shadow-md backdrop-blur-xl transition-colors hover:bg-accent hover:text-white"
                  >
                    <IconUsers className="size-4" stroke={1.8} />
                    {tProject("share")}
                  </button>
                ) : null}
                <CollabAvatars awareness={awareness} localClientId={doc?.clientID} />
                <CreditsBadge className="flex h-9 items-center gap-1.5 rounded-full bg-popover/90 px-3.5 text-sm font-medium tabular-nums shadow-md backdrop-blur-xl" />
              </div>
            }
            panels={
              <>
                <CopilotPanel
                  projectId={projectId}
                  open={copilotOpen}
                  onClose={() => setCopilotOpen(false)}
                />
                {historyOpen ? (
                  <CanvasHistory
                    documentId={documentId}
                    provider={provider}
                    onClose={() => setHistoryOpen(false)}
                  />
                ) : null}
              </>
            }
            loadingOverlay={
              documentStatus === "loading" ? (
                <div className="absolute inset-0 z-50 grid place-items-center bg-[#0a0a0a]">
                  <IconLoader2 className="size-7 animate-spin text-white/40" stroke={1.5} />
                </div>
              ) : null
            }
            renderErrorOverlay={() =>
              documentStatus === "error" ? (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-sm">
                  <p className="text-sm text-muted-foreground">{t("openError")}</p>
                </div>
              ) : null
            }
            renderEmptyState={({ openAddMenu }) =>
              documentStatus !== "error" ? (
                canEdit ? (
                  <CanvasEmptyState
                    presets={workflowPresets}
                    catalogReady={Boolean(catalog && catalog.models.length > 0)}
                    onAddNode={openAddMenu}
                    onApplyPreset={applyPreset}
                  />
                ) : (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <p className="text-sm text-muted-foreground">{t("emptyReadOnly")}</p>
                  </div>
                )
              ) : null
            }
          />
        </CanvasGenerationProvider>
      </CommentsProvider>
    </CanvasGraphProvider>
  );
}

export function CollaborativeCanvasView({
  projectId,
  canEdit = true,
}: {
  projectId: string;
  canEdit?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <CollaborativeCanvasInner projectId={projectId} canEdit={canEdit} />
    </ReactFlowProvider>
  );
}
