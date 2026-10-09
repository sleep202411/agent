import { beforeEach, expect, it, vi } from "vitest";
import {
  listLikenessGrantProjects,
  reviewLikenessGrant,
  likenessGrantCreateBox,
  prepareLikenessGrant,
  createLikenessGrant,
} from "./likeness-grant-create-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  workspaces: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/features/agent/api/studio-projects-api", () => ({
  loadAgentWorkspaces: h.workspaces,
  loadAgentProjects: vi.fn(),
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(ns + user + id) ?? null,
    write: (v: string) => h.records.set(ns + user + id, v),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  key = "33333333-3333-4333-8333-333333333333";
const character = {
  id,
  workspaceId: id,
  name: "My likeness",
  kind: "real_person" as const,
  status: "active" as const,
  updatedAt: "2026-01-01T00:00:00Z",
};
const project = {
  id: other,
  workspaceId: key,
  name: "Film",
  workspaceName: "Team",
  status: "active" as const,
};
const receipt = {
  id: key,
  projectId: other,
  projectName: "Film",
  status: "active",
  createdAt: "2026-01-02T00:00:00Z",
  revokedAt: null,
};
const signal = () => new AbortController().signal;
const command = () => prepareLikenessGrant({ character, project }, key, true, true);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.workspaces.mockResolvedValue([{ id: key, name: "Team", isDefault: false }]);
  h.get.mockImplementation(async (path) =>
    path.endsWith("/grants")
      ? { items: [] }
      : path === `/characters/${id}`
        ? character
        : path === `/projects/${other}`
          ? { project: { ...project, role: "editor" } }
          : { projects: [project] }
  );
  h.post.mockResolvedValue(receipt);
});
it("lists active ungranted Creative projects across workspaces", async () => {
  h.get.mockImplementation(async (path) =>
    path.endsWith("/grants")
      ? { items: [receipt] }
      : {
          projects: [
            project,
            { ...project, id: key, name: "Another" },
            { ...project, id, status: "archived" },
          ],
        }
  );
  expect((await listLikenessGrantProjects(id, 1, signal())).map((p) => p.name)).toEqual([
    "Another",
  ]);
});
it("rejects subject denial, mismatched workspace and duplicate candidates", async () => {
  h.get.mockRejectedValueOnce(new Error("Subject denied"));
  await expect(listLikenessGrantProjects(id, 1, signal())).rejects.toThrow("Subject denied");
  expect(h.workspaces).not.toHaveBeenCalled();
  for (const projects of [[{ ...project, workspaceId: id }], [project, project]]) {
    h.get.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ projects });
    await expect(listLikenessGrantProjects(id, 1, signal())).rejects.toThrow();
  }
});
it("reviews fresh project identity, active likeness and editor permission", async () => {
  expect((await reviewLikenessGrant(id, project, 1, signal())).project.name).toBe("Film");
  h.get.mockImplementation(async (path) =>
    path.endsWith("/grants")
      ? { items: [] }
      : path === `/characters/${id}`
        ? character
        : { project: { ...project, role: "viewer" } }
  );
  await expect(reviewLikenessGrant(id, project, 1, signal())).rejects.toThrow("editor");
  h.get
    .mockResolvedValueOnce({ items: [] })
    .mockResolvedValueOnce({ ...character, status: "revoked" });
  await expect(reviewLikenessGrant(id, project, 1, signal())).rejects.toThrow();
});
it("requires both consent gates and sends exact official consent with durable intent", async () => {
  for (const [read, adult] of [
    [false, true],
    [true, false],
  ])
    expect(() => prepareLikenessGrant({ character, project }, key, read, adult)).toThrow("consent");
  h.post.mockImplementation(async (path, { data, retry }) => {
    expect(path).toBe(`/characters/${id}/grants`);
    expect(retry).toBe(false);
    expect(data).toEqual({
      projectId: other,
      consent: { version: "realperson-grant-v1-2026-07-02", adultAttested: true },
    });
    expect(likenessGrantCreateBox("actor", 1, id).read()).toEqual(command());
    return receipt;
  });
  await createLikenessGrant(command(), "actor", 1, signal());
  expect(likenessGrantCreateBox("actor", 1, id).read()).toBeNull();
});
it("rejects changed likeness/project or an already-active grant before POST", async () => {
  h.get
    .mockResolvedValueOnce({ items: [] })
    .mockResolvedValueOnce({ ...character, updatedAt: "changed" });
  await expect(createLikenessGrant(command(), "actor", 1, signal())).rejects.toThrow("changed");
  h.get
    .mockResolvedValueOnce({ items: [] })
    .mockResolvedValueOnce(character)
    .mockResolvedValueOnce({ project: { ...project, name: "Renamed", role: "editor" } });
  await expect(createLikenessGrant(command(), "actor", 1, signal())).rejects.toThrow("changed");
  h.get.mockResolvedValueOnce({ items: [receipt] });
  await expect(createLikenessGrant(command(), "actor", 1, signal())).rejects.toThrow("already");
  expect(h.post).not.toHaveBeenCalled();
});
it("retains unknown grants across restart and never re-grants after a later withdrawal", async () => {
  h.post.mockRejectedValueOnce(new Error("Lost receipt"));
  await expect(createLikenessGrant(command(), "actor", 1, signal())).rejects.toThrow("Lost");
  expect(likenessGrantCreateBox("actor", 1, id).read()).toEqual(command());
  expect(likenessGrantCreateBox("other-user", 1, id).read()).toBeNull();
  h.get.mockResolvedValue({
    items: [{ ...receipt, status: "revoked", revokedAt: "2026-02-01T00:00:00Z" }],
  });
  await expect(createLikenessGrant(command(), "actor", 1, signal())).rejects.toThrow("original");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("retains mismatched receipts and late results after an account change", async () => {
  h.post.mockResolvedValueOnce({ ...receipt, projectId: id });
  await expect(createLikenessGrant(command(), "actor", 1, signal())).rejects.toThrow("receipt");
  expect(likenessGrantCreateBox("actor", 1, id).read()).not.toBeNull();
  h.records.clear();
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return receipt;
  });
  await expect(createLikenessGrant(command(), "actor", 1, signal())).rejects.toThrow();
  h.generation = 1;
  expect(likenessGrantCreateBox("actor", 1, id).read()).not.toBeNull();
});
