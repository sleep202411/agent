"use client";

/**
 * Client-side executor for the copilot's canvas tools (P2a).
 *
 * The server declares these tools with no `execute`, so each call is forwarded
 * to the browser; `runTool` runs it against the LIVE Yjs graph via the canvas
 * mutators (the same path a human button click uses → auto-persist + collab +
 * undo for free). Inputs are re-validated here (they crossed the LLM boundary).
 * `buildGraphDigest` produces the per-turn canvas summary sent as context.
 *
 * P2b will add connect_nodes / run_generation / remove_* (with confirmations).
 */
import { useCallback } from "react";
import { useReactFlow, type Node } from "@xyflow/react";
import { useCanvasGraphContext } from "@/lib/collab/canvas-graph-context";
import { useAiCatalog, usableModelsByModality } from "@/app/[locale]/canvas/_lib/use-ai-catalog";
import { useGeneration } from "@/app/[locale]/canvas/_lib/use-canvas-generation";
import {
  connectNodes,
  removeEdgeById,
  removeNodeCascade,
} from "@/app/[locale]/canvas/_lib/canvas-wiring";
import {
  canvasDefaultMode,
  canvasDefaultModel,
  defaultSettingsForModel,
  mergeCompatibleSettings,
  type ModelSettings,
} from "@/app/[locale]/canvas/_lib/generation-api";
import type { GenerationNodeData } from "@/app/[locale]/canvas/_components/generation-card";

const MAX_DIGEST_NODES = 40;
const MAX_DIGEST_MODELS = 60;

/** Tools that must be user-confirmed before they run (spending / destructive). */
export const CONFIRM_TOOLS = new Set(["run_generation", "remove_node", "remove_edge"]);

function nodeLabel(node: Node): string | undefined {
  const data = node.data as Record<string, unknown> | undefined;
  if (!data) return undefined;
  if (typeof data.name === "string" && data.name) return data.name;
  if (typeof data.prompt === "string" && data.prompt) return data.prompt.slice(0, 80);
  if (typeof data.text === "string" && data.text) return data.text.slice(0, 80);
  return undefined;
}

