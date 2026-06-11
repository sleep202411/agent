"use client";

import { useCallback, useRef, useState } from "react";
import { appendDocumentPatch, getDocument, type FizzDocument } from "../../../_lib/api";
import {
  addCanvasAssetNode as addCanvasAssetNodePure,
  addCanvasEdge as addCanvasEdgePure,
  addShot as addShotPure,
  addShotAtCanvas as addShotAtCanvasPure,
  normalizeStoryboard,
  removeCanvasAssetNode as removeCanvasAssetNodePure,
  removeCanvasEdge as removeCanvasEdgePure,
  removeShot as removeShotPure,
  removeShotFromCanvas as removeShotFromCanvasPure,
  reorderShots as reorderShotsPure,
  setCanvasPositions as setCanvasPositionsPure,
  setCell as setCellPure,
  setCells as setCellsPure,
  setNodePosition as setNodePositionPure,
  setViewport as setViewportPure,
  updateCanvasAssetNode as updateCanvasAssetNodePure,
  updateShotCell as updateShotCellPure,
  type CanvasAssetNode,
  type CanvasNodePos,
  type ShotCell,
  type StoryboardContent,
} from "../_data/storyboard-schema";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Storyboard editing + persistence over a PlatformDocument.
 *
 * Edits mutate local content immediately (optimistic), then persist via a
 * debounced, SERIALIZED patch operation — only one op is ever in flight, and
 * a fresh edit during a save coalesces into the next flush. Each patch carries
 * the full `materializedContent` and the current `baseSequence`; the server
 * advances the sequence. On a sequence conflict we resync from the server.
 */
export function useStoryboard(doc: FizzDocument) {
  const [content, setContentState] = useState<StoryboardContent>(() =>
    normalizeStoryboard(doc.contentSnapshot)
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const contentRef = useRef(content);
  const seqRef = useRef(doc.currentSequence);
  const pendingRef = useRef<StoryboardContent | null>(null);
  const savingRef = useRef(false);
  const debounceRef = useRef<number | undefined>(undefined);

  const documentId = doc.id;

  // The flush callback intentionally reads mutable refs so rapid edits
  // coalesce into one serialized save queue without rebinding timers.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const flush = useCallback(async () => {
    if (savingRef.current) return;
    const next = pendingRef.current;
    if (!next) return;
    pendingRef.current = null;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const op = await appendDocumentPatch(documentId, {
        materializedContent: next,
        baseSequence: seqRef.current,
      });
      seqRef.current = op.sequence;
      setSaveState(pendingRef.current ? "saving" : "saved");
    } catch {
      // Sequence conflict or transport error — resync the sequence from the
      // server and re-queue the local content so the user's edits aren't lost.
      try {
        const fresh = await getDocument(documentId);
        seqRef.current = fresh.currentSequence;
        pendingRef.current = next;
      } catch {
        pendingRef.current = next;
      }
      setSaveState("error");
    } finally {
      savingRef.current = false;
      if (pendingRef.current) void flush();
    }
  }, [documentId]);

  const schedule = useCallback(
    (next: StoryboardContent) => {
      pendingRef.current = next;
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => void flush(), 500);
    },
    [flush]
  );

  const apply = useCallback(
    (next: StoryboardContent) => {
      contentRef.current = next;
      setContentState(next);
      schedule(next);
    },
    [schedule]
  );

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const addShot = useCallback(
    (afterShotId?: string) => apply(addShotPure(contentRef.current, afterShotId)),
    [apply]
  );
  const removeShot = useCallback(
    (shotId: string) => apply(removeShotPure(contentRef.current, shotId)),
    [apply]
  );
  const reorderShots = useCallback(
    (fromId: string, toIndex: number) =>
      apply(reorderShotsPure(contentRef.current, fromId, toIndex)),
    [apply]
  );
  const setCell = useCallback(
    (shotId: string, columnId: string, cell: ShotCell) =>
      apply(setCellPure(contentRef.current, shotId, columnId, cell)),
    [apply]
  );
  const updateShotCell = useCallback(
    (shotId: string, columnId: string, updater: (cell: ShotCell) => ShotCell) =>
      apply(updateShotCellPure(contentRef.current, shotId, columnId, updater)),
    [apply]
  );
  const setCells = useCallback(
    (shotId: string, cells: Record<string, ShotCell>) =>
      apply(setCellsPure(contentRef.current, shotId, cells)),
    [apply]
  );

  // ─── Canvas mutations ─────────────────────────────────────────────────────────

  const addShotAtCanvas = useCallback(
    (pos: CanvasNodePos): string => {
      const { content: next, shotId } = addShotAtCanvasPure(contentRef.current, pos);
      apply(next);
      return shotId;
    },
    [apply]
  );
  const setNodePosition = useCallback(
    (shotId: string, pos: CanvasNodePos) =>
      apply(setNodePositionPure(contentRef.current, shotId, pos)),
    [apply]
  );
  const setCanvasPositions = useCallback(
    (positions: Record<string, CanvasNodePos>) =>
      apply(setCanvasPositionsPure(contentRef.current, positions)),
    [apply]
  );
  const addCanvasEdge = useCallback(
    (source: string, target: string): string | null => {
      const { content: next, edgeId } = addCanvasEdgePure(contentRef.current, source, target);
      apply(next);
      return edgeId;
    },
    [apply]
  );
  const removeCanvasEdge = useCallback(
    (edgeId: string) => apply(removeCanvasEdgePure(contentRef.current, edgeId)),
    [apply]
  );
  const addCanvasAssetNode = useCallback(
    (node: Omit<CanvasAssetNode, "id">, pos: CanvasNodePos): string => {
      const { content: next, nodeId } = addCanvasAssetNodePure(contentRef.current, node, pos);
      apply(next);
      return nodeId;
    },
    [apply]
  );
  const updateCanvasAssetNode = useCallback(
    (nodeId: string, patch: Partial<Omit<CanvasAssetNode, "id" | "kind">>) =>
      apply(updateCanvasAssetNodePure(contentRef.current, nodeId, patch)),
    [apply]
  );
  const removeCanvasAssetNode = useCallback(
    (nodeId: string) => apply(removeCanvasAssetNodePure(contentRef.current, nodeId)),
    [apply]
  );
  const removeShotFromCanvas = useCallback(
    (shotId: string) => apply(removeShotFromCanvasPure(contentRef.current, shotId)),
    [apply]
  );
  const setViewport = useCallback(
    (viewport: { x: number; y: number; zoom: number }) =>
      apply(setViewportPure(contentRef.current, viewport)),
    [apply]
  );

  return {
    content,
    saveState,
    // shared
    addShot,
    removeShot,
    reorderShots,
    setCell,
    updateShotCell,
    setCells,
    // canvas
    addShotAtCanvas,
    addCanvasAssetNode,
    setNodePosition,
    setCanvasPositions,
    addCanvasEdge,
    removeCanvasEdge,
    updateCanvasAssetNode,
    removeCanvasAssetNode,
    removeShotFromCanvas,
    setViewport,
  };
}
