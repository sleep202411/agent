import { beforeEach, expect, it, vi } from "vitest";
import {
  getGenerationProject,
  listGenerationProjects,
  getStoryCanvasGenerationProject,
} from "./projects-api";
const h = vi.hoisted(() => ({ get: vi.fn(), stories: vi.fn(), generation: 1 }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/features/agent/api/studio-projects-api", () => ({ loadAgentProjects: h.stories }));
const workspaceId = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.stories.mockResolvedValue({ workspaceId, projects: [{ id, title: "Story", workspaceId }] });
});
it("keeps Creative/Story identities distinct and excludes archived Creative projects", async () => {
  h.get.mockResolvedValue({
    projects: [
      { id, name: "Creative", workspaceId, status: "active" },
      { id: workspaceId, workspaceId, name: "Old", status: "archived" },
    ],
  });
  expect(await listGenerationProjects(workspaceId, 1, signal())).toEqual([
    { kind: "platform", id, title: "Creative" },
    { kind: "story", id, title: "Story" },
  ]);
  expect(h.stories.mock.calls[0][1]).toBe(workspaceId);
});
it("reads effective project permissions rather than inheriting workspace edit access", async () => {
  h.get.mockResolvedValue({
    project: { id, workspaceId, name: "Creative", status: "active", role: "viewer" },
  });
  expect(
    (await getGenerationProject(workspaceId, { kind: "platform", id }, 1, signal())).canGenerate
  ).toBe(false);
  h.get.mockResolvedValue({
    id,
    workspaceId,
    title: "Story",
    status: "active",
    capabilities: ["story.read", "story.edit"],
  });
  expect(
    (await getGenerationProject(workspaceId, { kind: "story", id }, 1, signal())).canGenerate
  ).toBe(false);
  h.get.mockResolvedValue({
    id,
    workspaceId,
    title: "Story",
    status: "active",
    capabilities: ["story.read", "story.generate"],
  });
  expect(await getGenerationProject(workspaceId, { kind: "story", id }, 1, signal())).toMatchObject(
    { storyProjectId: id, canGenerate: true }
  );
});
it("rejects wrong project/workspace, archived projects and stale sessions", async () => {
  for (const patch of [{ id: workspaceId }, { workspaceId: id }, { status: "archived" }]) {
    h.get.mockResolvedValue({
      project: { id, workspaceId, name: "Creative", status: "active", role: "owner", ...patch },
    });
    await expect(
      getGenerationProject(workspaceId, { kind: "platform", id }, 1, signal())
    ).rejects.toThrow("unavailable");
  }
  h.generation = 2;
  h.get.mockClear();
  await expect(
    getGenerationProject(workspaceId, { kind: "platform", id }, 1, signal())
  ).rejects.toThrow("expired");
  expect(h.get).not.toHaveBeenCalled();
});

it("resolves canvas workspace from the current Story project and requires editing access", async () => {
  const row = {
    id,
    workspaceId,
    title: "Story",
    status: "active",
    capabilities: ["story.read", "story.edit", "story.generate"],
  };
  h.get.mockResolvedValue(row);
  expect(await getStoryCanvasGenerationProject(id, 1, signal())).toMatchObject({
    workspaceId,
    storyProjectId: id,
    canGenerate: true,
  });
  h.get.mockResolvedValue({ ...row, capabilities: ["story.generate"] });
  await expect(getStoryCanvasGenerationProject(id, 1, signal())).rejects.toThrow(
    "editing permission"
  );
  h.get.mockResolvedValue({ ...row, status: "archived" });
  await expect(getStoryCanvasGenerationProject(id, 1, signal())).rejects.toThrow("unavailable");
  h.get.mockImplementation(async () => {
    h.generation++;
    return row;
  });
  await expect(getStoryCanvasGenerationProject(id, 1, signal())).rejects.toThrow("expired");
});
