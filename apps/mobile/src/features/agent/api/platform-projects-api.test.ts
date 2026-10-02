import { beforeEach, expect, it, vi } from "vitest";
import {
  updatePlatformProjectCover,
  readPlatformProject,
  archivePlatformProject,
  createPlatformProject,
  loadPlatformProjects,
  updatePlatformProject,
  PlatformProjectWriteError,
} from "./platform-projects-api";
const h = vi.hoisted(() => ({
  generation: 1,
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ getLocale: () => "en-US" }));
const id = "11111111-1111-4111-8111-111111111111",
  workspaceId = "22222222-2222-4222-8222-222222222222";
const project = {
  id,
  workspaceId,
  name: "Film",
  description: "",
  status: "active" as const,
  visibility: "private" as const,
  role: "owner" as const,
  version: 2,
  updatedAt: "2026-09-30T00:00:00Z",
};
const workspace = {
  id: workspaceId,
  name: "Team",
  isDefault: false,
  status: "active",
  role: "owner",
  accessScope: "workspace",
};
const draft = { name: "Film", description: "" };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ project });
  h.post.mockResolvedValue({ project });
  h.patch.mockResolvedValue({ project: { ...project, version: 3 } });
  h.delete.mockResolvedValue({ archived: true, projectId: id });
});
it("reads the complete scoped list and rejects duplicates/foreign rows", async () => {
  h.get.mockResolvedValue({ projects: [project] });
  expect(await loadPlatformProjects(workspaceId, 1, new AbortController().signal)).toEqual([
    project,
  ]);
  for (const projects of [
    [project, project],
    [{ ...project, workspaceId: id }],
    [{ ...project, status: "archived" }],
  ]) {
    h.get.mockResolvedValue({ projects });
    await expect(
      loadPlatformProjects(workspaceId, 1, new AbortController().signal)
    ).rejects.toThrow();
  }
});
it("creates private projects after fresh workspace permission checks", async () => {
  h.get.mockResolvedValue({ workspace });
  await createPlatformProject(workspaceId, draft, "First Section", 1);
  expect(h.post).toHaveBeenCalledWith(`/workspaces/${workspaceId}/projects`, {
    service: "aurora",
    data: { ...draft, visibility: "private", initialSectionTitle: "First Section" },
  });
});
it.each([
  { role: "viewer" },
  { role: "billing" },
  { accessScope: "project_only" },
  { status: "suspended" },
])("denies workspace creation for %j", async (change) => {
  h.get.mockResolvedValue({ workspace: { ...workspace, ...change } });
  await expect(createPlatformProject(workspaceId, draft, "First", 1)).rejects.toThrow("permission");
  expect(h.post).not.toHaveBeenCalled();
});
it("honors additive Crew editor access", async () => {
  h.get.mockResolvedValue({ workspace: { ...workspace, role: "viewer", crewRole: "editor" } });
  await createPlatformProject(workspaceId, draft, "First", 1);
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("pins reviewed update versions and preserves unrelated project metadata", async () => {
  await updatePlatformProject(project, draft, 1);
  expect(h.patch).toHaveBeenCalledWith(`/projects/${id}`, {
    service: "aurora",
    data: { ...draft, description: null, expectedVersion: 2 },
  });
});
it("rejects changed versions and revoked editing permission before mutation", async () => {
  for (const change of [{ version: 3 }, { role: "viewer" }, { workspaceId: id }]) {
    h.get.mockResolvedValue({ project: { ...project, ...change } });
    await expect(updatePlatformProject(project, draft, 1)).rejects.toThrow();
  }
  expect(h.patch).not.toHaveBeenCalled();
});
it("requires exact archive confirmation and a fresh owner grant", async () => {
  await expect(archivePlatformProject(project, "Wrong", 1)).rejects.toThrow("exact");
  expect(h.get).not.toHaveBeenCalled();
  h.get.mockResolvedValue({ project: { ...project, role: "admin" } });
  await expect(archivePlatformProject(project, "Film", 1)).rejects.toThrow("owner");
  expect(h.delete).not.toHaveBeenCalled();
  h.get.mockResolvedValue({ project });
  await archivePlatformProject(project, "Film", 1);
  expect(h.delete).toHaveBeenCalledWith(`/projects/${id}`, {
    service: "aurora",
    data: { expectedVersion: 2 },
  });
});
it("marks malformed or lost mutation receipts as uncertain", async () => {
  h.patch.mockResolvedValue({ project: { ...project, version: 9 } });
  await expect(updatePlatformProject(project, draft, 1)).rejects.toBeInstanceOf(
    PlatformProjectWriteError
  );
  h.delete.mockRejectedValue(new Error("Lost response"));
  await expect(archivePlatformProject(project, "Film", 1)).rejects.toBeInstanceOf(
    PlatformProjectWriteError
  );
});
it("blocks account changes and aborted preflights", async () => {
  const c = new AbortController();
  h.get.mockImplementation(async () => {
    c.abort();
    return { project };
  });
  await expect(updatePlatformProject(project, draft, 1, c.signal)).rejects.toThrow("cancelled");
  expect(h.patch).not.toHaveBeenCalled();
  h.generation++;
  await expect(createPlatformProject(workspaceId, draft, "First", 1)).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects invalid drafts before loading permissions", async () => {
  await expect(
    createPlatformProject(workspaceId, { ...draft, name: " " }, "First", 1)
  ).rejects.toThrow();
  await expect(
    updatePlatformProject(project, { ...draft, description: "x".repeat(5001) }, 1)
  ).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});

it("writes only cover metadata and retains the official cover fields", async () => {
  h.patch.mockResolvedValue({
    project: {
      ...project,
      version: 3,
      coverAssetId: id,
      thumbnailUrl: `/aurora/media/assets/${id}/content`,
    },
  });
  const result = await updatePlatformProjectCover(project, id, 1, new AbortController().signal);
  expect(result.coverAssetId).toBe(id);
  expect(result.thumbnailUrl).toContain(id);
  expect(h.patch).toHaveBeenCalledWith(`/projects/${id}`, {
    service: "aurora",
    data: { coverAssetId: id, expectedVersion: 2 },
  });
});
it("removes explicit covers and rejects revoked access before the cover write", async () => {
  h.patch.mockResolvedValue({ project: { ...project, version: 3, coverAssetId: null } });
  expect(
    (await updatePlatformProjectCover(project, null, 1, new AbortController().signal)).coverAssetId
  ).toBeNull();
  h.patch.mockClear();
  h.get.mockResolvedValue({ project: { ...project, role: "viewer" } });
  await expect(
    updatePlatformProjectCover(project, id, 1, new AbortController().signal)
  ).rejects.toThrow("permission");
  expect(h.patch).not.toHaveBeenCalled();
});
it("rejects mismatched cover receipts and foreign project reads", async () => {
  h.patch.mockResolvedValue({ project: { ...project, version: 3, coverAssetId: workspaceId } });
  await expect(
    updatePlatformProjectCover(project, id, 1, new AbortController().signal)
  ).rejects.toBeInstanceOf(PlatformProjectWriteError);
  await expect(readPlatformProject(id, id, 1, new AbortController().signal)).rejects.toThrow(
    "workspace"
  );
});
