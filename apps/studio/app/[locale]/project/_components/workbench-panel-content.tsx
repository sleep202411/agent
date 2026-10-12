"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AddNodeAction } from "@/components/canvas/add-node-menu";
import {
  PROJECT_CANVAS_ADD_NODE_ACTIONS,
  STORYBOARD_ADD_NODE_ACTIONS,
} from "@/components/canvas/add-node-menu";
import { AssetLibrary } from "@/components/canvas/authoring/asset-library";
import { DirectorDeskDialog } from "@/components/canvas/authoring/director-desk-dialog";
import { useDirectorDeskImport } from "@/components/canvas/authoring/use-director-desk-import";
import { useProjectContext } from "./project-context";
import { ProjectCrewAssetsPanel } from "@/components/canvas/authoring/project-crew-asset-library";
import { AiActorsPanel } from "@/components/canvas/authoring/ai-actors-panel";
import { NodesPanel } from "@/components/canvas/nodes-panel";
import { CanvasHistory } from "@/app/[locale]/canvas/_components/canvas-history";
import { ProjectSkillsPanel } from "./project-skills-panel";
import { useCanvasConnection } from "./canvas-connection-context";
import { useProjectUIStore } from "../_stores/project-ui-store";
import { useStoryboard } from "../_modes/storyboard/use-storyboard";
import {
  ShotPictureDrawer,
  type ShotPictureDrawerActions,
} from "../_modes/storyboard/shot-picture-drawer";
import { ShotVideoDrawer } from "../_modes/storyboard/shot-video-drawer";

export interface WorkbenchAssetTab {
  id: string;
  label: string;
  render: () => ReactNode;
}

/**
 * Shared left-panel projection for every StudioDocument workbench owner.
 *
 * Platform and Story differ only in explicit capabilities passed here:
 * Platform may expose crew assets and sections; Story may expose its curated
 * candidate tab. Nodes, assets, history, shot drawers and all graph mutations
 * remain one implementation.
 */
