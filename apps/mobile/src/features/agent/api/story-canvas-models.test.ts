import { loadCanvasModels } from "./story-canvas-models";
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ get: vi.fn(), catalog: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/features/ai-lab/catalog-api", () => ({ loadGenerationCatalog: h.catalog }));
const id = "00000000-0000-4000-8000-000000000001",
  workspace = "00000000-0000-4000-8000-000000000002";
const scope = { projectId: id, generation: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ id, workspaceId: workspace, capabilities: ["story.edit"] });
  h.catalog.mockResolvedValue({ catalog: { models: [] } });
});
it("uses the project's workspace without invoking generation or requiring chapter state", async () => {
  const signal = new AbortController().signal;
  const result = await loadCanvasModels(scope, signal);
  expect(h.get).toHaveBeenCalledExactlyOnceWith(`/story-projects/${id}`, {
    service: "aurora",
    signal,
    retry: false,
  });
  expect(h.catalog).toHaveBeenCalledExactlyOnceWith(1, signal, workspace);
  expect(result.defaults).toEqual({
    image: { settings: {} },
    video: { settings: {} },
    audio: { settings: {} },
  });
});
it.each(["wrong-project", "read-only", "missing-workspace"])(
  "rejects %s before loading models",
  async (failure) => {
    h.get.mockResolvedValue({
      id: failure === "wrong-project" ? workspace : id,
      workspaceId: failure === "missing-workspace" ? null : workspace,
      capabilities: failure === "read-only" ? ["story.read"] : ["story.edit"],
    });
    await expect(loadCanvasModels(scope, new AbortController().signal)).rejects.toThrow();
    expect(h.catalog).not.toHaveBeenCalled();
  }
);
it.each(["project", "catalog"])("retires account changes after %s response", async (stage) => {
  if (stage === "project")
    h.get.mockImplementation(async () => {
      h.generation++;
      return { id, workspaceId: workspace, capabilities: ["story.edit"] };
    });
  else
    h.catalog.mockImplementation(async () => {
      h.generation++;
      return { catalog: { models: [] } };
    });
  await expect(loadCanvasModels(scope, new AbortController().signal)).rejects.toThrow("expired");
});
it("does not load after cancellation or ignore a catalog failure", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(loadCanvasModels(scope, controller.signal)).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
  h.catalog.mockRejectedValue(Error("Catalog unavailable"));
  await expect(loadCanvasModels(scope, new AbortController().signal)).rejects.toThrow(
    "Catalog unavailable"
  );
});
