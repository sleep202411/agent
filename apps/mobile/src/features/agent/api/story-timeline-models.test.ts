import { beforeEach, expect, it, vi } from "vitest";
import { loadTimelineModels, timelineModelOptions } from "./story-timeline-models";
const h = vi.hoisted(() => ({ get: vi.fn(), catalog: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("@/features/ai-lab/catalog-api", async (original) => ({
  ...(await original<object>()),
  loadGenerationCatalog: h.catalog,
}));
const id = "00000000-0000-4000-8000-000000000001",
  scope = { projectId: id, chapterId: id, generation: 1 };
const model = {
  id: "image",
  name: "Image",
  type: "image" as const,
  enabled: true,
  schemaVersion: "v1",
  input_schema: {
    type: "object" as const,
    properties: {
      prompt: { type: "string" as const },
      duration: { type: "integer" as const, default: 5 },
      referenceImages: { type: "array" as const, items: { type: "string" as const } },
    },
    required: ["prompt", "duration"],
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/workbench")
      ? { project: { id, workspaceId: id, capabilities: ["story.generate"] }, chapter: { id } }
      : { projectId: id, projectKind: "story", imageModelId: "image", videoModelId: null }
  );
  h.catalog.mockResolvedValue({ catalog: { models: [model] }, rank: 0 });
});
it("loads project-scoped catalog and selects project preference", async () => {
  expect(await loadTimelineModels(scope, "image", new AbortController().signal)).toMatchObject({
    selectedId: "image",
  });
  expect(h.catalog).toHaveBeenCalledWith(1, expect.any(AbortSignal), id);
});
it("omits locked, wrong-modality and operation-only models", async () => {
  h.catalog.mockResolvedValue({
    rank: 0,
    catalog: {
      models: [
        model,
        { ...model, id: "locked", access: { allowed: false } },
        { ...model, id: "paid", access: { requiredPlan: "pro" } },
        { ...model, id: "video", type: "video" },
        { ...model, id: "panorama" },
        { ...model, id: "upscale", generationModes: ["upscale"] },
      ],
    },
  });
  expect((await loadTimelineModels(scope, "image", new AbortController().signal)).models).toEqual([
    model,
  ]);
});
it("keeps prompts/references server-owned while retaining parameter requirements", () => {
  expect(timelineModelOptions(model)).toMatchObject({
    properties: { duration: { type: "integer", default: 5 } },
    required: ["duration"],
  });
  expect(Object.keys(timelineModelOptions(model).properties)).toEqual(["duration"]);
});
it.each(["permission", "project", "chapter"])(
  "rejects invalid %s scope before loading catalog",
  async (mode) => {
    h.get.mockResolvedValue({
      project: {
        id: mode === "project" ? "00000000-0000-4000-8000-000000000002" : id,
        workspaceId: id,
        capabilities: mode === "permission" ? [] : ["story.generate"],
      },
      chapter: { id: mode === "chapter" ? "00000000-0000-4000-8000-000000000002" : id },
    });
    await expect(
      loadTimelineModels(scope, "image", new AbortController().signal)
    ).rejects.toThrow();
    expect(h.catalog).not.toHaveBeenCalled();
  }
);
it("rejects late account changes", async () => {
  h.catalog.mockImplementation(async () => {
    h.generation = 2;
    return { catalog: { models: [model] }, rank: 0 };
  });
  await expect(loadTimelineModels(scope, "image", new AbortController().signal)).rejects.toThrow(
    "expired"
  );
});

it("selects a reference-capable fallback when the preferred model cannot accept images", async () => {
  const noReference = {
    ...model,
    input_schema: {
      ...model.input_schema,
      properties: { duration: model.input_schema.properties.duration },
    },
  };
  const capable = { ...model, id: "reference" };
  h.catalog.mockResolvedValue({ rank: 0, catalog: { models: [noReference, capable] } });
  expect(
    await loadTimelineModels(scope, "image", new AbortController().signal, { imageReference: true })
  ).toEqual({ models: [capable], selectedId: "reference" });
  expect((await loadTimelineModels(scope, "image", new AbortController().signal)).selectedId).toBe(
    "image"
  );
});
it("returns no models when no entitled model supports image references", async () => {
  h.catalog.mockResolvedValue({
    rank: 0,
    catalog: {
      models: [
        { ...model, access: { allowed: false } },
        { ...model, id: "text-only", input_schema: { type: "object", properties: {} } },
      ],
    },
  });
  expect(
    await loadTimelineModels(scope, "image", new AbortController().signal, { imageReference: true })
  ).toEqual({ models: [], selectedId: "" });
});
