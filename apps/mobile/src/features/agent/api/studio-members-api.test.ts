import { beforeEach, expect, it, vi } from "vitest";
import {
  changeStudioMember,
  fetchStudioMembers,
  StudioMemberWriteError,
} from "./studio-members-api";
const h = vi.hoisted(() => ({
  generation: 1,
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: h }));
const id = "11111111-1111-4111-8111-111111111111";
const scope = { kind: "workspace" as const, id, name: "Team" };
const member = {
  memberId: id,
  userId: "2",
  nickname: "Artist",
  role: "viewer" as const,
  status: "active" as const,
  accessScope: "workspace" as const,
  isOwner: false,
  isSelf: false,
};
const workspace = { id, status: "active", role: "owner", accessScope: "workspace" };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/members") ? [member] : { workspace }
  );
  h.post.mockResolvedValue(member);
  h.patch.mockResolvedValue({ ...member, role: "editor" });
  h.delete.mockResolvedValue({ removed: true });
});
it("distinguishes workspace admin from owner role editing", async () => {
  expect(await fetchStudioMembers(scope, 1)).toMatchObject({
    canAdd: true,
    canEdit: true,
    canRemove: true,
  });
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/members") ? [member] : { workspace: { ...workspace, role: "admin" } }
  );
  expect(await fetchStudioMembers(scope, 1)).toMatchObject({
    canAdd: true,
    canEdit: false,
    canRemove: true,
  });
  await expect(
    changeStudioMember(scope, 1, { kind: "role", member, role: "editor" })
  ).rejects.toThrow("permission");
  expect(h.patch).not.toHaveBeenCalled();
});
it("uses story.admin rather than inferring permission from direct member rows", async () => {
  const story = { ...scope, kind: "story-project" as const };
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/members")
      ? [member]
      : { id, status: "active", capabilities: ["story.read", "story.admin"] }
  );
  expect(await fetchStudioMembers(story, 1)).toMatchObject({ canAdd: true, canEdit: true });
});
it("validates contact and scope-specific role before making requests", async () => {
  await expect(
    changeStudioMember(scope, 1, { kind: "add", account: "invalid", role: "viewer" })
  ).rejects.toThrow("email");
  await expect(
    changeStudioMember(scope, 1, { kind: "add", account: "a@b.com", role: "producer" })
  ).rejects.toThrow("role");
  expect(h.get).not.toHaveBeenCalled();
});
it("adds an account only after current permission is read", async () => {
  await changeStudioMember(scope, 1, { kind: "add", account: " a@b.com ", role: "viewer" });
  expect(h.post).toHaveBeenCalledWith(`/workspaces/${id}/members`, {
    service: "aurora",
    data: { account: "a@b.com", role: "viewer" },
  });
});
it("rechecks target role and protects the owner", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/members") ? [{ ...member, role: "editor" }] : { workspace }
  );
  await expect(changeStudioMember(scope, 1, { kind: "remove", member })).rejects.toThrow("changed");
  const owner = { ...member, role: "owner" as const, isOwner: true };
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/members") ? [owner] : { workspace }
  );
  await expect(changeStudioMember(scope, 1, { kind: "remove", member: owner })).rejects.toThrow(
    "owner"
  );
  expect(h.delete).not.toHaveBeenCalled();
});
it("refuses removing project-only roster entries at workspace scope", async () => {
  const row = { ...member, accessScope: "project_only" as const };
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/members") ? [row] : { workspace }
  );
  await expect(changeStudioMember(scope, 1, { kind: "remove", member: row })).rejects.toThrow(
    "projects instead"
  );
  expect(h.delete).not.toHaveBeenCalled();
});
it("verifies role and removal receipts", async () => {
  await changeStudioMember(scope, 1, { kind: "role", member, role: "editor" });
  await changeStudioMember(scope, 1, { kind: "remove", member });
  h.patch.mockResolvedValue(member);
  await expect(
    changeStudioMember(scope, 1, { kind: "role", member, role: "editor" })
  ).rejects.toBeInstanceOf(StudioMemberWriteError);
});
it("marks lost write results uncertain and never retries", async () => {
  h.post.mockRejectedValue(new Error("Lost response"));
  await expect(
    changeStudioMember(scope, 1, { kind: "add", account: "a@b.com", role: "viewer" })
  ).rejects.toBeInstanceOf(StudioMemberWriteError);
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("rejects stale account reads and duplicate members", async () => {
  h.get.mockImplementation(async () => {
    h.generation++;
    return { workspace };
  });
  await expect(fetchStudioMembers(scope, 1)).rejects.toThrow("session expired");
  h.generation = 1;
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/members") ? [member, member] : { workspace }
  );
  await expect(fetchStudioMembers(scope, 1)).rejects.toThrow("Invalid");
});
it("allows project admins to manage direct project roles with project-scoped endpoints", async () => {
  const projectScope = { ...scope, kind: "project" as const };
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/members") ? [member] : { project: { id, status: "active", role: "admin" } }
  );
  expect(await fetchStudioMembers(projectScope, 1)).toMatchObject({
    canAdd: true,
    canEdit: true,
    canRemove: true,
  });
  await changeStudioMember(projectScope, 1, { kind: "add", account: "a@b.com", role: "viewer" });
  expect(h.post).toHaveBeenCalledWith(`/projects/${id}/members`, {
    service: "aurora",
    data: { account: "a@b.com", role: "viewer" },
  });
  await changeStudioMember(projectScope, 1, { kind: "role", member, role: "editor" });
  expect(h.patch).toHaveBeenCalledWith(`/projects/${id}/members/${id}`, {
    service: "aurora",
    data: { role: "editor" },
  });
  await changeStudioMember(projectScope, 1, { kind: "remove", member });
  expect(h.delete).toHaveBeenCalledWith(`/projects/${id}/members/${id}`, {
    service: "aurora",
    data: {},
  });
});
it.each(["editor", "viewer"])("allows project %s to read but not manage members", async (role) => {
  const projectScope = { ...scope, kind: "project" as const };
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/members") ? [member] : { project: { id, status: "active", role } }
  );
  expect(await fetchStudioMembers(projectScope, 1)).toMatchObject({
    canAdd: false,
    canEdit: false,
    canRemove: false,
  });
  await expect(changeStudioMember(projectScope, 1, { kind: "remove", member })).rejects.toThrow(
    "permission"
  );
  expect(h.delete).not.toHaveBeenCalled();
});
it("rejects foreign project scope and story-only roles in platform projects", async () => {
  const projectScope = { ...scope, kind: "project" as const };
  await expect(
    changeStudioMember(projectScope, 1, { kind: "add", account: "a@b.com", role: "producer" })
  ).rejects.toThrow("role");
  expect(h.get).not.toHaveBeenCalled();
  h.get.mockResolvedValue({
    project: { id: "22222222-2222-4222-8222-222222222222", status: "active", role: "admin" },
  });
  await expect(fetchStudioMembers(projectScope, 1)).rejects.toThrow("scope mismatch");
});
