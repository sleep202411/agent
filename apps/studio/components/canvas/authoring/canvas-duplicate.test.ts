import { describe, expect, it, vi } from "vitest";
import { compareByOrder, orderAfter } from "@repo/shared";
import {
  cloneCanvasSelection,
  collectCanvasSelection,
  placeCanvasClone,
  type CanvasClipboard,
} from "./canvas-duplicate";
import type { CanvasEdgeShape, CanvasNodeShape } from "@/lib/canvas-core/types";

function node(
  id: string,
  type = "generate-image",
  data: Record<string, unknown> = {}
): CanvasNodeShape {
  return { id, type, position: { x: 100, y: 100 }, data };
}

function edge(id: string, source: string, target: string): CanvasEdgeShape {
  return { id, source, target, sourceHandle: "output", targetHandle: "input" };
}

function reference(edgeId: string, sourceNodeId: string, extra: Record<string, unknown> = {}) {
  return { id: edgeId, edgeId, sourceNodeId, url: "https://cdn/f.png", kind: "image", ...extra };
}

describe("collectCanvasSelection", () => {
  it("returns null for an empty selection", () => {
    expect(collectCanvasSelection([], [])).toBeNull();
  });

  it("keeps internal and incoming wires, drops outgoing wires", () => {
    const selection = [node("card"), node("source")];
    const edges = [
      edge("in", "outside", "card"),
      edge("internal", "source", "card"),
      edge("out", "card", "elsewhere"),
    ];

    const collected = collectCanvasSelection(selection, edges)!;

    expect(collected.nodes.map((n) => n.id)).toEqual(["card", "source"]);
    expect(collected.edges.map((e) => e.id)).toEqual(["in", "internal"]);
  });
});

describe("cloneCanvasSelection", () => {
  it("re-attaches incoming external wires to the original source and keeps the bound reference", () => {
    const source: CanvasClipboard = {
      nodes: [
        node("card", "generate-image", {
          references: { reference_images: [reference("in", "outside")] },
        }),
      ],
      edges: [edge("in", "outside", "card")],
    };

    const clone = cloneCanvasSelection(source, [node("outside", "image"), node("card")]);

    expect(clone.nodes).toHaveLength(1);
    const cloneCard = clone.nodes[0];
    expect(cloneCard.id).not.toBe("card");
    expect(cloneCard.position).toEqual({ x: 132, y: 132 });
    expect(clone.edges).toHaveLength(1);
    const cloneEdge = clone.edges[0];
    expect(cloneEdge.id).not.toBe("in");
    expect(cloneEdge.source).toBe("outside");
    expect(cloneEdge.target).toBe(cloneCard.id);
    const refs = (
      cloneCard.data.references as {
        reference_images: { id: string; edgeId: string; sourceNodeId: string }[];
      }
    ).reference_images;
    expect(refs).toHaveLength(1);
    expect(refs[0].edgeId).toBe(cloneEdge.id);
    expect(refs[0].sourceNodeId).toBe("outside");
  });

  it("remaps internal wires on both endpoints", () => {
    const source: CanvasClipboard = {
      nodes: [node("card"), node("source", "image")],
      edges: [edge("wire", "source", "card")],
    };

    const clone = cloneCanvasSelection(source, source.nodes);

    const cloneCard = clone.nodes.find((n) => n.data && n.type === "generate-image")!;
    const cloneSource = clone.nodes.find((n) => n.type === "image")!;
    expect(clone.edges[0].source).toBe(cloneSource.id);
    expect(clone.edges[0].target).toBe(cloneCard.id);
  });

  it("drops an external wire whose source no longer exists, together with its reference", () => {
    const source: CanvasClipboard = {
      nodes: [
        node("card", "generate-image", {
          references: { reference_images: [reference("in", "gone")] },
        }),
      ],
      edges: [edge("in", "gone", "card")],
    };

    const clone = cloneCanvasSelection(source, [node("card")]);

    expect(clone.edges).toHaveLength(0);
    expect(clone.nodes[0].data.references).toEqual({});
  });

  it("keeps a legacy reference that has no bound edge", () => {
    const source: CanvasClipboard = {
      nodes: [
        node("card", "generate-image", {
          references: {
            reference_images: [{ id: "legacy", url: "https://cdn/x.png", kind: "image" }],
          },
        }),
      ],
      edges: [],
    };

    const clone = cloneCanvasSelection(source, []);

    expect(clone.nodes[0].data.references).toEqual({
      reference_images: [expect.objectContaining({ id: expect.any(String), edgeId: undefined })],
    });
  });

  it("drops references that are still uploading", () => {
    const source: CanvasClipboard = {
      nodes: [
        node("card", "generate-image", {
          references: {
            reference_images: [reference("in", "outside", { uploading: true })],
          },
        }),
      ],
      edges: [edge("in", "outside", "card")],
    };

    const clone = cloneCanvasSelection(source, [node("outside", "image")]);

    expect(clone.edges).toHaveLength(1);
    expect(clone.nodes[0].data.references).toEqual({});
  });

  it("appends a cloned shot after the current last shot and retargets its preferred frame wire", () => {
    const firstOrder = orderAfter(null);
    const lastOrder = orderAfter(firstOrder);
    const source: CanvasClipboard = {
      nodes: [
        node("shot", "shot", {
          order: firstOrder,
          preferredFrameEdgeId: "frame-wire",
          references: { frame: [reference("frame-wire", "outside")] },
        }),
      ],
      edges: [edge("frame-wire", "outside", "shot")],
    };
    const existing = [node("outside", "image"), node("other-shot", "shot", { order: lastOrder })];

    const clone = cloneCanvasSelection(source, existing);

    const cloneShot = clone.nodes[0];
    const shotData = cloneShot.data as { order: string; preferredFrameEdgeId: string };
    expect(
      compareByOrder({ id: "clone", order: shotData.order }, { id: "clone", order: lastOrder })
    ).toBe(1);
    expect(shotData.preferredFrameEdgeId).toBe(clone.edges[0].id);
  });

  it("clears the preferred frame marker when its wire did not survive the copy", () => {
    const source: CanvasClipboard = {
      nodes: [node("shot", "shot", { order: "a0", preferredFrameEdgeId: "gone-wire" })],
      edges: [],
    };

    const clone = cloneCanvasSelection(source, []);

    expect(clone.nodes[0].data.preferredFrameEdgeId).toBeUndefined();
  });

  it("returns an empty clone for a null source", () => {
    expect(cloneCanvasSelection(null, [])).toEqual({ nodes: [], edges: [] });
  });
});

