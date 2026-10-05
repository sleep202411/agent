"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Node } from "@xyflow/react";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import {
  useProjectContext,
  useProjectPayerWorkspace,
} from "@/app/[locale]/project/_components/project-context";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  canvasDefaultMode,
  canvasDefaultModel,
  defaultSettingsForModel,
  isTerminalGenerationStatus,
  type FizzAiReferenceKind,
  type GenerationState,
} from "@/lib/canvas-authoring/generation-api";
import {
  connectNodes,
  removeEdgeById,
  removeNodeCascade,
  sourceMediaUrl,
  sourceOutputKind,
} from "@/lib/canvas-authoring/canvas-wiring";
import {
  SHOT_NODE_TYPE,
  SHOT_NODE_WIDTH,
  shotNodeData,
  shotOrderBetween,
  sortedShots,
  type ShotNodeData,
} from "@/lib/canvas-authoring/shot-node";
import type { CardReferences } from "@/components/canvas/authoring/reference-stack";

/** Where a new shot lands on the canvas: the film strip grows to the right. */
const SHOT_STRIP_GAP = 64;
/** A generation card sits to the LEFT of the shot it feeds, stacked per slot. */
const SOURCE_GAP_X = 96;
const SOURCE_WIDTH = 300;
const SOURCE_STACK_Y = 108;
const NEW_STRIP_OFFSET_Y = 240;

export type ShotPictureStatus = "ready" | "running" | "failed" | "empty";

/** What a picture source is born holding, when the caller already knows it. */
export interface ShotPictureSeed {
  prompt?: string;
  modelId?: string;
  mode?: string;
  settings?: Record<string, unknown>;
}

export interface ShotPicture {
  edgeId: string;
  sourceNodeId: string;
  /** A generation card feeding this slot can be composed from the table. */
  generationModality: "image" | "video" | null;
  kind: FizzAiReferenceKind | undefined;
  url: string | undefined;
  status: ShotPictureStatus;
  error?: string;
}

export interface ShotRow {
  id: string;
  /** 1-based row number — derived from the order, never stored. */
  number: number;
  order: string | undefined;
  data: ShotNodeData;
  pictures: ShotPicture[];
  /** The edge id of the frame reference marked 定稿; absent → first frame. */
  preferredFrameEdgeId?: string;
}

export interface CanvasSource {
  nodeId: string;
  kind: FizzAiReferenceKind;
  url: string;
  label: string;
}

function pictureStatus(generation: GenerationState | undefined, url: string | undefined) {
  if (generation && !isTerminalGenerationStatus(generation.status)) return "running" as const;
  if (generation?.status === "failed") return "failed" as const;
  return url ? ("ready" as const) : ("empty" as const);
}

/**
 * The storyboard's read model + write actions over the SAME canvas document the
 * board mode renders — rows are the canvas's `shot` nodes, pictures are the
 * wires feeding them. Every write is an ordinary canvas mutation, so a change
 * made here shows up on the canvas (and on a collaborator's screen) with no
 * conversion step and no second source of truth.
 */
