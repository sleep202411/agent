import { beforeEach, expect, it, vi } from "vitest";
import {
  loadAgentProjects,
  readStudioWorkspace,
  loadAgentWorkspaces,
  createAgentProject,
  canCreateStudioProject,
} from "./studio-projects-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ getLocale: () => "en-US" }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
const workspaceId = "11111111-1111-4111-8111-111111111111";
const project = (n: number) => ({
  id: `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`,
  workspaceId,
  title: `Project ${n}`,
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.post.mockResolvedValue({ workspace: { id: workspaceId, name: "Workspace", isDefault: true } });
});
it("loads beyond 100 projects with the opaque server cursor", async () => {
  const first = Array.from({ length: 100 }, (_, n) => project(n));
  h.get.mockResolvedValueOnce({ items: first, nextCursor: "opaque" });
  h.get.mockResolvedValueOnce({ items: [project(100)], nextCursor: null });
  const signal = new AbortController().signal;
  expect((await loadAgentProjects(signal)).projects).toEqual([...first, project(100)]);
  expect(h.get).toHaveBeenNthCalledWith(
    2,
    "/story-projects",
    expect.objectContaining({
      signal,
      params: { workspaceId, status: "active", limit: 100, cursor: "opaque" },
    })
  );
});
it("deduplicates overlapping pages", async () => {
  h.get.mockResolvedValueOnce({ items: [project(1)], nextCursor: "next" });
  h.get.mockResolvedValueOnce({
    items: [{ ...project(1), title: "Older" }, project(2)],
    nextCursor: null,
  });
  expect((await loadAgentProjects()).projects).toEqual([project(1), project(2)]);
});
it.each([
  { items: [], nextCursor: "next" },
  { items: [project(1)], nextCursor: "next" },
])("rejects stalled cursors", async (second) => {
  h.get.mockResolvedValueOnce({ items: [project(1)], nextCursor: "next" });
  h.get.mockResolvedValueOnce(second);
  await expect(loadAgentProjects()).rejects.toThrow("did not advance");
  expect(h.get).toHaveBeenCalledTimes(2);
});
it("rejects foreign workspace rows", async () => {
  h.get.mockResolvedValue({
    items: [{ ...project(1), workspaceId: project(2).id }],
    nextCursor: null,
  });
  await expect(loadAgentProjects()).rejects.toThrow("workspace mismatch");
});
it("does not return partial success when the second page fails", async () => {
  h.get.mockResolvedValueOnce({ items: [project(1)], nextCursor: "next" });
  h.get.mockRejectedValueOnce(new Error("Access revoked"));
  await expect(loadAgentProjects()).rejects.toThrow("Access revoked");
});
it("checks cancellation before ensuring the workspace", async () => {
  const c = new AbortController();
  c.abort();
  await expect(loadAgentProjects(c.signal)).rejects.toThrow("cancelled");
  expect(h.post).not.toHaveBeenCalled();
});
it("stops on an account change after workspace lookup", async () => {
  h.post.mockImplementation(async () => {
    h.generation++;
    return { workspace: { id: workspaceId } };
  });
  await expect(loadAgentProjects()).rejects.toThrow("session expired");
  expect(h.get).not.toHaveBeenCalled();
});
it("stops paging after cancellation even if transport returns a result", async () => {
  const c = new AbortController();
  h.get.mockImplementation(async () => {
    c.abort();
    return { items: [project(1)], nextCursor: "next" };
  });
  await expect(loadAgentProjects(c.signal)).rejects.toThrow("cancelled");
  expect(h.get).toHaveBeenCalledTimes(1);
});
it("rejects late pages from a previous account", async () => {
  h.get.mockImplementation(async () => {
    h.generation++;
    return { items: [project(1)], nextCursor: null };
  });
  await expect(loadAgentProjects()).rejects.toThrow("session expired");
});
it.each([{ nextCursor: null }, { items: [], nextCursor: "" }, { items: [null], nextCursor: null }])(
  "rejects malformed pages",
  async (page) => {
    h.get.mockResolvedValue(page);
    await expect(loadAgentProjects()).rejects.toThrow();
  }
);

