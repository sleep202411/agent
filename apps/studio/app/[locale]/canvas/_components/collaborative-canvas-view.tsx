"use client";

import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import { CrewSaveActions } from "@/components/canvas/authoring/crew-save-actions";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/_components/auth-provider";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import { useCanvasConnection } from "@/app/[locale]/project/_components/canvas-connection-context";
import { CanvasEmptyState } from "@/app/[locale]/canvas/_components/canvas-empty-state";
import { PROJECT_CANVAS_ADD_NODE_ACTIONS } from "@/components/canvas/add-node-menu";
import { MediaAuthoringCanvas } from "@/components/canvas/authoring/media-authoring-canvas";
import type { CanvasGroupingController } from "@/components/canvas/groups/canvas-grouping";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import type { CanvasGraph } from "@/lib/collab/use-canvas-graph";
import { CommentsLayer, CommentsProvider } from "./canvas-comments";
import { CollabCursors } from "./collab-presence";
import { useApplyPreset } from "@/app/[locale]/canvas/_lib/use-apply-preset";
import { createWorkflowPresets } from "@/app/[locale]/canvas/_lib/workflow-presets";

function CollaborativeCanvasInner({
  canEdit,
  toolbarActions,
}: {
  canEdit: boolean;
  toolbarActions?: ReactNode;
}) {
  const t = useTranslations("canvas");
  const tCanvasControls = useTranslations("canvasControls");
  const { projectId, setShellInset, uploadKinds, catalog } = useProjectContext();
  // The canvas doc connection is owned by the shell (single connection for the
  // whole workspace). Read doc/awareness/provider from there — do NOT call
  // another document hook here (that would open a second connection).
  const { documentId, documentStatus, doc, awareness, provider, connectionStatus } =
    useCanvasConnection();
  const { user } = useAuth();
  // Handed over from another mode ("show me this shot on the board").
  const focusNodeId = useSearchParams().get("focus");
  // The graph is owned by the shell (one per document) — read it from context.
  // The shell's useCanvasGraph returns a full CanvasGraph (extends Store); the
  // context is typed as the base Store, so cast to CanvasGraph for grouping etc.
  const graph = useCanvasGraphContext() as CanvasGraph;
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
  const actorFocus = useProjectUIStore((s) => s.actorFocus);
  const clearActorFocus = useProjectUIStore((s) => s.clearActorFocus);
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!actorFocus || actorFocus.documentId !== documentId) return;
    const node = graph.nodes.find((n) => n.id === actorFocus.nodeId);
    if (!node?.measured?.width || !node.measured.height) return;
    void fitView({ nodes: [{ id: node.id }], padding: 0.6, maxZoom: 1, duration: 320 });
    clearActorFocus(node.id);
  }, [actorFocus, documentId, graph.nodes, fitView, clearActorFocus]);
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

  // Stable: the canvas reports its drawer inset from an effect keyed on this
  // callback, so an inline arrow would re-fire it on every render.
  const reportDrawerInset = useCallback((left: number) => setShellInset({ left }), [setShellInset]);

  return (
    <CommentsProvider
      documentId={documentId}
      provider={provider}
      currentUserId={user?.id != null ? String(user.id) : undefined}
    >
      <CrewSaveActions
        key={`${user?.id}:${projectId}:${documentId}`}
        userId={String(user?.id ?? "")}
        projectId={projectId}
        documentId={documentId}
        canEdit={canEdit}
      >
        <MediaAuthoringCanvas
          toolbarActions={toolbarActions}
          canEdit={canEdit}
          ready={documentStatus === "ready" && connectionStatus === "synced"}
          documentId={documentId}
          scopeKey={documentId}
          uploadKinds={uploadKinds}
          addNodeActions={PROJECT_CANVAS_ADD_NODE_ACTIONS}
          initialFocusNodeId={focusNodeId}
          grouping={grouping}
          onDrawerInsetChange={reportDrawerInset}
          onCanvasPointerMove={publishCursor}
          onCanvasPointerLeave={clearCursor}
          renderViewportLayers={(nodes) => (
            <>
              <CollabCursors awareness={awareness} localClientId={doc?.clientID} />
              <CommentsLayer nodes={nodes} />
            </>
          )}
          panels={null}
          loadingOverlay={
            documentStatus === "loading" ? (
              <div className="absolute inset-0 z-50 grid place-items-center">
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
                  catalogReady={Boolean(catalog.data && catalog.data.models.length > 0)}
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
      </CrewSaveActions>
    </CommentsProvider>
  );
}

export function CollaborativeCanvasView({
  projectId,
  toolbarActions,
  canEdit = true,
}: {
  projectId: string;
  canEdit?: boolean;
  toolbarActions?: ReactNode;
}) {
  return (
    <ReactFlowProvider>
      <CollaborativeCanvasInner key={projectId} canEdit={canEdit} toolbarActions={toolbarActions} />
    </ReactFlowProvider>
  );
}
