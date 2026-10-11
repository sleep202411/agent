import { beforeEach, expect, it, vi } from "vitest";
import { loadWorldPreviewScope } from "./world-preview-scope";
import { assertWorldPreviewScope, hasWorldRenderer } from "./world-preview-manifest";
import { worldManifestFixture } from "./__fixtures__/world-manifest";
import { createExperienceRuntime } from "../lib/experience-runtime-host";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
const projectId = "21111111-1111-4111-8111-111111111111",
  workspaceId = "11111111-1111-4111-8111-111111111111";
const project = {
  id: projectId,
  workspaceId,
  status: "active",
  capabilities: ["story.read", "story.generate"],
};
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ project });
});
it("resolves the project-owned workspace without relying on a selected workspace", async () => {
  expect(await loadWorldPreviewScope(projectId, 1)).toEqual({
    projectId,
    workspaceId,
    generation: 1,
  });
  expect(h.get).toHaveBeenCalledExactlyOnceWith(`/story-projects/${projectId}/workbench`, {
    service: "aurora",
    signal: undefined,
  });
});
it.each([
  { ...project, capabilities: ["story.read"] },
  { ...project, id: workspaceId },
  { ...project, status: "archived" },
  { ...project, workspaceId: "bad" },
])("rejects permission/scope failures before acquiring any stream: %j", async (project) => {
  h.get.mockResolvedValue({ project });
  await expect(loadWorldPreviewScope(projectId, 1)).rejects.toThrow();
});
it("rejects account changes and cancellation before and after lookup", async () => {
  h.generation = 2;
  await expect(loadWorldPreviewScope(projectId, 1)).rejects.toThrow("session changed");
  expect(h.get).not.toHaveBeenCalled();
  h.generation = 1;
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { project };
  });
  await expect(loadWorldPreviewScope(projectId, 1)).rejects.toThrow("session changed");
  h.generation = 1;
  const abort = new AbortController();
  abort.abort();
  await expect(loadWorldPreviewScope(projectId, 1, abort.signal)).rejects.toThrow(
    "session changed"
  );
});
it("enables the actual world engine adapter only for a validated private preview", () => {
  const manifest = worldManifestFixture();
  const scope = { projectId, workspaceId, generation: 1 };
  expect(hasWorldRenderer(manifest)).toBe(true);
  assertWorldPreviewScope(manifest, scope);
  expect(() => createExperienceRuntime(manifest, {})).toThrow(/core.world-model/);
  const controller = createExperienceRuntime(manifest, { worldStreaming: true });
  expect(controller.start().state.currentSceneId).toBe("scene.text");
  expect(
    controller.emitRendererOutcome({
      instanceId: "text.primary",
      outcomeType: "world-completed",
      payload: {},
    }).state.completedEndingId
  ).toBe("ending.done");
  expect(() => assertWorldPreviewScope(manifest, { ...scope, projectId: workspaceId })).toThrow(
    "scope mismatch"
  );
  expect(() =>
    createExperienceRuntime({ ...manifest, channel: "production" }, { worldStreaming: true })
  ).toThrow(/core.world-model/);
  expect(() => assertWorldPreviewScope({ ...manifest, channel: "production" }, scope)).toThrow(
    "authenticated project previews"
  );
});
