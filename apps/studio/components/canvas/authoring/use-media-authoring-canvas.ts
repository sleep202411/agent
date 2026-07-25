"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { CanvasGraphStore } from "@/lib/canvas-core/canvas-graph-context";
import type { CanvasAsset, CanvasNodeShape } from "@/lib/canvas-core/types";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import { useCanvasTidy } from "@/components/canvas/use-canvas-tidy";
import { useCanvasHistoryShortcuts } from "@/components/canvas/canvas-history";
import { ASSET_DRAG_MIME, ASSET_LIBRARY_WIDTH } from "@/components/canvas/authoring/asset-library";
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
  modelAcceptsKind,
  routeReferenceField as routeReferenceFieldFor,
} from "@/lib/canvas-authoring/reference-routing";
import {
  bindEdgeReference,
  sourceMediaUrl,
  sourceOutputKind,
  stripEdgeRef,
} from "@/lib/canvas-authoring/canvas-wiring";
import type { AddNodeAction } from "@/components/canvas/add-node-menu";
import type { GenerationNodeData } from "@/components/canvas/authoring/generation-card";

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

const GEN_ACCEPTS: Record<"generate-image" | "generate-video", readonly UploadMediaKind[]> = {
  "generate-image": ["image"],
  "generate-video": ["image", "video", "audio"],
};

