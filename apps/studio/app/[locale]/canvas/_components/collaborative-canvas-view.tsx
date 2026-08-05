"use client";

import { useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/_components/auth-provider";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import { useCanvasConnection } from "@/app/[locale]/project/_components/canvas-connection-context";
import { CanvasEmptyState } from "@/app/[locale]/canvas/_components/canvas-empty-state";
import { MediaAuthoringCanvas } from "@/components/canvas/authoring/media-authoring-canvas";
import type { CanvasGroupingController } from "@/components/canvas/groups/canvas-grouping";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import type { CanvasGraph } from "@/lib/collab/use-canvas-graph";
import { useAiCatalog } from "@/lib/canvas-authoring/use-ai-catalog";
import { CommentsLayer, CommentsProvider } from "./canvas-comments";
import { CollabCursors } from "./collab-presence";
import { useApplyPreset } from "@/app/[locale]/canvas/_lib/use-apply-preset";
import { createWorkflowPresets } from "@/app/[locale]/canvas/_lib/workflow-presets";

const CREATIVE_UPLOAD_KINDS = ["image", "video"] as const;
/** Creative Studio adds the shot — the node its storyboard mode projects. */
const CREATIVE_ADD_NODE_ACTIONS = [
  "upload",
  "generate-image",
  "generate-video",
  "note",
  "shot",
] as const;

function CollaborativeCanvasInner({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const t = useTranslations("canvas");
  const tCanvasControls = useTranslations("canvasControls");
  const { setShellInset } = useProjectContext();
  const { data: catalog } = useAiCatalog();
  // The canvas doc connection is owned by the shell (single connection for the
  // whole workspace). Read doc/awareness/provider from there — do NOT call
  // useCanvasDocument/useCanvasDoc here (that would open a second connection).
  const { documentId, documentStatus, doc, awareness, provider, connectionStatus } = useCanvasConnection();
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
    <CommentsProvider documentId={documentId} provider={provider} currentUserId={user?.id != null ? String(user.id) : undefined}>
      <MediaAuthoringCanvas
        canEdit={canEdit}
        ready={documentStatus === "ready" && connectionStatus === "synced"}
        scopeKey={documentId}
        uploadKinds={CREATIVE_UPLOAD_KINDS}
        addNodeActions={CREATIVE_ADD_NODE_ACTIONS}
        initialFocusNodeId={focusNodeId}
        assetLibrary={{ crewProjectId: projectId }}
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
    </CommentsProvider>
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
