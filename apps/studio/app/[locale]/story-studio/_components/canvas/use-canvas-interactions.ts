"use client";

import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  addEdge,
  useReactFlow,
  type Connection,
  type OnConnectEnd,
  type OnConnectStart,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import { toast } from "sonner";
import { nodeDefaults } from "./node-defaults";
import {
  CONNECTION_PORTS,
  edgeLabelOptions,
  edgeOptionsForPort,
  isConnectionTargetKindAllowed,
  nextDraftNodeForPort,
  targetHandleForPort,
  type ConnectionPortId,
} from "./ports";
import type {
  NarrativeEdge,
  NarrativeNode,
  NarrativeNodeData,
  NarrativeNodeKind,
  StoryRootStats,
} from "./types";

function getClientPoint(event: MouseEvent | TouchEvent) {
  if ("clientX" in event) {
    return {
      x: event.clientX,
      y: event.clientY,
    };
  }

  if ("changedTouches" in event && event.changedTouches.length > 0) {
    return {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
    };
  }

  return { x: 0, y: 0 };
}

type UseCanvasInteractionsArgs = {
  nodes: NarrativeNode[];
  setNodes: Dispatch<SetStateAction<NarrativeNode[]>>;
  setEdges: Dispatch<SetStateAction<NarrativeEdge[]>>;
};

/**
 * Owns direct canvas manipulation: port-rule-aware connects (including the
 * drag-to-empty-space draft-node creation), selection mode, the node
 * library's add flow, the node editor's data patches, and the per-render
 * node decoration (edit/view handlers + root stats).
 */