const UPLOAD_CONTENT_TYPES: Record<UploadMediaKind, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/quicktime"],
  audio: ["audio/mpeg", "audio/wav", "audio/x-wav"],
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
  return kinds.flatMap((kind) => UPLOAD_CONTENT_TYPES[kind]).join(",");
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
  } = graph;
  const { screenToFlowPosition, fitView, getNodes, setCenter } = useReactFlow();
  const acceptedKinds = useMemo(() => new Set(uploadKinds), [uploadKinds]);
  const [addMenu, setAddMenu] = useState<CanvasAddMenuState | null>(null);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadFlowPos = useRef<{ x: number; y: number } | null>(null);
  const pendingUploadConnection = useRef<PendingConnection | null>(null);
  const pendingWires = useRef(new Map<string, () => void>());
  const reconnectDone = useRef(true);
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
      if (canvasNodes.length > 0) {
        void fitView({ nodes: canvasNodes, padding: 0.4, duration: 280 });
      } else if (fitEmptyCanvas) {
        void setCenter(0, 0, { zoom: 0.76, duration: 280 });
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [fitEmptyCanvas, fitView, getNodes, nodes, ready, setCenter]);

  const outputKind = useCallback(
    (nodeId: string | null | undefined) => (nodeId ? sourceOutputKind(getNode, nodeId) : undefined),
    [getNode]
  );
  const outputUrl = useCallback(
    (nodeId: string | null | undefined) => (nodeId ? sourceMediaUrl(getNode, nodeId) : undefined),
    [getNode]
  );
  const routeReferenceField = useCallback(
    (nodeId: string | null | undefined, kind: string) => {
      if (!nodeId) return undefined;
      const node = getNode(nodeId);
      if (!node || (node.type !== "prompt" && node.type !== "video")) return undefined;
      const data = node.data as GenerationNodeData;
      const model = catalog?.models.find((candidate) => candidate.id === data.modelId);
      return routeReferenceFieldFor(model, data.mode, data.references, kind);
    },
    [catalog, getNode]
  );
  const canConnect = useCallback(
    (source: string | null | undefined, target: string | null | undefined) => {
      if (!source || !target || source === target) return false;
      if (!catalog) return true;
      const kind = outputKind(source);
      return Boolean(kind && routeReferenceField(target, kind));
    },
    [catalog, outputKind, routeReferenceField]
  );
  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (connection) =>
      connection.targetHandle === "input" && canConnect(connection.source, connection.target),
    [canConnect]
  );
  const connectionForPending = useCallback(
    (pending: PendingConnection, otherNodeId: string): Connection | null => {
      if (pending.handleType === "target" && canConnect(otherNodeId, pending.nodeId)) {
        return {
          source: otherNodeId,
          sourceHandle: "output",
          target: pending.nodeId,
          targetHandle: pending.handleId,
        };
      }
      if (pending.handleType === "source" && canConnect(pending.nodeId, otherNodeId)) {
        return {
          source: pending.nodeId,
          sourceHandle: pending.handleId,
          target: otherNodeId,
          targetHandle: "input",
        };
      }
      return null;
    },
    [canConnect]
  );
  const menuDisabledActions = useMemo<ReadonlySet<AddNodeAction>>(() => {
    const disabled = new Set<AddNodeAction>();
    const pending = addMenu?.pending;
    if (!pending) return disabled;
    if (pending.handleType === "source") {
      const kind = outputKind(pending.nodeId);
      if (kind) {
        if (!GEN_ACCEPTS["generate-image"].includes(kind)) disabled.add("generate-image");
        if (!GEN_ACCEPTS["generate-video"].includes(kind)) disabled.add("generate-video");
      }
    } else {
      const node = getNode(pending.nodeId);
      const model = node
        ? catalog?.models.find(
            (candidate) => candidate.id === (node.data as GenerationNodeData).modelId
          )
        : undefined;
      if (!modelAcceptsKind(model, "image")) disabled.add("generate-image");
      if (!modelAcceptsKind(model, "video")) disabled.add("generate-video");
    }
    return disabled;
  }, [addMenu?.pending, catalog, getNode, outputKind]);

  const bindReference = useCallback(
    (edgeId: string, source: string | null, target: string | null) => {
      if (!source || !target) return;
      bindEdgeReference(
        { getNode, catalog, graph: { addEdge: graphAddEdge, patchNodeData } },
        edgeId,
        source,
        target
      );
    },
    [catalog, getNode, graphAddEdge, patchNodeData]
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const edgeId = crypto.randomUUID();
      graphAddEdge({
        id: edgeId,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      });
      if (connection.targetHandle === "input") {
        bindReference(edgeId, connection.source, connection.target);
      }
    },
    [bindReference, graphAddEdge]
  );

  useEffect(() => {
    if (!catalog) return;
    edges.forEach((edge) => {
      const target = getNode(edge.target);
      if (!target || (target.type !== "prompt" && target.type !== "video")) return;
      const references = (target.data as GenerationNodeData).references ?? {};
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
        bindReference(edge.id, edge.source, edge.target);
        return;
      }
      const url = outputUrl(edge.source);
      if (!url || url.startsWith("blob:") || url === boundUrl) return;
      const field = boundField;
      patchNodeData(edge.target, (node) => {
        const current = (node.data as GenerationNodeData).references ?? {};
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
  }, [bindReference, catalog, edges, getNode, nodes, outputUrl, patchNodeData]);

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
      const signal = uploadStore.get(id)?.controller.signal;
      uploadFileViaSignedUrl(file, {
        kind: uploadKind(kind),
        ...(workspaceId ? { workspaceId } : {}),
        signal,
        onProgress: (progress) => uploadStore.patchProgress(id, progress),
      })
        .then((uploaded) => {
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
          if (isUploadAbort(error)) return;
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
      if (!entry || !kind) return;
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
    (modality: "image" | "video") => {
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
      const id = crypto.randomUUID();
      const nodeType =
        action === "generate-image" ? "prompt" : action === "generate-video" ? "video" : "note";
      if (nodeType === "prompt") {
        addNode({
          id,
          type: nodeType,
          position: flow,
          data: {
            ...generationDefaults("image"),
            prompt: "",
            name: t("imageCardName", {
              index: nodes.filter((node) => node.type === "prompt").length + 1,
            }),
          },
        });
      } else if (nodeType === "video") {
        addNode({
          id,
          type: nodeType,
          position: flow,
          data: {
            ...generationDefaults("video"),
            prompt: "",
            name: t("videoCardName", {
              index: nodes.filter((node) => node.type === "video").length + 1,
            }),
          },
        });
      } else {
        addNode({ id, type: "note", position: flow, data: { text: "" } });
      }
      if (pending && (nodeType === "prompt" || nodeType === "video")) {
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
    [addNode, generationDefaults, nodes, onConnect, t]
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

  useCanvasAuthoringShortcuts({
    enabled: canEdit,
    edges,
    getNodes,
    addNodesAndEdges: graphAddNodesAndEdges,
    selectNodes,
    addNode: addNodeFromDock,
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
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
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
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        Boolean(canvasUploadMediaKind(file, acceptedKinds))
      );
      if (files.length > 0) addFiles(files, position);
    },
    [acceptedKinds, addAssetToCanvas, addFiles, screenToFlowPosition]
  );
  const onPickFiles = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []).filter((file) =>
        Boolean(canvasUploadMediaKind(file, acceptedKinds))
      );
      event.target.value = "";
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
    [acceptedKinds, addFiles, connectionForPending, onConnect, screenToFlowPosition]
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
        const width = node.measured?.width ?? 0;
        const height = node.measured?.height ?? 0;
        return (
          node.id !== pending.nodeId &&
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
  }, []);
  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      reconnectDone.current = true;
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
      if (connection.targetHandle === "input") {
        bindReference(oldEdge.id, connection.source, connection.target);
      }
    },
    [bindReference, graphAddEdge, patchNodeData]
  );
  const onReconnectEnd = useCallback(
    (_event: unknown, edge: Edge) => {
      if (!reconnectDone.current) {
        stripEdgeRef(patchNodeData, edge.target, edge.id);
        graphRemoveEdge(edge.id);
      }
      reconnectDone.current = true;
    },
    [graphRemoveEdge, patchNodeData]
  );
  const tidyCanvas = useCanvasTidy({ edges, onNodesChange, tidySelection });
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
    onDragOver,
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
