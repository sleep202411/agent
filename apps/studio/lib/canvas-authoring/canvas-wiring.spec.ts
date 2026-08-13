import { describe, expect, it, vi } from "vitest";
import type { FizzAiModel } from "./generation-api";
import { connectNodes, validateCanvasConnection, type WiringCtx } from "./canvas-wiring";

const seedance: FizzAiModel = {
  id: "seedance-2.0",
  type: "video",
  name: "Seedance 2.0",
  enabled: true,
  schemaVersion: "1",
  generationModes: ["image_to_video", "multimodal_to_video"],
  input_schema: {
    type: "object",
    properties: {
      startFrame: {
        type: "string",
        "x-ui": { control: "image_upload", mediaKind: "image" },
      },
      referenceImages: {
        type: "array",
        maxItems: 9,
        "x-ui": { control: "image_upload", mediaKind: "image" },
      },
    },
  },
};

function harness(referenceCount: number) {
  const source = {
    type: "image",
    data: { src: "https://assets.test/source.png" },
  };
  const target = {
    type: "video",
    data: {
      modelId: seedance.id,
      mode: "multimodal_to_video",
      references: {
        referenceImages: Array.from({ length: referenceCount }, (_, index) => ({
          id: `edge-${index}`,
          edgeId: `edge-${index}`,
          sourceNodeId: `source-${index}`,
          kind: "image" as const,
          url: `https://assets.test/${index}.png`,
        })),
      },
    },
  };
  const nodes = new Map<string, typeof source | typeof target>([
    ["source", source],
    ["target", target],
  ]);
  const addEdge = vi.fn();
  const patchNodeData = vi.fn();
  const removeEdge = vi.fn();
  const ctx = {
    getNode: (id: string) => nodes.get(id),
    getEdges: () => [],
    catalog: { models: [seedance] },
    graph: { addEdge, patchNodeData, removeEdge },
  } as unknown as WiringCtx;
  return { ctx, addEdge, patchNodeData, target };
}

describe("atomic canvas reference wiring", () => {
  it("does not create an edge when the current mode is full", () => {
    const { ctx, addEdge, patchNodeData } = harness(9);

    expect(() => connectNodes(ctx, "source", "target")).toThrow(
      "The current mode accepts at most 9 image references."
    );
    expect(addEdge).not.toHaveBeenCalled();
    expect(patchNodeData).not.toHaveBeenCalled();
  });

  it("binds a valid edge without changing the target mode", () => {
    const { ctx, addEdge, patchNodeData, target } = harness(8);

    connectNodes(ctx, "source", "target");

    expect(addEdge).toHaveBeenCalledOnce();
    expect(patchNodeData).toHaveBeenCalledOnce();
    const update = patchNodeData.mock.calls[0]?.[1] as (
      node: typeof target
    ) => Record<string, unknown>;
    const patch = update(target);
    expect(patch).not.toHaveProperty("mode");
    expect((patch.references as { referenceImages: unknown[] }).referenceImages).toHaveLength(9);
  });

  it("carries generated media facts into the bound reference", () => {
    const source = {
      type: "prompt",
      data: {
        generation: {
          status: "done",
          outputs: [
            {
              type: "image",
              url: "https://assets.test/generated.png",
              assetId: "asset-1",
              durationSeconds: 5,
              bytes: 2_097_152,
              width: 1920,
              height: 1080,
            },
          ],
        },
      },
    };
    const target = {
      type: "video",
      data: { modelId: seedance.id, mode: "multimodal_to_video", references: {} },
    };
    const nodes = new Map<string, typeof source | typeof target>([
      ["source", source],
      ["target", target],
    ]);
    const patchNodeData = vi.fn();
    const ctx = {
      getNode: (id: string) => nodes.get(id),
      getEdges: () => [],
      catalog: { models: [seedance] },
      graph: { addEdge: vi.fn(), patchNodeData, removeEdge: vi.fn() },
    } as unknown as WiringCtx;

    connectNodes(ctx, "source", "target");

    const update = patchNodeData.mock.calls[0]?.[1] as (
      node: typeof target
    ) => Record<string, unknown>;
    const references = update(target).references as {
      referenceImages: Array<Record<string, unknown>>;
    };
    expect(references.referenceImages[0]).toMatchObject({
      assetId: "asset-1",
      durationSeconds: 5,
      bytes: 2_097_152,
      width: 1920,
      height: 1080,
    });
  });

  it("reserves capacity for connected sources that have not generated yet", () => {
    const pendingSources = Array.from({ length: 9 }, (_, index) => `pending-${index}`);
    const target = {
      type: "video",
      data: { modelId: seedance.id, mode: "multimodal_to_video", references: {} },
    };
    const nodes = new Map<string, { type: string; data: Record<string, unknown> }>([
      ["candidate", { type: "prompt", data: {} }],
      ["target", target],
      ...pendingSources.map(
        (id) =>
          [id, { type: "prompt", data: {} }] as [
            string,
            { type: string; data: Record<string, unknown> },
          ]
      ),
    ]);

    expect(
      validateCanvasConnection(
        {
          getNode: (id) => nodes.get(id),
          getEdges: () =>
            pendingSources.map((source, index) => ({
              id: `pending-edge-${index}`,
              source,
              target: "target",
            })),
          catalog: { models: [seedance] },
        },
        "candidate",
        "target"
      )
    ).toEqual({
      ok: false,
      issue: { code: "reference_limit", kind: "image", limit: 9 },
    });
  });
});