export function useStoryboard() {
  const t = useTranslations("canvas");
  const graph = useCanvasGraphContext();
  const { catalog: projectCatalog } = useProjectContext();
  const catalog = projectCatalog.data;
  const workspaceId = useProjectPayerWorkspace()?.id ?? null;
  const {
    nodes,
    edges,
    addNode,
    addEdge,
    addAssets,
    getEdges,
    getNode,
    patchNodeData,
    removeEdge,
    removeNode,
    canEdit,
  } = graph;

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const readNode = useCallback((id: string) => nodeById.get(id) ?? null, [nodeById]);

  const rows = useMemo<ShotRow[]>(() => {
    const incoming = new Map<string, typeof edges>();
    for (const edge of edges) {
      if (!edge.target) continue;
      const list = incoming.get(edge.target);
      if (list) list.push(edge);
      else incoming.set(edge.target, [edge]);
    }
    return sortedShots(nodes).map((node, index) => {
      const data = shotNodeData(node);
      const references: CardReferences = data.references ?? {};
      const bound = new Map(
        Object.values(references)
          .flat()
          .flatMap((reference) =>
            reference?.edgeId ? [[reference.edgeId, reference] as const] : []
          )
      );
      const pictures = (incoming.get(node.id) ?? [])
        .map((edge): ShotPicture => {
          const source = readNode(edge.source);
          const generation = (source?.data as { generation?: GenerationState } | undefined)
            ?.generation;
          const kind = sourceOutputKind(readNode, edge.source);
          const url = bound.get(edge.id)?.url ?? sourceMediaUrl(readNode, edge.source);
          return {
            edgeId: edge.id,
            sourceNodeId: edge.source,
            generationModality:
              source?.type === "prompt" ? "image" : source?.type === "video" ? "video" : null,
            kind,
            url,
            status: pictureStatus(generation, url),
            ...(generation?.status === "failed" && generation.error
              ? { error: generation.error }
              : {}),
          };
        })
        // Frame (still) before clip (motion) — the order the slots read in.
        .sort((left, right) => (left.kind === right.kind ? 0 : left.kind === "image" ? -1 : 1));
      return {
        id: node.id,
        number: index + 1,
        order: data.order,
        data,
        pictures,
        preferredFrameEdgeId: data.preferredFrameEdgeId,
      };
    });
  }, [edges, nodes, readNode]);

  /** Media already on the canvas that a shot could take as its picture. */
  const canvasSources = useMemo<CanvasSource[]>(
    () =>
      nodes
        .map((node): CanvasSource | null => {
          if (node.type === SHOT_NODE_TYPE) return null;
          const kind = sourceOutputKind(readNode, node.id);
          const url = sourceMediaUrl(readNode, node.id);
          if (!kind || !url || url.startsWith("blob:")) return null;
          const data = node.data as { label?: string; name?: string; prompt?: string };
          return {
            nodeId: node.id,
            kind,
            url,
            label: (data.label ?? data.name ?? data.prompt ?? node.id).slice(0, 60),
          };
        })
        .filter((source): source is CanvasSource => source !== null),
    [nodes, readNode]
  );

  const shotStripPosition = useCallback((): { x: number; y: number } => {
    const shots = sortedShots(nodes);
    const rightmost = shots.reduce<Node | null>(
      (best, node) => (!best || node.position.x > best.position.x ? node : best),
      null
    );
    if (rightmost) {
      return {
        x: rightmost.position.x + SHOT_NODE_WIDTH + SHOT_STRIP_GAP,
        y: rightmost.position.y,
      };
    }
    // First shot on this canvas: start a fresh strip clear of what's there.
    if (nodes.length === 0) return { x: 0, y: 0 };
    const left = Math.min(...nodes.map((node) => node.position.x));
    const bottom = Math.max(
      ...nodes.map((node) => node.position.y + (node.measured?.height ?? 200))
    );
    return { x: left, y: bottom + NEW_STRIP_OFFSET_Y };
  }, [nodes]);

  /** Insert a shot at `index` in the current row order (append when at the end). */
  const insertShot = useCallback(
    (index: number): string | null => {
      if (!canEdit) return null;
      const id = crypto.randomUUID();
      addNode({
        id,
        type: SHOT_NODE_TYPE,
        position: shotStripPosition(),
        data: { order: shotOrderBetween(rows[index - 1]?.order, rows[index]?.order) },
      });
      return id;
    },
    [addNode, canEdit, rows, shotStripPosition]
  );

  const patchShot = useCallback(
    (id: string, patch: Partial<ShotNodeData>) => {
      patchNodeData(id, patch as Record<string, unknown>);
    },
    [patchNodeData]
  );

  const deleteShot = useCallback(
    (id: string) => {
      removeNodeCascade({ getEdges, graph: { removeEdge, removeNode, patchNodeData } }, id);
    },
    [getEdges, patchNodeData, removeEdge, removeNode]
  );

  /**
   * Move a shot to a position in the board, writing ONE key: it takes a
   * fractional index between its new neighbours. No other row is touched, so
   * two people reordering different rows never fight — and the shot numbers
   * everyone sees re-derive from the new order with zero extra writes.
   *
   * `index` is the destination in the CURRENT list (drag-and-drop semantics):
   * neighbours are resolved after removing the moved row, which is what makes
   * the same call correct whether it travels up or down.
   */
  const moveShotToIndex = useCallback(
    (shotId: string, index: number) => {
      const remaining = rows.filter((row) => row.id !== shotId);
      const target = Math.max(0, Math.min(index, remaining.length));
      const order = shotOrderBetween(remaining[target - 1]?.order, remaining[target]?.order);
      if (order === rows.find((row) => row.id === shotId)?.order) return;
      patchShot(shotId, { order });
    },
    [patchShot, rows]
  );

  /** Wire an existing canvas node into a shot, exactly as dragging a wire does. */
  const attachSource = useCallback(
    (shotId: string, sourceNodeId: string): boolean => {
      if (!canEdit) return false;
      try {
        connectNodes(
          {
            getNode,
            getEdges,
            catalog,
            graph: { addEdge, patchNodeData, removeEdge },
          },
          sourceNodeId,
          shotId
        );
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [addEdge, canEdit, catalog, getEdges, getNode, patchNodeData, removeEdge]
  );

  const detachPicture = useCallback(
    (shotId: string, edgeId: string) => {
      if (!canEdit) return;
      removeEdgeById(
        { getEdges, graph: { removeEdge, removeNode, patchNodeData } },
        edgeId,
        shotId
      );
      // If the removed wire was the 定稿, clear the pointer so it doesn't dangle
      // — preferredFrameReference will fall back to the first remaining frame.
      const data = shotNodeData(getNode(shotId));
      if (data.preferredFrameEdgeId === edgeId) {
        patchNodeData(shotId, { preferredFrameEdgeId: undefined });
      }
    },
    [canEdit, getEdges, getNode, patchNodeData, removeEdge, removeNode]
  );

  /**
   * Mark one frame reference as the 定稿 (the shot's cover). Clears it when the
   * caller passes undefined (revert to "first frame wins").
   */
  const setPreferredFrame = useCallback(
    (shotId: string, edgeId: string | undefined) => {
      patchNodeData(shotId, { preferredFrameEdgeId: edgeId });
    },
    [patchNodeData]
  );

  /**
   * Upload a local file straight into a shot's slot.
   *
   * A picture is always a WIRE, so the upload lands on the canvas as a real
   * media node (exactly what dropping the file on the board would create) and is
   * then connected — the storyboard never invents a picture the canvas can't
   * show. The file also joins the project's asset library, like every other
   * upload.
   */
  const uploadPictureSource = useCallback(
    async (
      shotId: string,
      file: File,
      kind: "image" | "video",
      onProgress?: (progress: number) => void
    ): Promise<void> => {
      if (!canEdit) return;
      const shot = getNode(shotId);
      if (!shot) return;
      const uploaded = await uploadFileViaSignedUrl(file, {
        kind: kind === "video" ? "ai_reference_video" : "ai_reference_image",
        ...(workspaceId ? { workspaceId } : {}),
        onProgress,
      });
      const id = crypto.randomUUID();
      const ordinal = getEdges().filter((edge) => edge.target === shotId).length;
      addNode({
        id,
        type: kind === "video" ? "videoAsset" : "image",
        position: {
          x: shot.position.x - SOURCE_WIDTH - SOURCE_GAP_X,
          y: shot.position.y + ordinal * SOURCE_STACK_Y,
        },
        data: { src: uploaded.url, mediaAssetId: uploaded.mediaAssetId, label: file.name },
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
      connectNodes(
        {
          getNode,
          getEdges,
          catalog,
          graph: { addEdge, patchNodeData, removeEdge },
        },
        id,
        shotId
      );
    },
    [
      addAssets,
      addEdge,
      addNode,
      canEdit,
      catalog,
      getEdges,
      getNode,
      patchNodeData,
      removeEdge,
      workspaceId,
    ]
  );

  /**
   * Create the generation card that will produce a shot's picture and wire it
   * in. The job itself runs on the ordinary canvas generation path; when it
   * finishes, the completion back-fill binds the output into the shot's slot —
   * which is why the table needs no generation code of its own.
   */
  const createPictureSource = useCallback(
    (shotId: string, modality: "image" | "video", seed?: ShotPictureSeed): string | null => {
      if (!canEdit) return null;
      const shot = getNode(shotId);
      if (!shot) return null;
      const id = crypto.randomUUID();
      const nodeType = modality === "image" ? "prompt" : "video";
      // The seed is what the storyboard drawer already had on screen — a card
      // created from a filled-in form must arrive holding those values, not
      // defaults the user then has to re-enter.
      const model =
        (seed?.modelId ? catalog?.models.find((m) => m.id === seed.modelId) : undefined) ??
        canvasDefaultModel(catalog, modality);
      const ordinal = getEdges().filter((edge) => edge.target === shotId).length;
      addNode({
        id,
        type: nodeType,
        position: {
          x: shot.position.x - SOURCE_WIDTH - SOURCE_GAP_X,
          y: shot.position.y + ordinal * SOURCE_STACK_Y,
        },
        data: {
          modelId: model?.id,
          modelName: model?.name,
          mode: seed?.mode ?? canvasDefaultMode(model),
          settings: seed?.settings ?? defaultSettingsForModel(model),
          references: {},
          prompt: seed?.prompt ?? "",
          name: t(modality === "image" ? "imageCardName" : "videoCardName", {
            index: nodes.filter((node) => node.type === nodeType).length + 1,
          }),
        },
      });
      try {
        connectNodes(
          {
            getNode,
            getEdges,
            catalog,
            graph: { addEdge, patchNodeData, removeEdge },
          },
          id,
          shotId
        );
      } catch (error) {
        removeNode(id);
        toast.error(error instanceof Error ? error.message : String(error));
        return null;
      }
      // "Make this shot move": a video source for a shot that already has a
      // frame is fed by that frame, exactly as dragging the wire by hand would.
      // Silently skipped when the chosen model takes no image input.
      if (modality === "video") {
        const frame = rows
          .find((row) => row.id === shotId)
          ?.pictures.find((picture) => picture.kind === "image" && picture.url);
        if (frame) {
          try {
            connectNodes(
              {
                getNode,
                getEdges,
                catalog,
                graph: { addEdge, patchNodeData, removeEdge },
              },
              frame.sourceNodeId,
              id
            );
          } catch {
            /* the card still exists; the user can wire it on the canvas */
          }
        }
      }
      return id;
    },
    [
      addEdge,
      addNode,
      canEdit,
      catalog,
      getEdges,
      getNode,
      nodes,
      patchNodeData,
      removeEdge,
      removeNode,
      rows,
      t,
    ]
  );

  return {
    rows,
    canvasSources,
    canEdit,
    insertShot,
    patchShot,
    deleteShot,
    moveShotToIndex,
    attachSource,
    detachPicture,
    createPictureSource,
    uploadPictureSource,
    setPreferredFrame,
  };
}
