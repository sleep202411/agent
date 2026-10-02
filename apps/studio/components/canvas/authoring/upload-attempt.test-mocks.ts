import { vi } from "vitest";
export const uploadFileViaSignedUrl = vi.fn();
export const isUploadAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";
export const useOptionalProjectContext = () => null;
export const useProjectUIStore = <T>(
  fn: (state: { assetsOpen: boolean; nodeInsertRequest: null }) => T
) => fn({ assetsOpen: false, nodeInsertRequest: null });
export const useReactFlow = () => ({
  screenToFlowPosition: (p: { x: number; y: number }) => p,
  getNodes: () => [],
  fitView: () => {},
  setCenter: () => {},
});
export const useTranslations = () => (s: string) => s;
export const toast = { error: vi.fn() };
export const useAiCatalog = () => ({ data: null });
export const useCanvasTidy = () => () => {};
export const useCanvasHistoryShortcuts = () => {};
export const useCanvasAuthoringShortcuts = () => {};
export const DEFAULT_ADD_NODE_ACTIONS = [];
export const ASSET_LIBRARY_WIDTH = 300,
  ASSET_DRAG_MIME = "application/x-fizz-asset";
export const SHOT_NODE_TYPE = "shot",
  SHOT_NODE_ESTIMATED_HEIGHT = 100;
export const canvasNodeLayoutSize = () => ({ width: 100, height: 100 });
export const handleColor = () => "";
export const canvasDefaultMode = () => null,
  canvasDefaultModel = () => null,
  defaultSettingsForModel = () => ({});
export const bindEdgeReference = () => {},
  routeTargetReferenceField = () => null,
  sourceMediaUrl = () => null,
  sourceOutputKind = () => null,
  stripEdgeRef = () => {},
  validateCanvasConnection = () => null,
  nextShotOrder = () => "";
export const generationNodeTypeForModality = () => "",
  isGenerationNodeType = () => false;