describe("placeCanvasClone", () => {
  it("writes the clone in one batch and selects the copies", () => {
    const doc = [node("outside", "image"), node("card")];
    const source = collectCanvasSelection([doc[1]], [edge("in", "outside", "card")])!;
    const addNodesAndEdges = vi.fn();
    const selectNodes = vi.fn();

    placeCanvasClone(source, { getNodes: () => doc, addNodesAndEdges, selectNodes });

    expect(addNodesAndEdges).toHaveBeenCalledTimes(1);
    const [nodes, edges] = addNodesAndEdges.mock.calls[0];
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("outside");
    expect(selectNodes).toHaveBeenCalledWith([nodes[0].id]);
  });

  it("is a no-op for an empty source", () => {
    const addNodesAndEdges = vi.fn();
    const selectNodes = vi.fn();

    placeCanvasClone(null, { getNodes: () => [], addNodesAndEdges, selectNodes });

    expect(addNodesAndEdges).not.toHaveBeenCalled();
    expect(selectNodes).not.toHaveBeenCalled();
  });
});

describe("generation ownership on duplication", () => {
  it.each(["submitting", "uncertain", "queued", "generating", "failed", "cancelled"])(
    "creates an idle video copy from a %s original without changing its job",
    (status) => {
      const data = {
        prompt: "A boat crosses the lake",
        modelId: "seedance",
        mode: "image-to-video",
        settings: { aspectRatio: "auto" },
        autoSubmit: true,
        generation: {
          status,
          jobId: "original-job",
          submissionKey: "original-receipt",
          submissionOwnerId: "owner",
          submission: { prompt: "original request" },
          progress: 20,
          etaSeconds: 315,
          error: "previous error",
        },
        references: { first_frame: [reference("input", "image-source")] },
      };
      const original = node("video-source", "video", data);
      const before = structuredClone(original);
      const source = collectCanvasSelection(
        [original],
        [edge("input", "image-source", original.id)]
      )!;
      const cloned = cloneCanvasSelection(source, [original, node("image-source", "image")]);
      expect(cloned.nodes[0].data.generation).toBeUndefined();
      expect(cloned.nodes[0].data.autoSubmit).toBeUndefined();
      expect(cloned.nodes[0].data).toMatchObject({
        prompt: data.prompt,
        modelId: data.modelId,
        mode: data.mode,
        settings: data.settings,
        references: { first_frame: [expect.objectContaining({ sourceNodeId: "image-source" })] },
      });
      expect(cloned.nodes[0].id).not.toBe(original.id);
      expect(original).toEqual(before);
    }
  );

  it.each(["prompt", "audio"])("clears auto-submit on an idle %s copy", (type) => {
    const original = node("source", type, { prompt: "draft", autoSubmit: true });
    const clone = cloneCanvasSelection(collectCanvasSelection([original], []), [original]);
    expect(clone.nodes[0].data).toEqual({ prompt: "draft" });
    expect(original.data.autoSubmit).toBe(true);
  });

  it("retains completed media as a detached result without a reusable job receipt", () => {
    const output = { type: "video", assetId: "asset", url: "https://cdn/video.mp4" };
    const original = node("source", "video", {
      generation: {
        status: "done",
        jobId: "job",
        submissionKey: "receipt",
        progress: 100,
        outputs: [output],
      },
      autoSubmit: true,
    });
    const source = collectCanvasSelection([original], [])!;
    const first = cloneCanvasSelection(source, [original]).nodes[0];
    const second = cloneCanvasSelection(source, [original]).nodes[0];
    expect(first.data.generation).toEqual({ status: "done", outputs: [output] });
    expect(first.data.autoSubmit).toBeUndefined();
    expect(second.id).not.toBe(first.id);
    expect(original.data.generation).toMatchObject({ jobId: "job", submissionKey: "receipt" });
  });

  it("does not strip unrelated node data", () => {
    const original = node("note", "note", { generation: "text metadata", autoSubmit: "text" });
    expect(
      cloneCanvasSelection(collectCanvasSelection([original], []), [original]).nodes[0].data
    ).toEqual(original.data);
  });
});