export function useCanvasInteractions({ nodes, setNodes, setEdges }: UseCanvasInteractionsArgs) {
  const reactFlow = useReactFlow<NarrativeNode, NarrativeEdge>();

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedNodeCount, setSelectedNodeCount] = useState(0);
  const [activeStoryRoot, setActiveStoryRoot] = useState<NarrativeNodeData | null>(null);
  const [activeCharacter, setActiveCharacter] = useState<NarrativeNodeData | null>(null);
  const [activeEditNodeId, setActiveEditNodeId] = useState<string | null>(null);

  const connectStartRef = useRef<Parameters<OnConnectStart>[1] | null>(null);
  const portDraftCounterRef = useRef<Record<ConnectionPortId, number>>({
    roles: 0,
    clues: 0,
  });

  const activeEditNode = useMemo(
    () => nodes.find((node) => node.id === activeEditNodeId) ?? null,
    [activeEditNodeId, nodes]
  );

  const openNodeEditor = useCallback((nodeId: string) => {
    setActiveEditNodeId(nodeId);
  }, []);

  const updateNodeData = useCallback(
    (nodeId: string, patch: Partial<NarrativeNodeData>) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node
        )
      );
    },
    [setNodes]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((current) => current.filter((node) => node.id !== nodeId));
      setEdges((current) =>
        current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
      );
      setActiveEditNodeId(null);
    },
    [setEdges, setNodes]
  );

  const nodesWithActions = useMemo(() => {
    const storyRootStats: StoryRootStats = {
      roleCount: nodes.filter((node) => node.data.kind === "role").length,
      plotCount: nodes.filter((node) => node.data.kind === "plot").length,
      clueCount: nodes.filter((node) => node.data.kind === "clue").length,
      endingCount: nodes.filter((node) => node.data.kind === "ending").length,
    };

    return nodes.map((node) => {
      const dataWithEdit = {
        ...node.data,
        onEditNode: () => openNodeEditor(node.id),
      };

      if (node.id === "storyRoot") {
        return {
          ...node,
          data: {
            ...dataWithEdit,
            storyRootStats,
            onViewStoryRoot: () => setActiveStoryRoot(node.data),
          },
        };
      }

      if (node.data.kind === "role") {
        return {
          ...node,
          data: {
            ...dataWithEdit,
            onViewCharacter: () => setActiveCharacter(node.data),
          },
        };
      }

      return { ...node, data: dataWithEdit };
    });
  }, [nodes, openNodeEditor]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const targetNode = nodes.find((node) => node.id === connection.target);

      if (
        !isConnectionTargetKindAllowed(
          connection.sourceHandle,
          targetNode?.data.kind,
          connection.source
        )
      ) {
        return;
      }

      const targetHandle =
        connection.targetHandle ??
        targetHandleForPort(connection.sourceHandle, targetNode?.data.kind);

      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `${connection.source}-${connection.sourceHandle ?? "default"}-${connection.target}-${
              targetHandle ?? connection.targetHandle ?? "default"
            }-${Date.now()}`,
            targetHandle,
            ...edgeOptionsForPort(connection.sourceHandle),
          },
          current
        )
      );
    },
    [nodes, setEdges]
  );

  const onConnectStart = useCallback<OnConnectStart>((_event, params) => {
    connectStartRef.current = params;
  }, []);

  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      const start = connectStartRef.current;
      connectStartRef.current = null;

      if (
        !start?.nodeId ||
        start.handleType !== "source" ||
        !start.handleId ||
        !(start.handleId in CONNECTION_PORTS) ||
        connectionState.toNode
      ) {
        return;
      }

      const sourceNode = nodes.find((node) => node.id === start.nodeId);

      if (!sourceNode) {
        return;
      }

      const portId = start.handleId as ConnectionPortId;
      const pointer = getClientPoint(event);
      const position = reactFlow.screenToFlowPosition(pointer);
      const nextDraftIndex = portDraftCounterRef.current[portId] + 1;
      portDraftCounterRef.current[portId] = nextDraftIndex;
      const draftNode = nextDraftNodeForPort({
        portId,
        index: nextDraftIndex,
      });
      const nextNodeId = `${draftNode.data.kind}-${portId}-${Date.now()}`;

      setNodes((current) => [
        ...current,
        {
          id: nextNodeId,
          type: "narrative",
          position: { x: position.x - draftNode.offset.x, y: position.y - draftNode.offset.y },
          data: draftNode.data,
        },
      ]);

      setEdges((current) =>
        addEdge(
          {
            ...edgeOptionsForPort(portId),
            ...edgeLabelOptions(draftNode.label, portId),
            id: `${sourceNode.id}-${nextNodeId}`,
            source: sourceNode.id,
            sourceHandle: portId,
            target: nextNodeId,
            targetHandle: draftNode.targetHandle,
          },
          current
        )
      );
    },
    [nodes, reactFlow, setEdges, setNodes]
  );

  const onSelectionChange = useCallback<OnSelectionChangeFunc<NarrativeNode, NarrativeEdge>>(
    ({ nodes: selectedNodes }) => {
      setSelectedNodeCount(selectedNodes.length);
    },
    []
  );

  const addNode = useCallback(
    (kind: NarrativeNodeKind) => {
      if (kind === "storyRoot") {
        // A story has exactly one root; jump to the existing one instead of
        // forking a second spine the compiler and edge rules would ignore.
        const existingRoot = nodes.find((node) => node.data.kind === "storyRoot");
        if (existingRoot) {
          setNodes((current) =>
            current.map((node) => ({ ...node, selected: node.id === existingRoot.id }))
          );
          void reactFlow.setCenter(
            existingRoot.position.x + (existingRoot.measured?.width ?? 380) / 2,
            existingRoot.position.y + (existingRoot.measured?.height ?? 260) / 2,
            { zoom: reactFlow.getZoom(), duration: 500 }
          );
          toast.info("A story has a single Story Root — it's already on the canvas.");
          return;
        }
      }
      const nextIndex = nodes.length + 1;
      const x = 260 + (nextIndex % 4) * 380;
      const y = 500 + Math.floor(nextIndex / 4) * 260;
      setNodes((current) => [
        ...current,
        {
          // The root keeps the FIXED id "storyRoot" — edge rules identify
          // the root by that id.
          id: kind === "storyRoot" ? "storyRoot" : `${kind}-${Date.now()}`,
          type: "narrative",
          position: { x, y },
          data: nodeDefaults(kind, nextIndex),
        },
      ]);
    },
    [nodes, reactFlow, setNodes]
  );

  return {
    isSelectionMode,
    setIsSelectionMode,
    selectedNodeCount,
    activeStoryRoot,
    setActiveStoryRoot,
    activeCharacter,
    setActiveCharacter,
    activeEditNode,
    setActiveEditNodeId,
    nodesWithActions,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onSelectionChange,
    addNode,
    openNodeEditor,
    updateNodeData,
    deleteNode,
  };
}