export function useCopilotTools() {
  const graph = useCanvasGraphContext();
  const rf = useReactFlow();
  const { data: catalog } = useAiCatalog();
  const generation = useGeneration();

  const buildGraphDigest = useCallback((): string => {
    const all = rf.getNodes();
    const nodes = all.slice(0, MAX_DIGEST_NODES).map((n) => ({
      id: n.id,
      type: n.type ?? "",
      label: nodeLabel(n),
      selected: n.selected || undefined,
    }));
    return JSON.stringify(
      all.length > MAX_DIGEST_NODES ? { nodes, more: all.length - MAX_DIGEST_NODES } : { nodes }
    );
  }, [rf]);

  const buildModelsDigest = useCallback((): string => {
    const models = [
      ...usableModelsByModality(catalog, "image"),
      ...usableModelsByModality(catalog, "video"),
    ]
      .slice(0, MAX_DIGEST_MODELS)
      .map((m) => ({ id: m.id, name: m.name, type: m.type }));
    return JSON.stringify({ models });
  }, [catalog]);

  const runTool = useCallback(
    async (name: string, rawInput: unknown): Promise<unknown> => {
      const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<
        string,
        unknown
      >;

      switch (name) {
        case "query_graph": {
          const nodes = rf
            .getNodes()
            .slice(0, MAX_DIGEST_NODES)
            .map((n) => ({ id: n.id, type: n.type ?? "", label: nodeLabel(n) }));
          return { nodes };
        }

        case "add_node": {
          if (!graph.canEdit) throw new Error("The canvas is read-only.");
          const kind = input.kind;
          if (kind !== "image" && kind !== "video" && kind !== "note") {
            throw new Error('kind must be "image", "video", or "note"');
          }
          const prompt = typeof input.prompt === "string" ? input.prompt : "";
          const label = typeof input.label === "string" ? input.label : undefined;
          const modelId = typeof input.modelId === "string" ? input.modelId : undefined;

          const id = crypto.randomUUID();
          const count = rf.getNodes().length;
          // Center in the canvas area NOT covered by the open copilot panel (380px, right).
          const COPILOT_PANEL_WIDTH = 380;
          const position = rf.screenToFlowPosition({
            x: Math.max(0, window.innerWidth - COPILOT_PANEL_WIDTH) / 2,
            y: window.innerHeight / 2,
          });
          const nudge = (count % 6) * 26;
          position.x += nudge;
          position.y += nudge;

          if (kind === "note") {
            graph.addNode({ id, type: "note", position, data: { text: prompt } });
          } else {
            const data: Record<string, unknown> = { prompt };
            if (label) data.name = label;
            // Seed the model synchronously (named one, else the studio default)
            // so the card is generation-ready immediately. Don't rely on the
            // card's on-mount auto-fill — it runs a render later, which races a
            // same-turn run_generation.
            const modality = kind === "video" ? "video" : "image";
            const named = modelId ? catalog?.models.find((m) => m.id === modelId) : undefined;
            const model = named ?? canvasDefaultModel(catalog, modality);
            if (model) {
              data.modelId = model.id;
              data.modelName = model.name;
              data.mode = canvasDefaultMode(model);
              data.settings = defaultSettingsForModel(model);
            }
            graph.addNode({ id, type: kind === "video" ? "video" : "prompt", position, data });
          }
          graph.selectNodes([id]);
          return { ok: true, nodeId: id };
        }

        case "edit_node_params": {
          if (!graph.canEdit) throw new Error("The canvas is read-only.");
          const nodeId = typeof input.nodeId === "string" ? input.nodeId : "";
          if (!nodeId) throw new Error("nodeId is required");
          // Re-read live from the doc: reflects same-turn writes AND any change a
          // collaborator made since the digest.
          const node = graph.getNode(nodeId);
          if (!node) throw new Error(`No node with id ${nodeId} on the canvas.`);
          const patch: Record<string, unknown> = {};
          if (typeof input.prompt === "string") patch.prompt = input.prompt;
          if (typeof input.modelId === "string" && input.modelId) {
            const model = catalog?.models.find((m) => m.id === input.modelId);
            if (model) {
              patch.modelId = model.id;
              patch.modelName = model.name;
              patch.mode = canvasDefaultMode(model);
              const prev = (node.data as { settings?: ModelSettings } | undefined)?.settings ?? {};
              patch.settings = mergeCompatibleSettings(model, prev);
            }
          }
          if (Object.keys(patch).length === 0) {
            throw new Error("Nothing to change (provide a prompt and/or modelId).");
          }
          graph.patchNodeData(nodeId, patch);
          return { ok: true };
        }

        case "select": {
          const ids = Array.isArray(input.nodeIds)
            ? input.nodeIds.filter((x): x is string => typeof x === "string")
            : [];
          graph.selectNodes(ids);
          return { ok: true };
        }

        case "connect_nodes": {
          if (!graph.canEdit) throw new Error("The canvas is read-only.");
          const sourceId = typeof input.sourceId === "string" ? input.sourceId : "";
          const targetId = typeof input.targetId === "string" ? input.targetId : "";
          const { edgeId } = connectNodes(
            { getNode: graph.getNode, catalog, graph },
            sourceId,
            targetId
          );
          return { ok: true, edgeId };
        }

        case "run_generation": {
          // Confirmation is gated in the panel (CONFIRM_TOOLS) before this runs.
          if (!graph.canEdit) throw new Error("The canvas is read-only.");
          const nodeId = typeof input.nodeId === "string" ? input.nodeId : "";
          const node = graph.getNode(nodeId);
          if (!node) throw new Error(`No node with id ${nodeId}.`);
          if (node.type !== "prompt" && node.type !== "video") {
            throw new Error("Only an image or video generation card can run a generation.");
          }
          // add_node auto-fills the default model on mount; by a later tool step
          // it's set. If it's genuinely missing, ask the model to set one first.
          if (!(node.data as GenerationNodeData).modelId) {
            throw new Error("This card has no model yet — set a model (edit_node_params) first.");
          }
          generation.submit(nodeId);
          return { ok: true };
        }

        case "cancel_generation": {
          if (!graph.canEdit) throw new Error("The canvas is read-only.");
          const nodeId = typeof input.nodeId === "string" ? input.nodeId : "";
          const node = graph.getNode(nodeId);
          const gen = (node?.data as GenerationNodeData | undefined)?.generation;
          if (!gen?.jobId) {
            throw new Error("Nothing to cancel — that card has no active generation.");
          }
          generation.cancel(nodeId);
          return { ok: true };
        }

        case "remove_node": {
          if (!graph.canEdit) throw new Error("The canvas is read-only.");
          const nodeId = typeof input.nodeId === "string" ? input.nodeId : "";
          const node = graph.getNode(nodeId);
          if (!node) throw new Error(`No node with id ${nodeId}.`);
          // Cancel any in-flight job first so a deleted card doesn't keep spending.
          if ((node.data as GenerationNodeData).generation?.jobId) generation.cancel(nodeId);
          // Cascade: remove touching edges + strip the references they bound.
          removeNodeCascade({ getEdges: rf.getEdges, graph }, nodeId);
          return { ok: true };
        }

        case "remove_edge": {
          if (!graph.canEdit) throw new Error("The canvas is read-only.");
          const edgeId = typeof input.edgeId === "string" ? input.edgeId : "";
          if (!edgeId) throw new Error("edgeId is required.");
          // Also strip the reference this wire bound on its target card.
          removeEdgeById({ getEdges: rf.getEdges, graph }, edgeId);
          return { ok: true };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    },
    [graph, rf, catalog, generation]
  );

  return { runTool, buildGraphDigest, buildModelsDigest };
}
