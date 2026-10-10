import { beforeEach, expect, it, vi } from "vitest";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import { loadCanvasReferenceTarget } from "./canvas-reference-target";
const h = vi.hoisted(() => ({ load: vi.fn(), generation: 1 }));
vi.mock("@/features/ai-lab/catalog-api", () => ({ loadCanvasReferenceCatalog: h.load }));
vi.mock("@/features/ai-lab/jobs-api", () => ({
  generationSession: (generation: number, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (generation !== h.generation) throw Error("Session expired");
  },
}));
const scope = {
  kind: "platform" as const,
  projectId: "project",
  workspaceId: "workspace",
  sectionId: "section",
  documentId: "document",
  generation: 1,
};
const loaded = (): CanvasLoaded => ({
  type: "loaded",
  sessionId: "session",
  requestId: 1,
  documentId: "document",
  sequence: 1,
  state: "AAA=",
  snapshot: {
    meta: {},
    groups: {},
    assets: {},
    edges: {},
    nodes: {
      target: { id: "target", type: "prompt", data: { modelId: "model", mode: "image_to_image" } },
    },
  },
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.load.mockResolvedValue({
    models: [
      {
        id: "model",
        generationModes: ["text_to_image", "image_to_image"],
        input_schema: {
          type: "object",
          properties: {
            images: {
              type: "array",
              maxItems: 3,
              items: { type: "string", format: "uri" },
              "x-ui": { control: "image_upload" },
            },
            prompt: { type: "string" },
          },
        },
      },
    ],
  });
});
it("uses the platform workspace catalog and resolves current-mode slots", async () => {
  const signal = new AbortController().signal;
  expect(await loadCanvasReferenceTarget(scope, loaded(), "target", signal)).toEqual({
    modelId: "model",
    mode: "image_to_image",
    fields: [{ field: "images", kind: "image", maxItems: 3 }],
  });
  expect(h.load).toHaveBeenCalledWith(1, signal, "workspace");
});
it("keeps Story catalog selection and does not switch text-only modes automatically", async () => {
  const value = loaded();
  (value.snapshot.nodes.target as { data: { mode: string } }).data.mode = "text_to_image";
  const signal = new AbortController().signal;
  expect(
    await loadCanvasReferenceTarget(
      { projectId: "project", documentId: "document", generation: 1 },
      value,
      "target",
      signal
    )
  ).toEqual({ modelId: "model", mode: "text_to_image", fields: [] });
  expect(h.load).toHaveBeenCalledWith(1, signal, undefined);
});
it("rejects mismatched documents before catalog access, unavailable models and expired responses", async () => {
  const signal = new AbortController().signal;
  await expect(
    loadCanvasReferenceTarget(scope, { ...loaded(), documentId: "other" }, "target", signal)
  ).rejects.toThrow("mismatch");
  expect(h.load).not.toHaveBeenCalled();
  h.load.mockResolvedValueOnce({ models: [] });
  await expect(loadCanvasReferenceTarget(scope, loaded(), "target", signal)).rejects.toThrow(
    "available model"
  );
  h.load.mockImplementationOnce(async () => {
    h.generation = 2;
    return { models: [] };
  });
  await expect(loadCanvasReferenceTarget(scope, loaded(), "target", signal)).rejects.toThrow(
    "Session expired"
  );
});
