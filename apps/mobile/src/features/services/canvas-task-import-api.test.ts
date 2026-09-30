import { beforeEach, expect, it, vi } from "vitest";
import {
  applyCanvasTaskImport,
  canvasProjectId,
  fetchCanvasTaskPreview,
} from "./canvas-task-import-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
const id = "11111111-1111-4111-8111-111111111111";
const preview = {
  crewId: "crew",
  projectId: id,
  title: "Canvas",
  sourceRevision: 4,
  sourceHash: "a".repeat(64),
  plotTree: { nodes: [{ id: "scene", type: "scene", content: { title: "Opening" } }] },
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(preview);
  h.post.mockResolvedValue({ taskIds: [id], replayed: false });
});
it("accepts localized Studio canvas links only in the selected region", () => {
  expect(
    canvasProjectId(
      `https://studio.fizzdragon.com/en-US/story-studio/projects/${id}/canvas?node=scene`,
      "global"
    )
  ).toBe(id);
  expect(
    canvasProjectId(`https://studio.fizzspace.cn/story-studio/projects/${id}/canvas`, "cn")
  ).toBe(id);
  expect(
    canvasProjectId(`https://studio.fizzdragon.com/story-studio/projects/${id}/canvas`, "cn")
  ).toBeNull();
});
it.each([
  `https://evil.test/story-studio/projects/${id}/canvas`,
  `https://studio.fizzdragon.com.evil.test/story-studio/projects/${id}/canvas`,
  `https://user@studio.fizzdragon.com/story-studio/projects/${id}/canvas`,
  `http://studio.fizzdragon.com/story-studio/projects/${id}/canvas`,
  `https://studio.fizzdragon.com/story-studio/projects/${id}/canvas\\`,
  "\nhttps://studio.fizzdragon.com",
  "x".repeat(2049),
])("rejects unsafe or malformed link %s", (link) =>
  expect(canvasProjectId(link, "global")).toBeNull()
);
it("previews via the crew-scoped API and posts only the reviewed version", async () => {
  const signal = new AbortController().signal;
  expect(await fetchCanvasTaskPreview("crew", id, 1, signal)).toEqual(preview);
  expect(h.get).toHaveBeenCalledWith(
    `/crews/crew/canvas-task-import/story-projects/${id}/preview`,
    { service: "aurora", signal }
  );
  expect(h.post).not.toHaveBeenCalled();
  await applyCanvasTaskImport("crew", preview, 1);
  expect(h.post).toHaveBeenCalledWith(`/crews/crew/canvas-task-import/story-projects/${id}/apply`, {
    service: "aurora",
    data: { sourceRevision: 4, sourceHash: "a".repeat(64) },
  });
});
it("rejects another crew in a preview", async () => {
  h.get.mockResolvedValue({ ...preview, crewId: "other" });
  await expect(fetchCanvasTaskPreview("crew", id, 1, new AbortController().signal)).rejects.toThrow(
    "scope"
  );
  await expect(applyCanvasTaskImport("other", preview, 1)).rejects.toThrow("scope");
  expect(h.post).not.toHaveBeenCalled();
});
it("discards a preview after account change", async () => {
  h.get.mockImplementation(async () => {
    h.generation++;
    return preview;
  });
  await expect(fetchCanvasTaskPreview("crew", id, 1, new AbortController().signal)).rejects.toThrow(
    "expired"
  );
  await expect(applyCanvasTaskImport("crew", preview, 1)).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
});
it.each([0, 201])("rejects %s scenes before posting", async (count) => {
  const data = {
    ...preview,
    plotTree: {
      nodes: Array.from({ length: count }, (_, i) => ({
        id: String(i),
        type: "scene",
        content: {},
      })),
    },
  };
  await expect(applyCanvasTaskImport("crew", data, 1)).rejects.toThrow("between");
  expect(h.post).not.toHaveBeenCalled();
});
