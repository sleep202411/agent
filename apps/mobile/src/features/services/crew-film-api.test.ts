import { beforeEach, expect, it, vi } from "vitest";
import { createCrewFilm, loadCrewFilms } from "./crew-film-api";
const h = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), create: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/features/agent/api/studio-projects-api", () => ({
  loadAgentProjects: h.list,
  createAgentProject: h.create,
}));
const workspace = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ page: { crewId: "crew" }, studioWorkspace: { id: workspace } });
  h.list.mockResolvedValue({ workspaceId: workspace, projects: [] });
  h.create.mockResolvedValue({ project: { id: "film", workspaceId: workspace } });
});
it("lists the bound workspace without initializing a default", async () => {
  const c = new AbortController();
  await loadCrewFilms("crew", 1, c.signal);
  expect(h.list).toHaveBeenCalledWith(c.signal, workspace);
});
it("returns an unlinked state without creating anything", async () => {
  h.get.mockResolvedValue({ page: { crewId: "crew" }, studioWorkspace: null });
  expect(await loadCrewFilms("crew", 1, new AbortController().signal)).toEqual({
    workspaceId: null,
    projects: [],
  });
  expect(h.list).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
});
it("rechecks the binding before permission-checked project creation", async () => {
  const c = new AbortController();
  await createCrewFilm("crew", workspace, " Film ", 1, c.signal);
  expect(h.create).toHaveBeenCalledWith({
    workspaceId: workspace,
    title: "Film",
    signal: c.signal,
  });
});
it("rejects a changed binding before writing", async () => {
  h.get.mockResolvedValue({ page: { crewId: "crew" }, studioWorkspace: null });
  await expect(
    createCrewFilm("crew", workspace, "Film", 1, new AbortController().signal)
  ).rejects.toThrow("changed");
  expect(h.create).not.toHaveBeenCalled();
});
it("rejects cross-Crew and cross-workspace results", async () => {
  h.get.mockResolvedValueOnce({ page: { crewId: "another" }, studioWorkspace: { id: workspace } });
  await expect(loadCrewFilms("crew", 1, new AbortController().signal)).rejects.toThrow("scope");
  h.list.mockResolvedValue({ workspaceId: "another", projects: [] });
  await expect(loadCrewFilms("crew", 1, new AbortController().signal)).rejects.toThrow("scope");
});
it("drops an old account response before querying projects", async () => {
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { page: { crewId: "crew" }, studioWorkspace: { id: workspace } };
  });
  await expect(loadCrewFilms("crew", 1, new AbortController().signal)).rejects.toThrow("expired");
  expect(h.list).not.toHaveBeenCalled();
});
