import { describe, expect, it, vi } from "vitest";
import { SHOT_NODE_TYPE } from "@/lib/canvas-authoring/shot-node";
import type { CanvasNodeShape } from "@/lib/canvas-core/types";
import { agentOsShotNodeId, applyAgentOsShotsToCanvas } from "./sync-shots-to-canvas";

function mockGraph(initial: CanvasNodeShape[] = []) {
  const nodes = [...initial];
  return {
    canEdit: true,
    getNodes: () => nodes,
    getNode: (id: string) => nodes.find((n) => n.id === id) ?? null,
    addNode: vi.fn((node: CanvasNodeShape) => {
      nodes.push(node);
    }),
    removeNode: vi.fn((id: string) => {
      const idx = nodes.findIndex((n) => n.id === id);
      if (idx >= 0) nodes.splice(idx, 1);
    }),
    patchNodeData: vi.fn(
      (
        id: string,
        patch: Record<string, unknown> | ((node: CanvasNodeShape) => Record<string, unknown>)
      ) => {
        const row = nodes.find((n) => n.id === id);
        if (!row) return;
        const next = typeof patch === "function" ? patch(row) : patch;
        row.data = { ...row.data, ...next };
      }
    ),
    nodes,
  };
}

describe("applyAgentOsShotsToCanvas", () => {
  it("creates shot nodes with stable agent-os ids", () => {
    const graph = mockGraph();
    const result = applyAgentOsShotsToCanvas({
      graph,
      shots: [
        { id: "s1", title: "Opening", prompt: "wide establishing" },
        { id: "s2", title: "Close-up", prompt: "eyes", notes: "rain" },
      ],
    });

    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(graph.addNode).toHaveBeenCalledTimes(2);
    expect(graph.nodes[0]?.id).toBe(agentOsShotNodeId("s1"));
    expect(graph.nodes[0]?.type).toBe(SHOT_NODE_TYPE);
    expect(graph.nodes[0]?.data.label).toBe("Opening");
    expect(graph.nodes[0]?.data.imagePrompt).toBe("wide establishing");
    expect(graph.nodes[1]?.data.notes).toBe("rain");
  });

  it("patches existing nodes instead of duplicating", () => {
    const id = agentOsShotNodeId("s1");
    const graph = mockGraph([
      {
        id,
        type: SHOT_NODE_TYPE,
        position: { x: 0, y: 0 },
        data: { label: "Old", order: "a0" },
      },
    ]);

    const result = applyAgentOsShotsToCanvas({
      graph,
      shots: [{ id: "s1", title: "New title", prompt: "new prompt" }],
    });

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(graph.addNode).not.toHaveBeenCalled();
    expect(graph.nodes[0]?.data.label).toBe("New title");
    expect(graph.nodes[0]?.data.imagePrompt).toBe("new prompt");
  });

  it("prunes agent-os shot nodes missing from the domain list", () => {
    const keepId = agentOsShotNodeId("s1");
    const dropId = agentOsShotNodeId("s2");
    const graph = mockGraph([
      {
        id: keepId,
        type: SHOT_NODE_TYPE,
        position: { x: 0, y: 0 },
        data: { label: "Keep", order: "a0", imagePrompt: "a", description: "a", notes: "" },
      },
      {
        id: dropId,
        type: SHOT_NODE_TYPE,
        position: { x: 300, y: 0 },
        data: { label: "Drop", order: "a0V", imagePrompt: "b", description: "b", notes: "" },
      },
    ]);

    const result = applyAgentOsShotsToCanvas({
      graph,
      shots: [{ id: "s1", title: "Keep", prompt: "a" }],
    });

    expect(result.removed).toBe(1);
    expect(graph.removeNode).toHaveBeenCalledWith(dropId);
    expect(graph.nodes.map((n) => n.id)).toEqual([keepId]);
  });

  it("does not count unchanged shots as updated", () => {
    const id = agentOsShotNodeId("s1");
    const graph = mockGraph([
      {
        id,
        type: SHOT_NODE_TYPE,
        position: { x: 0, y: 0 },
        data: {
          label: "Opening",
          imagePrompt: "wide",
          description: "wide",
          notes: "",
          agentOsShotId: "s1",
          order: "a0",
        },
      },
    ]);

    const result = applyAgentOsShotsToCanvas({
      graph,
      shots: [{ id: "s1", title: "Opening", prompt: "wide" }],
    });

    expect(result).toEqual({ created: 0, updated: 0, removed: 0, nodeIds: [id] });
    expect(graph.patchNodeData).not.toHaveBeenCalled();
  });

  it("no-ops when cannot edit", () => {
    const graph = { ...mockGraph(), canEdit: false };
    const result = applyAgentOsShotsToCanvas({
      graph,
      shots: [{ id: "s1", title: "X", prompt: "Y" }],
    });
    expect(result).toEqual({ created: 0, updated: 0, removed: 0, nodeIds: [] });
    expect(graph.addNode).not.toHaveBeenCalled();
  });
});