const workspace = {
  id: workspaceId,
  name: "Studio",
  isDefault: false,
  status: "active" as const,
  role: "editor" as const,
  accessScope: "workspace" as const,
};
it("lists active workspaces including crew-inherited access", async () => {
  h.get.mockResolvedValue({
    workspaces: [workspace, { ...workspace, id: project(3).id, status: "archived" }],
  });
  expect(await loadAgentWorkspaces()).toEqual([workspace]);
});
it("rejects duplicate workspace entries", async () => {
  h.get.mockResolvedValue({ workspaces: [workspace, workspace] });
  await expect(loadAgentWorkspaces()).rejects.toThrow("Duplicate");
});
it("loads a selected workspace without bootstrapping the default", async () => {
  h.get.mockResolvedValue({ items: [project(1)], nextCursor: null });
  await loadAgentProjects(undefined, workspaceId);
  expect(h.post).not.toHaveBeenCalled();
});
it.each(["viewer", "billing"] as const)("withholds creation for %s", async (role) => {
  h.get.mockResolvedValue({ workspace: { ...workspace, role } });
  await expect(createAgentProject({ workspaceId, title: "New" })).rejects.toThrow("permission");
  expect(h.post).not.toHaveBeenCalled();
});
it("project-only access cannot create even with editor role", () => {
  expect(canCreateStudioProject({ ...workspace, accessScope: "project_only" })).toBe(false);
  expect(canCreateStudioProject({ ...workspace, role: "billing", crewRole: "editor" })).toBe(true);
});
it("creates in the chosen workspace after a fresh permission read", async () => {
  h.get.mockResolvedValue({ workspace });
  h.post.mockResolvedValue({ project: project(1), chapter: { id: project(2).id } });
  await createAgentProject({ workspaceId, title: "New" });
  expect(h.post).toHaveBeenCalledWith(
    "/story-projects",
    expect.objectContaining({ data: expect.objectContaining({ workspaceId, title: "New" }) })
  );
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("does not create after an account change during permission preflight", async () => {
  h.get.mockImplementation(async () => {
    h.generation++;
    return { workspace };
  });
  await expect(createAgentProject({ workspaceId, title: "New" })).rejects.toThrow(
    "session expired"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("filters suspended workspaces without failing the rest of the list", async () => {
  h.get.mockResolvedValue({
    workspaces: [workspace, { ...workspace, id: project(9).id, status: "suspended" }],
  });
  expect(await loadAgentWorkspaces()).toEqual([workspace]);
  expect(canCreateStudioProject({ ...workspace, status: "suspended" })).toBe(false);
});
it("retains story administration capability for the invitation entry", async () => {
  h.get.mockResolvedValue({
    items: [{ ...project(1), capabilities: ["story.read", "story.admin"] }],
    nextCursor: null,
  });
  expect((await loadAgentProjects(undefined, workspaceId)).projects[0].capabilities).toContain(
    "story.admin"
  );
});

it("reads an exact linked workspace without creating or selecting a default", async () => {
  const workspace = {
    id: workspaceId,
    name: "Team",
    isDefault: false,
    role: "viewer",
    status: "active",
  };
  h.get.mockResolvedValue({ workspace });
  expect(await readStudioWorkspace(workspaceId, 1, new AbortController().signal)).toEqual(
    workspace
  );
  expect(h.get).toHaveBeenCalledWith(
    `/workspaces/${workspaceId}`,
    expect.objectContaining({ service: "aurora" })
  );
  expect(h.post).not.toHaveBeenCalled();
});
it.each([
  { id: "22222222-2222-4222-8222-222222222222" },
  { status: "archived" },
  { status: "suspended" },
])("rejects mismatched or inactive linked workspace %j", async (patch) => {
  h.get.mockResolvedValue({
    workspace: { id: workspaceId, name: "Team", isDefault: false, ...patch },
  });
  await expect(readStudioWorkspace(workspaceId, 1, new AbortController().signal)).rejects.toThrow(
    "no longer available"
  );
});
it("rejects late linked-workspace responses after account changes or cancellation", async () => {
  const workspace = { id: workspaceId, name: "Team", isDefault: false };
  h.get.mockImplementationOnce(async () => {
    h.generation++;
    return { workspace };
  });
  await expect(readStudioWorkspace(workspaceId, 1, new AbortController().signal)).rejects.toThrow(
    "expired"
  );
  const c = new AbortController();
  h.get.mockImplementationOnce(async () => {
    c.abort();
    return { workspace };
  });
  await expect(readStudioWorkspace(workspaceId, h.generation, c.signal)).rejects.toThrow(
    "cancelled"
  );
});
