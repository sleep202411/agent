import { beforeEach, expect, it, vi } from "vitest";
import {
  createStudioInvite,
  listStudioInvites,
  revokeStudioInvite,
  studioInviteUrl,
  StudioInviteWriteError,
  type StudioInviteScope,
} from "./studio-invites-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: h }));
const id = "11111111-1111-4111-8111-111111111111";
const scope: StudioInviteScope = { kind: "workspace", id, name: "Team" };
const row = {
  inviteId: id,
  role: "editor",
  status: "pending",
  createdAt: "2026-09-30T00:00:00Z",
  expiresAt: null,
};
const receipt = { inviteId: id, role: "editor", expiresAt: null, token: "a".repeat(32) };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue([row]);
  h.post.mockResolvedValue(receipt);
  h.delete.mockResolvedValue({ revoked: true });
});
it("reads and creates permanent invitations", async () => {
  expect((await listStudioInvites(scope, 1))[0].expiresAt).toBeNull();
  expect(await createStudioInvite(scope, 1, "editor", null)).toEqual(receipt);
  expect(h.post).toHaveBeenCalledWith(`/workspaces/${id}/invites`, {
    service: "aurora",
    data: { role: "editor", expiresInDays: null },
  });
});
it("creates timed story invitations with story-specific roles", async () => {
  h.get.mockResolvedValue([]);
  h.post.mockResolvedValue({ ...receipt, role: "reviewer", expiresAt: "2026-10-01T00:00:00Z" });
  await createStudioInvite({ ...scope, kind: "story-project" }, 1, "reviewer", 1);
  expect(h.post).toHaveBeenCalledWith(
    `/story-projects/${id}/invites`,
    expect.objectContaining({ data: { role: "reviewer", expiresInDays: 1 } })
  );
});
it("rejects invalid roles and expiry before requests", async () => {
  await expect(createStudioInvite(scope, 1, "producer", null)).rejects.toThrow();
  await expect(createStudioInvite(scope, 1, "editor", 31)).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
it("does not write after revoked permission or account change", async () => {
  h.get.mockRejectedValueOnce(new Error("Denied"));
  await expect(createStudioInvite(scope, 1, "editor", null)).rejects.toThrow("Denied");
  h.get.mockImplementation(async () => {
    h.generation++;
    return [row];
  });
  await expect(createStudioInvite(scope, 1, "editor", null)).rejects.toThrow("session expired");
  expect(h.post).not.toHaveBeenCalled();
});
it("marks lost or mismatched creation receipts uncertain without retry", async () => {
  h.post.mockRejectedValueOnce(new Error("Network lost"));
  await expect(createStudioInvite(scope, 1, "editor", null)).rejects.toBeInstanceOf(
    StudioInviteWriteError
  );
  h.post.mockResolvedValue({ ...receipt, role: "admin" });
  await expect(createStudioInvite(scope, 1, "editor", null)).rejects.toBeInstanceOf(
    StudioInviteWriteError
  );
  expect(h.post).toHaveBeenCalledTimes(2);
});
it("rechecks presence before revoking and validates the receipt", async () => {
  await revokeStudioInvite(scope, 1, id);
  expect(h.delete).toHaveBeenCalledWith(`/workspaces/${id}/invites/${id}`, {
    service: "aurora",
    data: {},
  });
  h.get.mockResolvedValue([]);
  await expect(revokeStudioInvite(scope, 1, id)).rejects.toThrow("changed");
  expect(h.delete).toHaveBeenCalledTimes(1);
});
it("rejects duplicate and wrong-scope roles", async () => {
  h.get.mockResolvedValue([row, row]);
  await expect(listStudioInvites(scope, 1)).rejects.toThrow();
  h.get.mockResolvedValue([{ ...row, role: "producer" }]);
  await expect(listStudioInvites(scope, 1)).rejects.toThrow();
});
it("builds region-specific links without accepting arbitrary URLs", () => {
  expect(studioInviteUrl(receipt.token, "cn")).toBe(
    `https://studio.fizzspace.cn/invite/${receipt.token}`
  );
  expect(studioInviteUrl(receipt.token, "global")).toBe(
    `https://studio.fizzdragon.com/invite/${receipt.token}`
  );
  expect(() => studioInviteUrl("https://evil.test", "global")).toThrow();
});
it("cancels preflight before writing", async () => {
  const c = new AbortController();
  h.get.mockImplementation(async () => {
    c.abort();
    return [row];
  });
  await expect(createStudioInvite(scope, 1, "editor", null, c.signal)).rejects.toThrow("cancelled");
  expect(h.post).not.toHaveBeenCalled();
});
it("lists, creates and revokes platform-project invitations without workspace scope", async () => {
  const projectScope = { ...scope, kind: "project" as const };
  await createStudioInvite(projectScope, 1, "editor", null);
  expect(h.get).toHaveBeenCalledWith(
    `/projects/${id}/invites`,
    expect.objectContaining({ service: "aurora" })
  );
  expect(h.post).toHaveBeenCalledWith(`/projects/${id}/invites`, {
    service: "aurora",
    data: { role: "editor", expiresInDays: null },
  });
  await revokeStudioInvite(projectScope, 1, id);
  expect(h.delete).toHaveBeenCalledWith(`/projects/${id}/invites/${id}`, {
    service: "aurora",
    data: {},
  });
});
it("rejects story-only roles in platform project invites", async () => {
  const projectScope = { ...scope, kind: "project" as const };
  await expect(createStudioInvite(projectScope, 1, "reviewer", null)).rejects.toThrow("role");
  expect(h.post).not.toHaveBeenCalled();
  h.get.mockResolvedValue([{ ...row, role: "producer" }]);
  await expect(listStudioInvites(projectScope, 1)).rejects.toThrow("Invalid");
});
