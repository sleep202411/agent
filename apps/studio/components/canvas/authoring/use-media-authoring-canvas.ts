"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalProjectContext } from "@/app/[locale]/project/_components/project-context";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import {
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type IsValidConnection,
  type Node,
  type OnConnectStart,
} from "@xyflow/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { CanvasGraphStore } from "@/lib/canvas-core/canvas-graph-context";
import type { CanvasAsset, CanvasNodeShape } from "@/lib/canvas-core/types";
import { canvasNodeLayoutSize } from "@/lib/canvas-core/node-geometry";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import { useCanvasTidy } from "@/components/canvas/use-canvas-tidy";
import { useCanvasHistoryShortcuts } from "@/components/canvas/canvas-history";
import { ASSET_LIBRARY_WIDTH } from "@/components/canvas/authoring/asset-library";
import { ASSET_DRAG_MIME } from "@/components/canvas/authoring/asset-library-dnd";
import { handleColor } from "@/components/canvas/authoring/port-colors";
import {
  createUploadStateStore,
  type UploadStateStore,
} from "@/components/canvas/authoring/upload-state-context";
import { useCanvasAuthoringShortcuts } from "@/components/canvas/authoring/use-canvas-authoring-shortcuts";
import {
  canvasDefaultMode,
  canvasDefaultModel,
  defaultSettingsForModel,
} from "@/lib/canvas-authoring/generation-api";
import { useAiCatalog } from "@/lib/canvas-authoring/use-ai-catalog";
import {
  bindEdgeReference,
  routeTargetReferenceField,
  sourceMediaUrl,
  sourceOutputKind,
  stripEdgeRef,
  validateCanvasConnection,
  type CanvasConnectionIssue,
} from "@/lib/canvas-authoring/canvas-wiring";
import {
  SHOT_NODE_ESTIMATED_HEIGHT,
  SHOT_NODE_TYPE,
  nextShotOrder,
} from "@/lib/canvas-authoring/shot-node";
import { DEFAULT_ADD_NODE_ACTIONS, type AddNodeAction } from "@/components/canvas/add-node-menu";
import type { CardReferences } from "@/components/canvas/authoring/reference-stack";
import {
  generationNodeTypeForModality,
  isGenerationNodeType,
  type GenerationModality,
} from "@/lib/canvas-authoring/generation-node-types";

export type UploadMediaKind = "image" | "video" | "audio";

export type CanvasAddMenuState = {
  left: number;
  top: number;
  flow: { x: number; y: number };
  pending?: PendingConnection;
  wire?: { x1: number; y1: number; x2: number; y2: number; color: string };
};

type PendingConnection = {
  nodeId: string;
  handleId: string | null;
  handleType: "source" | "target";
};

const GEN_ACCEPTS: Record<
  "generate-image" | "generate-video" | "generate-audio",
  readonly UploadMediaKind[]
> = {
  "generate-image": ["image"],
  "generate-video": ["image", "video", "audio"],
  "generate-audio": ["image", "audio"],
};

/** A shot takes pictures — a still for its frame, a clip for its motion. */
const SHOT_ACCEPTS: readonly UploadMediaKind[] = ["image", "video"];

/** Tidy reserves a shot's full frame height; the 200px default would overlap. */
function estimateCanvasNodeHeight(node: Node): number | undefined {
  return node.type === SHOT_NODE_TYPE ? SHOT_NODE_ESTIMATED_HEIGHT : undefined;
}

const UPLOAD_CONTENT_TYPES: Record<UploadMediaKind, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/quicktime"],
  audio: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"],
};

const UPLOAD_KIND_BY_EXTENSION: Record<string, UploadMediaKind> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  mp4: "video",
  mov: "video",
  mp3: "audio",
  wav: "audio",
};

/** Native file pickers (macOS Finder especially) ignore many audio MIME types
 *  unless the matching extensions are listed next to them. */
const UPLOAD_EXTENSIONS: Record<UploadMediaKind, readonly string[]> = {
  image: [".jpg", ".jpeg", ".png", ".webp"],
  video: [".mp4", ".mov"],
  audio: [".mp3", ".wav"],
};

