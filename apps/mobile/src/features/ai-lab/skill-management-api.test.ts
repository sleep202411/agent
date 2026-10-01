import { beforeEach, expect, it, vi } from "vitest";
import {
  loadSkillCatalog,
  skillMutationBox,
  writeSkillMutation,
  type SkillMutation,
} from "./skill-management-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post, put: h.put, delete: h.delete },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, key: string) => ({
    read: () => h.records.get(`${ns}:${user}:${key}`) ?? null,
    write: (value: string) => h.records.set(`${ns}:${user}:${key}`, value),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  skillId = "22222222-2222-4222-8222-222222222222",
  versionId = "33333333-3333-4333-8333-333333333333",
  clientKey = "44444444-4444-4444-8444-444444444444";
const project = {
  id,
  projectId: id,
  workspaceId: id,
  kind: "platform" as const,
  title: "Creative",
  canGenerate: true,
};
const installation = {
  id: versionId,
  skillId,
  name: "Lighting",
  pinnedVersionId: versionId,
  status: "active",
  revision: 1,
  version: {
    version: "1",
    checksum: "sha",
    capabilities: ["image_generation"],
    projectKinds: [],
    workbenchModes: [],
  },
  defaults: [{ scope: "image_generation", sourceSurface: null, workbenchMode: null }],
};
const catalog = () => ({
  ownerKind: "platform",
  projectId: id,
  projectRevision: 1,
  canManage: true,
  items: [
    {
      id: skillId,
      name: "Lighting",
      description: "Light",
      publisherName: "Studio",
      kind: "image",
      latestVersion: {
        id: versionId,
        version: "1",
        capabilities: ["image_generation"],
        projectKinds: [],
        workbenchModes: [],
      },
      installation: null,
    },
  ],
});
let revision: number, canManage: boolean, installed: unknown[];
const command = (): SkillMutation => ({
  clientKey,
  ownerKind: "platform",
  projectId: id,
  workspaceId: id,
  expectedProjectRevision: 1,
  kind: "install",
  skillId,
  versionId,
});
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  revision = 1;
  canManage = true;
  installed = [];
  h.get.mockImplementation(async (path) =>
    path === "/skills"
      ? { ...catalog(), projectRevision: revision, canManage }
      : {
          ownerKind: "platform",
          projectId: id,
          projectRevision: revision,
          installations: installed,
        }
  );
  h.post.mockResolvedValue({ projectRevision: 2, installation });
});
it("pins the reviewed version and saves exact request before the write", async () => {
  h.post.mockImplementation(async (path, config) => {
    expect(skillMutationBox("alice", 1, project).read()).toEqual(command());
    expect(path).toBe(`/project-skills/platform/${id}/installations`);
    expect(config.data).toEqual({
      idempotencyKey: clientKey,
      expectedProjectRevision: 1,
      skillId,
      versionId,
    });
    expect(config.retry).toBe(false);
    return { projectRevision: 2, installation };
  });
  await writeSkillMutation(command(), "alice", 1, project, signal());
  expect(skillMutationBox("alice", 1, project).read()).toBeNull();
});
it("replays original key/revision after lost receipt and isolates records by account/project", async () => {
  h.post.mockRejectedValueOnce(Error("lost"));
  await expect(writeSkillMutation(command(), "alice", 1, project, signal())).rejects.toThrow(
    "lost"
  );
  revision = 2;
  expect(skillMutationBox("bob", 1, project).read()).toBeNull();
  expect(
    skillMutationBox("alice", 1, { ...project, id: versionId, projectId: versionId }).read()
  ).toBeNull();
  await writeSkillMutation(
    skillMutationBox("alice", 1, project).read()!,
    "alice",
    1,
    project,
    signal()
  );
  expect(h.post.mock.calls.map((call) => call[1].data.idempotencyKey)).toEqual([
    clientKey,
    clientKey,
  ]);
  expect(h.post.mock.calls[1]![1].data.expectedProjectRevision).toBe(1);
});
it("rejects revoked management, changed revision and wrong project before writes", async () => {
  canManage = false;
  await expect(writeSkillMutation(command(), "alice", 1, project, signal())).rejects.toThrow(
    "cannot manage"
  );
  canManage = true;
  revision = 2;
  await expect(writeSkillMutation(command(), "alice", 1, project, signal())).rejects.toThrow(
    "changed"
  );
  await expect(
    writeSkillMutation({ ...command(), projectId: versionId }, "alice", 1, project, signal())
  ).rejects.toThrow("mismatch");
  expect(h.post).not.toHaveBeenCalled();
});
it("keeps pending requests after receipt mismatch or a stale session", async () => {
  h.post.mockResolvedValueOnce({
    projectRevision: 2,
    installation: { ...installation, skillId: id },
  });
  await expect(writeSkillMutation(command(), "alice", 1, project, signal())).rejects.toThrow(
    "mismatch"
  );
  expect(skillMutationBox("alice", 1, project).read()).not.toBeNull();
  h.post.mockImplementation(async () => {
    h.generation++;
    return { projectRevision: 2, installation };
  });
  await expect(writeSkillMutation(command(), "alice", 1, project, signal())).rejects.toThrow(
    "expired"
  );
  h.generation = 1;
  expect(skillMutationBox("alice", 1, project).read()).not.toBeNull();
});
it("preserves unpublished installations and refuses mixed catalog revisions", async () => {
  installed = [{ ...installation, skillId: versionId }];
  const result = await loadSkillCatalog(project, 1, signal());
  expect(result.items).toHaveLength(2);
  expect(result.items[1]!.installation?.defaults).toEqual(installation.defaults);
  installed = [installation];
  const reconciled = await loadSkillCatalog(project, 1, signal());
  expect(reconciled.items).toHaveLength(1);
  expect(reconciled.items[0]!.installation?.id).toBe(installation.id);
  const base = h.get.getMockImplementation()!;
  h.get.mockImplementation(async (path) => {
    const value = await base(path);
    return path === "/skills" ? { ...value, projectRevision: 3 } : value;
  });
  await expect(loadSkillCatalog(project, 1, signal())).rejects.toThrow("changed while loading");
});
it("confirms exact removal receipt and uses revisioned DELETE body", async () => {
  const c: SkillMutation = {
    ...command(),
    kind: "remove",
    installationId: versionId,
    expectedRevision: 7,
  };
  h.delete.mockResolvedValueOnce({ projectRevision: 2, installationId: id, uninstalled: true });
  await expect(writeSkillMutation(c, "alice", 1, project, signal())).rejects.toThrow("mismatch");
  h.delete.mockResolvedValue({ projectRevision: 2, installationId: versionId, uninstalled: true });
  await writeSkillMutation(c, "alice", 1, project, signal());
  expect(h.delete.mock.calls[1]![1].data).toMatchObject({
    expectedRevision: 7,
    expectedProjectRevision: 1,
    idempotencyKey: clientKey,
  });
});
it("writes an explicit complete default set and checks the returned set", async () => {
  const c: SkillMutation = {
    ...command(),
    kind: "defaults",
    scope: "image_generation",
    installationIds: [id, versionId],
  };
  h.put.mockResolvedValueOnce({ projectRevision: 2, installationIds: [id] });
  await expect(writeSkillMutation(c, "alice", 1, project, signal())).rejects.toThrow("mismatch");
  h.put.mockResolvedValue({ projectRevision: 2, installationIds: [versionId, id] });
  await writeSkillMutation(c, "alice", 1, project, signal());
  expect(h.put.mock.calls[1]![0]).toBe(`/project-skills/platform/${id}/defaults/image_generation`);
  expect(h.put.mock.calls[1]![1].data.installationIds).toEqual([id, versionId]);
});