export function WorkbenchPanelContent({
  activeMode,
  canEdit,
  crewProjectId,
  assetTab,
  sectionsPanel,
  overviewPanel,
  onOpenOnCanvas,
}: {
  activeMode: string;
  canEdit: boolean;
  crewProjectId?: string;
  assetTab?: WorkbenchAssetTab;
  sectionsPanel?: ReactNode;
  /** Platform projects only — the metadata/cover panel; Story keeps its own. */
  overviewPanel?: ReactNode;
  onOpenOnCanvas: (nodeId: string) => void;
}) {
  const nodesOpen = useProjectUIStore((s) => s.nodesOpen);
  const assetsOpen = useProjectUIStore((s) => s.assetsOpen);
  const actorsOpen = useProjectUIStore((s) => s.actorsOpen);
  const closeActors = useProjectUIStore((s) => s.closeActors);
  const crewAssetsOpen = useProjectUIStore((s) => s.crewAssetsOpen);
  const historyOpen = useProjectUIStore((s) => s.historyOpen);
  const overviewOpen = useProjectUIStore((s) => s.overviewOpen);
  const sectionsOpen = useProjectUIStore((s) => s.sectionsOpen);
  const skillsOpen = useProjectUIStore((s) => s.skillsOpen);
  const closeNodes = useProjectUIStore((s) => s.closeNodes);
  const requestNodeInsert = useProjectUIStore((s) => s.requestNodeInsert);
  const closeAssets = useProjectUIStore((s) => s.closeAssets);
  const closeCrewAssets = useProjectUIStore((s) => s.closeCrewAssets);
  const closeHistory = useProjectUIStore((s) => s.closeHistory);
  const selectedShotId = useProjectUIStore((s) => s.selectedShotId);
  const selectedSlot = useProjectUIStore((s) => s.selectedSlot);
  const closeShotDrawer = useProjectUIStore((s) => s.closeShotDrawer);
  const { documentId, provider } = useCanvasConnection();
  const { projectId, workspaceId } = useProjectContext();
  const directorDesk = useDirectorDeskImport({ workspaceId, projectId, canEdit });
  const storyboard = useStoryboard();

  const drawerActions = useMemo<ShotPictureDrawerActions>(
    () => ({
      // Forward the drawer form seed (prompt / model / settings). Dropping it
      // created blank generation cards and the "Write a prompt first" toast
      // even when the sidebar prompt field was filled.
      onGenerate: storyboard.createPictureSource,
      onUpload: storyboard.uploadPictureSource,
      onAttach: storyboard.attachSource,
      onDetach: storyboard.detachPicture,
      onSetPreferredFrame: storyboard.setPreferredFrame,
      onOpenOnCanvas,
    }),
    [onOpenOnCanvas, storyboard]
  );
  const selectedRow = useMemo(
    () => storyboard.rows.find((row) => row.id === selectedShotId) ?? null,
    [selectedShotId, storyboard.rows]
  );
  const activePanel =
    actorsOpen && crewProjectId && activeMode === "canvas"
      ? "actors"
      : overviewOpen && overviewPanel
        ? "overview"
        : nodesOpen && canEdit
          ? "nodes"
          : assetsOpen
            ? "assets"
            : crewAssetsOpen && crewProjectId
              ? "crew-assets"
              : historyOpen
                ? "activity"
                : sectionsOpen && sectionsPanel
                  ? "sections"
                  : skillsOpen
                    ? "skills"
                    : selectedShotId && selectedRow
                      ? "shot"
                      : null;

  // Keep the previous body mounted during the rail's close animation.
  const [lastPanel, setLastPanel] = useState(activePanel);
  const [lastSelectedRow, setLastSelectedRow] = useState(selectedRow);
  useEffect(() => {
    if (activePanel) setLastPanel(activePanel);
  }, [activePanel]);
  useEffect(() => {
    if (selectedRow) setLastSelectedRow(selectedRow);
  }, [selectedRow]);

  const renderedPanel = activePanel ?? lastPanel;
  const renderedRow = selectedRow ?? lastSelectedRow;
  const nodeActions =
    activeMode === "storyboard" ? STORYBOARD_ADD_NODE_ACTIONS : PROJECT_CANVAS_ADD_NODE_ACTIONS;
  const handleNodeAction = useCallback(
    (action: AddNodeAction) => {
      if (action === "director-desk") {
        directorDesk.open();
        closeNodes();
        return;
      }
      if (activeMode === "storyboard") {
        if (action === "shot") storyboard.insertShot(storyboard.rows.length);
        closeNodes();
        return;
      }
      requestNodeInsert(action);
    },
    [activeMode, closeNodes, directorDesk.open, requestNodeInsert, storyboard]
  );

  const panel =
    renderedPanel === "actors" ? (
      activePanel === "actors" && documentId ? (
        <AiActorsPanel key={documentId} documentId={documentId} onClose={closeActors} />
      ) : null
    ) : renderedPanel === "overview" && overviewPanel ? (
      overviewPanel
    ) : renderedPanel === "nodes" && canEdit ? (
      <NodesPanel actions={nodeActions} onAction={handleNodeAction} onClose={closeNodes} />
    ) : renderedPanel === "assets" ? (
      <AssetLibrary
        open
        onClose={closeAssets}
        customTab={assetTab}
        onOpenDirectorDesk={canEdit ? directorDesk.open : undefined}
      />
    ) : renderedPanel === "crew-assets" && crewProjectId ? (
      <ProjectCrewAssetsPanel projectId={crewProjectId} onClose={closeCrewAssets} />
    ) : renderedPanel === "activity" ? (
      <CanvasHistory documentId={documentId} provider={provider} onClose={closeHistory} />
    ) : renderedPanel === "sections" ? (
      (sectionsPanel ?? null)
    ) : renderedPanel === "skills" ? (
      <ProjectSkillsPanel />
    ) : renderedPanel === "shot" && renderedRow ? (
      selectedSlot === "video" ? (
        <ShotVideoDrawer
          row={renderedRow}
          canEdit={canEdit}
          actions={drawerActions}
          onClose={closeShotDrawer}
        />
      ) : (
        <ShotPictureDrawer
          row={renderedRow}
          slot={selectedSlot}
          canEdit={canEdit}
          actions={drawerActions}
          onClose={closeShotDrawer}
        />
      )
    ) : null;

  return (
    <>
      {panel}
      <DirectorDeskDialog
        open={directorDesk.isOpen}
        projectId={projectId}
        busy={directorDesk.busy}
        onCapture={directorDesk.capture}
        onOpenChange={directorDesk.setOpen}
      />
    </>
  );
}
