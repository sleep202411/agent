import { beforeEach, expect, it, vi } from "vitest";
import {
  castingAcceptUrl,
  castingBox,
  castingRecipient,
  listCastingInvites,
  writeCastingInvite,
  type CastingCommand,
} from "./casting-invites-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  project: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post, delete: h.delete } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./projects-api", () => ({ getGenerationProject: h.project }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, key: string) => ({
    read: () => h.records.get(`${ns}:${user}:${key}`) ?? null,
    write: (v: string) => h.records.set(`${ns}:${user}:${key}`, v),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  inviteId = "22222222-2222-4222-8222-222222222222",
  clientKey = "33333333-3333-4333-8333-333333333333";
const project = {
  id,
  projectId: id,
  workspaceId: id,
  kind: "platform" as const,
  title: "Creative",
  canGenerate: true,
};
const row = () => ({
  id: inviteId,
  projectId: id,
  inviteeUserId: "actor",
  inviteeContact: null,
  status: "pending",
  expiresAt: "2099-01-01T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  respondedAt: null,
});
const command = (): Extract<CastingCommand, { action: "create" }> => ({
  clientKey,
  workspaceId: id,
  projectId: id,
  action: "create",
  recipient: { mode: "user", value: "actor" },
});
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.project.mockResolvedValue(project);
  h.get.mockResolvedValue({ items: [] });
  h.post.mockResolvedValue({
    id: inviteId,
    token: "a".repeat(32),
    expiresAt: "2099-01-01T00:00:00Z",
  });
  h.delete.mockResolvedValue({ ok: true });
});
it("checks current project editor permission and rejects Story projects before private reads", async () => {
  h.project.mockResolvedValue({ ...project, canGenerate: false });
  await expect(listCastingInvites(project, 1, signal())).rejects.toThrow("editor");
  expect(h.get).not.toHaveBeenCalled();
  await expect(listCastingInvites({ ...project, kind: "story" }, 1, signal())).rejects.toThrow(
    "Creative"
  );
});
it("validates project-scoped lists, unique IDs and late session changes", async () => {
  h.get.mockResolvedValueOnce({ items: [{ ...row(), projectId: inviteId }] });
  await expect(listCastingInvites(project, 1, signal())).rejects.toThrow("match");
  h.get.mockResolvedValueOnce({ items: [row(), row()] });
  await expect(listCastingInvites(project, 1, signal())).rejects.toThrow("match");
  h.get.mockImplementationOnce(async () => {
    h.generation = 2;
    return { items: [] };
  });
  await expect(listCastingInvites(project, 1, signal())).rejects.toThrow("session");
});
it("persists before create, uses exactly one target and validates the one-time receipt", async () => {
  h.post.mockImplementationOnce(async (_path, opts) => {
    expect(castingBox("alice", 1, project).read()).toEqual(command());
    expect(opts).toMatchObject({ retry: false, data: { inviteeUserId: "actor" } });
    return { id: inviteId, token: "a".repeat(32), expiresAt: "2099-01-01T00:00:00Z" };
  });
  expect(await writeCastingInvite(command(), "alice", 1, project, signal())).toMatchObject({
    id: inviteId,
  });
  expect(castingBox("alice", 1, project).read()).toBeNull();
  await writeCastingInvite(
    { ...command(), recipient: { mode: "contact", value: "person@example.test" } },
    "alice",
    1,
    project,
    signal()
  );
  expect(h.post.mock.calls[1][1].data).toEqual({ inviteeContact: "person@example.test" });
});
it("retains uncertain writes across remounts and blocks replay or another command", async () => {
  h.post.mockRejectedValueOnce(Error("reply lost"));
  await expect(writeCastingInvite(command(), "alice", 1, project, signal())).rejects.toThrow(
    "reply lost"
  );
  await expect(writeCastingInvite(command(), "alice", 1, project, signal())).rejects.toThrow(
    "pending"
  );
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(castingBox("bob", 1, project).read()).toBeNull();
  expect(
    castingBox("alice", 1, { ...project, id: inviteId, projectId: inviteId }).read()
  ).toBeNull();
  castingBox("alice", 1, project).clear(clientKey);
  expect(castingBox("alice", 1, project).read()).toBeNull();
});
it("refuses stale revocation and preserves unknown or mismatched receipts", async () => {
  const revoke: CastingCommand = {
    clientKey,
    workspaceId: id,
    projectId: id,
    action: "revoke",
    inviteId,
  };
  h.get.mockResolvedValue({ items: [{ ...row(), status: "accepted" }] });
  await expect(writeCastingInvite(revoke, "alice", 1, project, signal())).rejects.toThrow(
    "changed"
  );
  expect(h.delete).not.toHaveBeenCalled();
  h.get.mockResolvedValue({ items: [row()] });
  h.delete.mockResolvedValueOnce({ ok: false });
  await expect(writeCastingInvite(revoke, "alice", 1, project, signal())).rejects.toThrow();
  expect(castingBox("alice", 1, project).read()).toEqual(revoke);
});
it("rechecks permissions before sending and preserves a late successful write under the original account", async () => {
  h.project.mockResolvedValueOnce({ ...project, canGenerate: false });
  await expect(writeCastingInvite(command(), "alice", 1, project, signal())).rejects.toThrow(
    "editor"
  );
  expect(h.post).not.toHaveBeenCalled();
  h.post.mockImplementationOnce(async () => {
    h.generation = 2;
    return { id: inviteId, token: "a".repeat(32), expiresAt: "2099-01-01T00:00:00Z" };
  });
  await expect(writeCastingInvite(command(), "alice", 1, project, signal())).rejects.toThrow(
    "session"
  );
  h.generation = 1;
  expect(castingBox("alice", 1, project).read()).toEqual(command());
});
it("uses regional Studio links and official target bounds", () => {
  expect(castingAcceptUrl("a".repeat(32), "cn")).toBe(
    `https://studio.fizzspace.cn/casting/accept?token=${"a".repeat(32)}`
  );
  expect(castingAcceptUrl("a".repeat(32), "global")).toContain("https://studio.fizzdragon.com/");
  expect(() => castingAcceptUrl("bad&token=", "global")).toThrow();
  expect(castingRecipient.parse({ mode: "user", value: " actor " }).value).toBe("actor");
  expect(() => castingRecipient.parse({ mode: "user", value: "a".repeat(65) })).toThrow();
});
