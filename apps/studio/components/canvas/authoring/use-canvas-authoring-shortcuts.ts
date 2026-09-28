"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Edge, Node } from "@xyflow/react";
import {
  collectCanvasSelection,
  placeCanvasClone,
  type CanvasClipboard,
} from "@/components/canvas/authoring/canvas-duplicate";
import type { CanvasGraphStore } from "@/lib/canvas-core/canvas-graph-context";
import {
  ADD_NODE_SHORTCUTS,
  DEFAULT_ADD_NODE_ACTIONS,
  type AddNodeAction,
} from "@/components/canvas/add-node-menu";

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  );
}

/**
 * Shared authoring keyboard behavior for every product-owned canvas: clipboard
 * (⌘C/⌘V) and in-place duplicate (⌘D), all routed through canvas-duplicate so
 * a copy keeps its wired references (see that module for the edge policy).
 *
 * The clipboard is intentionally in-memory: canvas nodes can contain signed
 * URLs and product context, so they must not leak into the operating-system
 * clipboard.
 */
export function useCanvasAuthoringShortcuts({
  enabled,
  edges,
  getNodes,
  addNodesAndEdges,
  selectNodes,
  addNode,
  addNodeActions = DEFAULT_ADD_NODE_ACTIONS,
}: {
  enabled: boolean;
  edges: readonly Edge[];
  getNodes: () => Node[];
  addNodesAndEdges: CanvasGraphStore["addNodesAndEdges"];
  selectNodes: CanvasGraphStore["selectNodes"];
  addNode: (action: AddNodeAction) => void;
  /** Only the creation actions this canvas offers get a shortcut key. */
  addNodeActions?: readonly AddNodeAction[];
}) {
  const clipboard = useRef<CanvasClipboard | null>(null);

  const collectSelection = useCallback(
    (): CanvasClipboard | null =>
      collectCanvasSelection(
        getNodes().filter((node) => node.selected),
        edges
      ),
    [edges, getNodes]
  );

  const placeClone = useCallback(
    (source: CanvasClipboard | null) => {
      placeCanvasClone(source, { getNodes, addNodesAndEdges, selectNodes });
    },
    [addNodesAndEdges, getNodes, selectNodes]
  );

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;

      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && key === "c") {
        event.preventDefault();
        clipboard.current = collectSelection();
        return;
      }
      if (mod && key === "v") {
        event.preventDefault();
        placeClone(clipboard.current);
        return;
      }
      if (mod && key === "d") {
        event.preventDefault();
        placeClone(collectSelection());
        return;
      }
      if (mod || event.altKey) return;

      const shortcut = event.shiftKey ? `shift+${key}` : key;
      const action =
        addNodeActions.find((candidate) => ADD_NODE_SHORTCUTS[candidate] === shortcut) ?? null;
      if (!action) return;
      event.preventDefault();
      addNode(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addNode, addNodeActions, collectSelection, enabled, placeClone]);
}