export function canvasUploadMediaKind(
  file: Pick<File, "name" | "type">,
  accepted: ReadonlySet<UploadMediaKind>
): UploadMediaKind | null {
  const contentType = file.type.trim().toLowerCase();
  const kind =
    (Object.entries(UPLOAD_CONTENT_TYPES).find(([, types]) => types.includes(contentType))?.[0] as
      | UploadMediaKind
      | undefined) ??
    UPLOAD_KIND_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ??
    null;
  return kind && accepted.has(kind) ? kind : null;
}

function uploadKind(kind: UploadMediaKind): string {
  if (kind === "video") return "ai_reference_video";
  if (kind === "audio") return "ai_reference_audio";
  return "ai_reference_image";
}

function nodeTypeForMedia(kind: UploadMediaKind) {
  if (kind === "video") return "videoAsset";
  if (kind === "audio") return "audioAsset";
  return "image";
}

export function canvasAcceptedFileTypes(kinds: readonly UploadMediaKind[]): string {
  return kinds
    .flatMap((kind) => [...UPLOAD_CONTENT_TYPES[kind], ...UPLOAD_EXTENSIONS[kind]])
    .join(",");
}

export function isExternalCanvasDrag(types: ArrayLike<string>): boolean {
  const list = Array.from(types);
  return list.includes("Files") || list.includes(ASSET_DRAG_MIME);
}

/**
 * Shared media-authoring interaction controller.
 *
 * It owns typed wiring, node creation, uploads, drag/drop, history shortcuts,
 * reconnects and tidy behavior. The shared surface owns visual grouping and
 * chrome composition; product adapters own persistence, collaboration and
 * business-specific extensions.
 */
export function useMediaAuthoringCanvas({
  graph,
  canEdit,
  ready,
  workspaceId,
  scopeKey,
  uploadKinds,
  addNodeActions = DEFAULT_ADD_NODE_ACTIONS,
  initialFocusNodeId,
  fitEmptyCanvas = false,
  tidySelection = false,
}: {
  graph: CanvasGraphStore;
  canEdit: boolean;
  ready: boolean;
  workspaceId?: string;
  /** Cancels transient uploads when the owning canvas document changes. */
  scopeKey?: string | null;
  uploadKinds: readonly UploadMediaKind[];
  /** Creation actions this canvas offers (dock, add-menu, shortcuts). */
  addNodeActions?: readonly AddNodeAction[];
  /**
   * Node to select and frame instead of fitting the whole canvas on open —
   * how another mode hands a specific node over ("show me this shot").
   */
  initialFocusNodeId?: string | null;
  fitEmptyCanvas?: boolean;
  tidySelection?: boolean;
}) {
  const t = useTranslations("canvas");
  const { data: catalog } = useAiCatalog();
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    addNode: graphAddNode,
    addEdge: graphAddEdge,
    addNodesAndEdges: graphAddNodesAndEdges,
    patchNodeData,
    removeEdge: graphRemoveEdge,
    addLocalNode,
    promoteLocalNode,
    selectNodes,
    addAssets,
    canUndo,
    canRedo,
    undo,
    redo,
    getNode,
    // Aliased: React Flow's own `getNodes` (below) is the rendered store, this
    // one is the document — the order key of a new shot must come from the
    // document, or two shots created in the same frame collide.
    getNodes: getDocumentNodes,
    getEdges: getDocumentEdges,
  } = graph;
  const { screenToFlowPosition, fitView, getNodes, setCenter } = useReactFlow();
  const acceptedKinds = useMemo(() => new Set(uploadKinds), [uploadKinds]);
  const [addMenu, setAddMenu] = useState<CanvasAddMenuState | null>(null);
  // assetsOpen is shell-owned via Zustand when inside the project shell;
  // fall back to local state for canvases outside the shell.
  const projectCtx = useOptionalProjectContext();
  const storeAssetsOpen = useProjectUIStore((s) => s.assetsOpen);
  const storeCloseAssets = useProjectUIStore((s) => s.closeAssets);
  const storeOpenAssets = useProjectUIStore((s) => s.openAssets);
  const nodeInsertRequest = useProjectUIStore((s) => s.nodeInsertRequest);
  const clearNodeInsertRequest = useProjectUIStore((s) => s.clearNodeInsertRequest);
  const openDirectorDesk = useProjectUIStore((s) => s.openDirectorDesk);
  const [localAssetsOpen, setLocalAssetsOpen] = useState(false);
  const assetsOpen = projectCtx ? storeAssetsOpen : localAssetsOpen;
  const setAssetsOpen = projectCtx
    ? (open: boolean) => (open ? storeOpenAssets() : storeCloseAssets())
    : setLocalAssetsOpen;
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragDepth = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadFlowPos = useRef<{ x: number; y: number } | null>(null);
  const pendingUploadConnection = useRef<PendingConnection | null>(null);
  const pendingWires = useRef(new Map<string, () => void>());
  const handledNodeInsertRequest = useRef<number | null>(null);
  const reconnectDone = useRef(true);
  const reconnectIssue = useRef<CanvasConnectionIssue | null>(null);
  const lastConnectEndAt = useRef(0);
  const connectStartRef = useRef<{ x: number; y: number; color: string } | null>(null);
  const fittedRef = useRef(false);
  const uploadStore = useMemo<UploadStateStore>(() => createUploadStateStore(), []);

  useCanvasHistoryShortcuts({ enabled: canEdit, undo, redo });

  useEffect(() => {
    if (fittedRef.current || !ready) return;
    if (
      nodes.length > 0 &&
      nodes.some((node) => node.measured?.width == null || node.measured?.height == null)
    ) {
      return;
    }
    fittedRef.current = true;
    const timer = window.setTimeout(() => {
      const canvasNodes = getNodes();
      // One owner for the opening frame: a handed-over node wins over fit-all,
      // otherwise the two would animate against each other.
      const focused = initialFocusNodeId
        ? canvasNodes.find((node) => node.id === initialFocusNodeId)
        : undefined;
      if (focused) {
        selectNodes([focused.id]);
        void fitView({ nodes: [focused], padding: 0.6, maxZoom: 1, duration: 320 });
      } else if (canvasNodes.length > 0) {
        void fitView({ nodes: canvasNodes, padding: 0.4, duration: 280 });
      } else if (fitEmptyCanvas) {
        void setCenter(0, 0, { zoom: 0.76, duration: 280 });
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [fitEmptyCanvas, fitView, getNodes, initialFocusNodeId, nodes, ready, selectNodes, setCenter]);

  const outputKind = useCallback(
    (nodeId: string | null | undefined) => (nodeId ? sourceOutputKind(getNode, nodeId) : undefined),
    [getNode]
  );
  const outputUrl = useCallback(
    (nodeId: string | null | undefined) => (nodeId ? sourceMediaUrl(getNode, nodeId) : undefined),
    [getNode]
  );
  const validateConnection = useCallback(
    (source: string, target: string, excludeEdgeId?: string) =>
      validateCanvasConnection(
        { getNode, getEdges: getDocumentEdges, catalog },
        source,
        target,
        excludeEdgeId
      ),
    [catalog, getDocumentEdges, getNode]
  );
  const connectionIssueMessage = useCallback(
    (issue: CanvasConnectionIssue) => {
      const kind =
        "kind" in issue
          ? issue.kind === "image"
            ? t("connection.kind.image")
            : issue.kind === "video"
              ? t("connection.kind.video")
              : t("connection.kind.audio")
          : "";
      switch (issue.code) {
        case "source_missing":
          return t("connection.sourceMissing");
        case "target_missing":
          return t("connection.targetMissing");
        case "self_connection":
          return t("connection.selfConnection");
        case "source_not_connectable":
          return t("connection.sourceNotConnectable");
        case "target_not_connectable":
          return t("connection.targetNotConnectable");
        case "model_unavailable":
          return t("connection.modelUnavailable");
        case "current_mode_unsupported":
          return t("connection.currentModeUnsupported", { kind });
        case "unsupported_kind":
          return t("connection.unsupportedKind", { kind });
        case "reference_limit":
          return t("connection.referenceLimit", { kind, limit: issue.limit });
        case "duplicate_reference":
          return t("connection.duplicateReference", { kind });
      }
    },
    [t]
  );
  const showConnectionIssue = useCallback(
    (issue: CanvasConnectionIssue) => toast.error(connectionIssueMessage(issue)),
    [connectionIssueMessage]
  );
  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (connection) => {
      if (connection.targetHandle !== "input" || !connection.source || !connection.target) {
        return false;
      }
      const validation = validateConnection(connection.source, connection.target);
      if (!validation.ok && !reconnectDone.current) reconnectIssue.current = validation.issue;
      return validation.ok;
    },
    [validateConnection]
  );
  const connectionForPending = useCallback(
    (pending: PendingConnection, otherNodeId: string): Connection | null => {
      if (pending.handleType === "target") {
        return {
          source: otherNodeId,
          sourceHandle: "output",
          target: pending.nodeId,
          targetHandle: pending.handleId,
        };
      }
      if (pending.handleType === "source") {
        return {
          source: pending.nodeId,
          sourceHandle: pending.handleId,
          target: otherNodeId,
          targetHandle: "input",
        };
      }
      return null;
    },
    []
  );
  /** Can a new source of `kind` bind to the target's current mode now? */
  const targetAcceptsKind = useCallback(
    (nodeId: string, kind: UploadMediaKind) => {
      const node = getNode(nodeId);
      return Boolean(node && routeTargetReferenceField(node, catalog, kind));
    },
    [catalog, getNode]
  );
  const menuDisabledActions = useMemo<ReadonlySet<AddNodeAction>>(() => {
    const disabled = new Set<AddNodeAction>();
    const pending = addMenu?.pending;
    if (!pending) return disabled;
    disabled.add("director-desk");
    if (pending.handleType === "source") {
      const kind = outputKind(pending.nodeId);
      if (kind) {
        if (!GEN_ACCEPTS["generate-image"].includes(kind)) disabled.add("generate-image");
        if (!GEN_ACCEPTS["generate-video"].includes(kind)) disabled.add("generate-video");
        if (!GEN_ACCEPTS["generate-audio"].includes(kind)) disabled.add("generate-audio");
        if (!SHOT_ACCEPTS.includes(kind)) disabled.add("shot");
      }
    } else {
      // Dragging from an INPUT: the new node has to feed the pending one, and a
      // shot has no output — it can never be that source.
      disabled.add("shot");
      if (!targetAcceptsKind(pending.nodeId, "image")) disabled.add("generate-image");
      if (!targetAcceptsKind(pending.nodeId, "video")) disabled.add("generate-video");
      if (!targetAcceptsKind(pending.nodeId, "audio")) disabled.add("generate-audio");
    }
    return disabled;
  }, [addMenu?.pending, outputKind, targetAcceptsKind]);

  const bindReference = useCallback(
    (edgeId: string, source: string, target: string) =>
      bindEdgeReference(
        {
          getNode,
          getEdges: getDocumentEdges,
          catalog,
          graph: { addEdge: graphAddEdge, patchNodeData, removeEdge: graphRemoveEdge },
        },
        edgeId,
        source,
        target
      ),
    [catalog, getDocumentEdges, getNode, graphAddEdge, graphRemoveEdge, patchNodeData]
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.targetHandle !== "input") return;
      const validation = validateConnection(connection.source, connection.target);
      if (!validation.ok) {
        showConnectionIssue(validation.issue);
        return;
      }
      const edgeId = crypto.randomUUID();
      graphAddEdge({
        id: edgeId,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      });
      const binding = bindReference(edgeId, connection.source, connection.target);
      if (binding.status === "rejected") {
        graphRemoveEdge(edgeId);
        showConnectionIssue(binding.issue);
      }
    },
    [bindReference, graphAddEdge, graphRemoveEdge, showConnectionIssue, validateConnection]
  );

  // Keep every wire's bound reference honest: bind one that never bound (wired
  // before its source had an output) and refresh one whose source has since
  // produced a new URL. Runs for EVERY reference-holding target (generation
  // card or shot) — a target that takes none simply routes to nothing.
  useEffect(() => {
    if (!catalog) return;
    edges.forEach((edge) => {
      const target = getNode(edge.target);
      if (!target) return;
      const references = (target.data as { references?: CardReferences }).references ?? {};
      let boundField: string | undefined;
      let boundUrl: string | undefined;
      Object.entries(references).some(([field, list]) => {
        const hit = (list ?? []).find((reference) => reference.edgeId === edge.id);
        if (!hit) return false;
        boundField = field;
        boundUrl = hit.url;
        return true;
      });
      if (!boundField) {
        const binding = bindReference(edge.id, edge.source, edge.target);
        if (binding.status === "rejected") {
          graphRemoveEdge(edge.id);
          showConnectionIssue(binding.issue);
        }
        return;
      }
      const url = outputUrl(edge.source);
      if (!url || url.startsWith("blob:") || url === boundUrl) return;
      const field = boundField;
      patchNodeData(edge.target, (node) => {
        const current = (node.data as { references?: CardReferences }).references ?? {};
        return {
          references: {
            ...current,
            [field]: (current[field] ?? []).map((reference) =>
              reference.edgeId === edge.id ? { ...reference, url } : reference
            ),
          },
        };
      });
    });
  }, [
    bindReference,
    catalog,
    edges,
    getNode,
    graphRemoveEdge,
    nodes,
    outputUrl,
    patchNodeData,
    showConnectionIssue,
  ]);

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      deleted.forEach((edge) => {
        if (edge.target) stripEdgeRef(patchNodeData, edge.target, edge.id);
      });
    },
    [patchNodeData]
  );

  const runUpload = useCallback(
    (id: string, file: File, kind: UploadMediaKind) => {
      const controller = uploadStore.get(id)?.controller;
      if (!controller || controller.signal.aborted) return;
      const signal = controller.signal;
      const ownsAttempt = () => !signal.aborted && uploadStore.get(id)?.controller === controller;
      uploadFileViaSignedUrl(file, {
        kind: uploadKind(kind),
        ...(workspaceId ? { workspaceId } : {}),
        signal,
        onProgress: (progress) => {
          if (ownsAttempt()) uploadStore.patchProgress(id, progress);
        },
      })
        .then((uploaded) => {
          if (!ownsAttempt()) return;
          promoteLocalNode(id, {
            src: uploaded.url,
            mediaAssetId: uploaded.mediaAssetId,
            label: file.name,
          });
          addAssets([
            {
              id: uploaded.mediaAssetId,
              mediaAssetId: uploaded.mediaAssetId,
              kind,
              source: "uploaded",
              url: uploaded.url,
              name: file.name,
              createdAt: Date.now(),
              category: "general",
            },
          ]);
          uploadStore.succeed(id);
          const wire = pendingWires.current.get(id);
          if (wire) {
            pendingWires.current.delete(id);
            wire();
          }
        })
        .catch((error) => {
          if (!ownsAttempt() || isUploadAbort(error)) return;
          uploadStore.markFailed(id, error instanceof Error ? error.message : String(error));
        });
    },
    [addAssets, promoteLocalNode, uploadStore, workspaceId]
  );

  const addFiles = useCallback(
    (files: File[], base: { x: number; y: number }) => {
      const ids: string[] = [];
      files.forEach((file, index) => {
        const kind = canvasUploadMediaKind(file, acceptedKinds);
        if (!kind) return;
        const id = crypto.randomUUID();
        const objectUrl = URL.createObjectURL(file);
        addLocalNode({
          id,
          type: nodeTypeForMedia(kind),
          position: { x: base.x + index * 32, y: base.y + index * 32 },
          data: { src: objectUrl, label: file.name },
        });
        uploadStore.begin(id, {
          status: "uploading",
          progress: 0,
          objectUrl,
          file,
          controller: new AbortController(),
        });
        runUpload(id, file, kind);
        ids.push(id);
      });
      return ids;
    },
    [acceptedKinds, addLocalNode, runUpload, uploadStore]
  );
  const retryUpload = useCallback(
    (id: string) => {
      const entry = uploadStore.get(id);
      const kind = entry ? canvasUploadMediaKind(entry.file, acceptedKinds) : null;
      if (!entry || entry.status !== "failed" || !kind) return;
      uploadStore.begin(id, {
        ...entry,
        status: "uploading",
        progress: 0,
        error: undefined,
        controller: new AbortController(),
      });
      runUpload(id, entry.file, kind);
    },
    [acceptedKinds, runUpload, uploadStore]
  );
  const uploadContextValue = useMemo(
    () => ({ store: uploadStore, retry: retryUpload }),
    [retryUpload, uploadStore]
  );
  useEffect(() => {
    const wires = pendingWires.current;
    return () => {
      uploadStore.cancelAll();
      wires.clear();
    };
  }, [scopeKey, uploadStore]);
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      deleted.forEach((node) => {
        if (!uploadStore.get(node.id)) return;
        pendingWires.current.delete(node.id);
        uploadStore.cancel(node.id);
      });
    },
    [uploadStore]
  );

  const addNode = useCallback(
    (node: CanvasNodeShape) => {
      graphAddNode(node);
      selectNodes([node.id]);
      setAddMenu(null);
    },
    [graphAddNode, selectNodes]
  );
  const generationDefaults = useCallback(
    (modality: GenerationModality) => {
      const model = canvasDefaultModel(catalog, modality);
      return {
        modelId: model?.id,
        modelName: model?.name,
        mode: canvasDefaultMode(model),
        settings: defaultSettingsForModel(model),
        references: {},
      };
    },
    [catalog]
  );
  const addNodeOfType = useCallback(
    (action: AddNodeAction, flow: { x: number; y: number }, pending?: PendingConnection | null) => {
      if (action === "upload") {
        pendingUploadFlowPos.current = flow;
        pendingUploadConnection.current = pending ?? null;
        fileInputRef.current?.click();
        setAddMenu(null);
        return;
      }
      if (action === "director-desk") {
        openDirectorDesk();
        setAddMenu(null);
        return;
      }
      const id = crypto.randomUUID();
      const modality: GenerationModality | null =
        action === "generate-image"
          ? "image"
          : action === "generate-video"
            ? "video"
            : action === "generate-audio"
              ? "audio"
              : null;
      const nodeType = modality
        ? generationNodeTypeForModality(modality)
        : action === "shot"
          ? SHOT_NODE_TYPE
          : "note";
      if (nodeType === SHOT_NODE_TYPE) {
        addNode({
          id,
          type: SHOT_NODE_TYPE,
          position: flow,
          data: { order: nextShotOrder(getDocumentNodes()) },
        });
      } else if (modality) {
        addNode({
          id,
          type: nodeType,
          position: flow,
          data: {
            ...generationDefaults(modality),
            prompt: "",
            name: t(`${modality}CardName`, {
              index: nodes.filter((node) => node.type === nodeType).length + 1,
            }),
          },
        });
      } else {
        addNode({ id, type: "note", position: flow, data: { text: "" } });
      }
      if (!pending) return;
      // A shot only ever takes the pending wire as its INPUT (it has no output),
      // so a drag started from some card's input can't be closed with one.
      if (nodeType === SHOT_NODE_TYPE) {
        if (pending.handleType === "source") {
          onConnect({
            source: pending.nodeId,
            sourceHandle: "output",
            target: id,
            targetHandle: "input",
          });
        }
        return;
      }
      if (isGenerationNodeType(nodeType)) {
        onConnect(
          pending.handleType === "source"
            ? {
                source: pending.nodeId,
                sourceHandle: "output",
                target: id,
                targetHandle: "input",
              }
            : {
                source: id,
                sourceHandle: "output",
                target: pending.nodeId,
                targetHandle: "input",
              }
        );
      }
    },
    [addNode, generationDefaults, getDocumentNodes, nodes, onConnect, openDirectorDesk, t]
  );
  const addNodeFromDock = useCallback(
    (action: AddNodeAction) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const center = screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
      const nudge = (nodes.length % 6) * 26;
      addNodeOfType(action, { x: center.x + nudge, y: center.y + nudge });
    },
    [addNodeOfType, nodes.length, screenToFlowPosition]
  );

  useEffect(() => {
    if (!projectCtx || !nodeInsertRequest) return;
    if (handledNodeInsertRequest.current === nodeInsertRequest.id) return;

    handledNodeInsertRequest.current = nodeInsertRequest.id;
    if (canEdit && addNodeActions.includes(nodeInsertRequest.action)) {
      addNodeFromDock(nodeInsertRequest.action);
    }
    clearNodeInsertRequest(nodeInsertRequest.id);
  }, [
    addNodeActions,
    addNodeFromDock,
    canEdit,
    clearNodeInsertRequest,
    nodeInsertRequest,
    projectCtx,
  ]);

  useCanvasAuthoringShortcuts({
    enabled: canEdit,
    edges,
    getNodes,
    addNodesAndEdges: graphAddNodesAndEdges,
    selectNodes,
    addNode: addNodeFromDock,
    addNodeActions,
  });

  const addAssetToCanvas = useCallback(
    (asset: CanvasAsset, position?: { x: number; y: number }) => {
      if (!asset.url) return;
      const rect = containerRef.current?.getBoundingClientRect();
      const fallback =
        rect != null
          ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
          : { x: 0, y: 0 };
      addNode({
        id: crypto.randomUUID(),
        type:
          asset.kind === "video"
            ? "videoAsset"
            : asset.kind === "audio"
              ? "audioAsset"
              : asset.panorama
                ? "panorama"
                : "image",
        position: position ?? fallback,
        data: {
          src: asset.url,
          mediaAssetId: asset.mediaAssetId,
          label: asset.name ?? asset.prompt,
        },
      });
    },
    [addNode, screenToFlowPosition]
  );
  const clearFileDrag = useCallback(() => {
    fileDragDepth.current = 0;
    setFileDragActive(false);
  }, []);
  const onDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (!canEdit || !isExternalCanvasDrag(event.dataTransfer.types)) return;
      fileDragDepth.current += 1;
      setFileDragActive(true);
    },
    [canEdit]
  );
  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!canEdit || !isExternalCanvasDrag(event.dataTransfer.types)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [canEdit]
  );
  const onDragLeave = useCallback(
    (event: React.DragEvent) => {
      if (!canEdit || !isExternalCanvasDrag(event.dataTransfer.types)) return;
      fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
      if (fileDragDepth.current === 0) setFileDragActive(false);
    },
    [canEdit]
  );
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      clearFileDrag();
      if (!canEdit) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const assetData = event.dataTransfer.getData(ASSET_DRAG_MIME);
      if (assetData) {
        try {
          addAssetToCanvas(JSON.parse(assetData) as CanvasAsset, position);
        } catch {
          return;
        }
        return;
      }
      const dropped = Array.from(event.dataTransfer.files);
      const files = dropped.filter((file) => Boolean(canvasUploadMediaKind(file, acceptedKinds)));
      if (dropped.length > 0 && files.length < dropped.length) {
        toast.error(t("unsupportedDrop"));
      }
      if (files.length > 0) addFiles(files, position);
    },
    [acceptedKinds, addAssetToCanvas, addFiles, canEdit, clearFileDrag, screenToFlowPosition, t]
  );
  const onPickFiles = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(event.target.files ?? []);
      const files = picked.filter((file) => Boolean(canvasUploadMediaKind(file, acceptedKinds)));
      event.target.value = "";
      if (picked.length > 0 && files.length < picked.length) {
        toast.error(t("unsupportedDrop"));
      }
      if (files.length === 0) return;
      const rect = containerRef.current?.getBoundingClientRect();
      const base =
        pendingUploadFlowPos.current ??
        screenToFlowPosition({
          x: (rect?.left ?? 0) + (rect?.width ?? window.innerWidth) / 2,
          y: (rect?.top ?? 0) + (rect?.height ?? window.innerHeight) / 2,
        });
      pendingUploadFlowPos.current = null;
      const pending = pendingUploadConnection.current;
      pendingUploadConnection.current = null;
      const [firstId] = addFiles(files, base);
      if (pending && firstId) {
        pendingWires.current.set(firstId, () => {
          const connection = connectionForPending(pending, firstId);
          if (connection) onConnect(connection);
        });
      }
    },
    [acceptedKinds, addFiles, connectionForPending, onConnect, screenToFlowPosition, t]
  );
  const onConnectStart = useCallback<OnConnectStart>((event, params) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = "touches" in event ? event.touches[0] : event;
    connectStartRef.current = {
      x: point.clientX - rect.left,
      y: point.clientY - rect.top,
      color: handleColor(params.handleId),
    };
  }, []);
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromHandle || !state.fromNode) return;
      const point =
        "changedTouches" in event
          ? { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }
          : { x: event.clientX, y: event.clientY };
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const flowPoint = screenToFlowPosition(point);
      const pending: PendingConnection = {
        nodeId: state.fromNode.id,
        handleId: state.fromHandle.id ?? null,
        handleType: state.fromHandle.type,
      };
      const hit = getNodes().find((node) => {
        const { width, height } = canvasNodeLayoutSize(node);
        return (
          flowPoint.x >= node.position.x &&
          flowPoint.x <= node.position.x + width &&
          flowPoint.y >= node.position.y &&
          flowPoint.y <= node.position.y + height
        );
      });
      if (hit) {
        const connection = connectionForPending(pending, hit.id);
        if (connection) {
          onConnect(connection);
          return;
        }
      }
      lastConnectEndAt.current = Date.now();
      const x = point.x - rect.left;
      const y = point.y - rect.top;
      const start = connectStartRef.current;
      setAddMenu({
        left: Math.max(8, Math.min(x, rect.width - 308)),
        top: Math.max(8, Math.min(y, rect.height - 380)),
        flow: flowPoint,
        pending,
        wire: start ? { x1: start.x, y1: start.y, x2: x, y2: y, color: start.color } : undefined,
      });
    },
    [connectionForPending, getNodes, onConnect, screenToFlowPosition]
  );
  const onReconnectStart = useCallback(() => {
    reconnectDone.current = false;
    reconnectIssue.current = null;
  }, []);
  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      if (!connection.source || !connection.target || connection.targetHandle !== "input") return;
      const validation = validateConnection(connection.source, connection.target, oldEdge.id);
      if (!validation.ok) {
        reconnectDone.current = true;
        reconnectIssue.current = null;
        showConnectionIssue(validation.issue);
        return;
      }
      reconnectDone.current = true;
      reconnectIssue.current = null;
      if (oldEdge.target !== connection.target) {
        stripEdgeRef(patchNodeData, oldEdge.target, oldEdge.id);
      }
      graphAddEdge({
        id: oldEdge.id,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      });
      const binding = bindReference(oldEdge.id, connection.source, connection.target);
      if (binding.status === "rejected") {
        // The graph changed concurrently after validation. Restore the old edge;
        // its old reference is reconciled from the source on the next pass.
        graphAddEdge({
          id: oldEdge.id,
          source: oldEdge.source,
          target: oldEdge.target,
          sourceHandle: oldEdge.sourceHandle,
          targetHandle: oldEdge.targetHandle,
        });
        bindReference(oldEdge.id, oldEdge.source, oldEdge.target);
        showConnectionIssue(binding.issue);
      }
    },
    [bindReference, graphAddEdge, patchNodeData, showConnectionIssue, validateConnection]
  );
  const onReconnectEnd = useCallback(() => {
    if (!reconnectDone.current) {
      if (reconnectIssue.current) showConnectionIssue(reconnectIssue.current);
    }
    reconnectDone.current = true;
    reconnectIssue.current = null;
  }, [showConnectionIssue]);
  const tidyCanvas = useCanvasTidy({
    edges,
    onNodesChange,
    tidySelection,
    estimateHeight: estimateCanvasNodeHeight,
  });
  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (!(event.target as HTMLElement).classList.contains("react-flow__pane")) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAddMenu({
        left: Math.max(8, Math.min(event.clientX - rect.left, rect.width - 308)),
        top: Math.max(8, Math.min(event.clientY - rect.top, rect.height - 380)),
        flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [screenToFlowPosition]
  );
  const openAddMenuAtCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAddMenu({
      left: Math.max(8, Math.min(rect.width / 2 - 154, rect.width - 308)),
      top: Math.max(8, Math.min(rect.height / 2 - 120, rect.height - 380)),
      flow: screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }),
    });
  }, [screenToFlowPosition]);

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onNodesDelete,
    onEdgesDelete,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onReconnectStart,
    onReconnect,
    onReconnectEnd,
    isValidConnection,
    addMenu,
    setAddMenu,
    menuDisabledActions,
    addNodeOfType,
    addNodeFromDock,
    addAssetToCanvas,
    assetsOpen,
    setAssetsOpen,
    assetLibraryInset: assetsOpen ? ASSET_LIBRARY_WIDTH : 0,
    snapToGrid,
    setSnapToGrid,
    minimapOpen,
    setMinimapOpen,
    containerRef,
    screenToFlowPosition,
    fileInputRef,
    acceptedFileTypes: canvasAcceptedFileTypes(uploadKinds),
    uploadContextValue,
    fileDragActive,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPickFiles,
    onDoubleClick,
    openAddMenuAtCenter,
    tidyCanvas,
    canUndo,
    canRedo,
    undo,
    redo,
    lastConnectEndAt,
  };
}
